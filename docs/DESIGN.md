# dsh-auto-continue 插件大纲（设计文档）

> 本文是 `dsh-auto-continue` 的设计大纲：先讲清楚**要解决什么问题**，再讲**为什么这样设计**，
> 然后是**架构与数据流**、**状态机**、**安全围栏**，最后是**验收标准**。
> 实现细节见 `lib/index.js`（宿主半）与 `lib/client.js`（浏览器半）。

---

## 1. 需求理解

用户原话（要点）：

1. 写一个「自动继续」插件；
2. **要适配 DSH 本身**（作为 DSH 的原生插件接入，不是外挂脚本）；
3. 能在**聊天框「+」菜单**里显示，**选项为「开启」和「关闭」**；
4. 功能：任务途中如果因为**模型重试**、等其他因素**中断**，插件**自动发送「继续」**，
   让对话/工作继续跑下去；
5. 交付：设计大纲 → 生成代码 → 推送 GitHub 并建仓库 → 写好 README 和部署文档。

把第 4 条翻译成 DSH 的领域语言：

- 「任务途中中断」在 DSH 里是一次 **turn（回合）异常结束**。DSH 的会话日志里，
  每个回合结束都会写一条 `turn/end` 事件，带一个**结构化的结束原因**：
  `completed` / `aborted` / `blocked` / `error` / `max-tokens`。
- 「模型重试」是 `llm-retry` 插件在 `agent/request-error` 上做的恢复策略：它按
  provider 配置的 `retryPolicy` 做指数退避重试。**重试全部耗尽后**，那个错误会成为
  `turn/end { kind: 'error' }`。
- 「自动发送继续」在 DSH 里是 **宿主侧向 agent 投递一条用户消息**。DSH 为此提供了
  一等 API：`agent.followup(message)`——「排队一轮普通的后续回合并唤醒驱动器」，
  这正是 `goal-round-driver` 用来做目标续跑的同一条路径。

所以：**插件 = 观察 `turn/end` 的结束原因 + 在满足条件时用 `agent.followup()` 投递「继续」。**

---

## 2. 为什么用这个方案（取舍）

| 方案 | 做法 | 评价 |
| --- | --- | --- |
| A. 拦截 `agent/request-error` 直接返回 `{kind:'retry'}` | 在重试层自己接管 | ❌ 会和 `llm-retry` 抢同一个瀑布；重试策略该由 provider 配置决定，插件越权 |
| B. 包一层自定义 LLM 中间件重发请求 | `llm/stream` 中间件 | ❌ 只能救「单次请求」，救不了「回合已经失败结束、但工作没做完」这个真正的场景 |
| C. **观察 `turn/end` + `agent.followup()`**（本方案） | 回合异常结束后投递「继续」 | ✅ 用的是 DSH 自己的稳定事件与公开 API；对重试、超时、供应商 5xx、输出截断等**所有**导致回合异常结束的因素都统一生效 |
| D. 在浏览器里模拟点「发送」按钮 | 前端 DOM 操作 | ❌ 页面一刷新就断，标签页关掉就停；插件必须活在宿主进程里 |

方案 C 的关键优点：**它不关心是哪种中断**。模型重试耗尽、请求超时、供应商报错、
输出撞上 `max-tokens` 天花板、被 hook 中止——这些在 DSH 里最终都收敛成一条
`turn/end` + 结构化的原因。插件只对这一条事实做判断，因此天然覆盖「等其他因素」。

---

## 3. 架构

```
┌─────────────────────────── 浏览器（client 半 / lib/client.js）───────────────────────────┐
│  「+」菜单注入一行：  自动继续 ────────────── [ 关 ━─● ]  ← 滑动开关，默认靠左「关」   │
│  状态来源： ctx.settingsScope.bind({namespace:'auto-continue'}) 的实时快照                │
│  点击动作： scope.set('enabled', true/false)  → 走 DSH 自己的 settings 写入通道            │
└───────────────────────────────────────┬─────────────────────────────────────────────────┘
                                        │ DSH settings 命名空间（持久化、带 revision 围栏）
┌───────────────────────────────────────┴─────────────────────────────────────────────────┐
│                        宿主（host 半 / lib/index.js）                                    │
│                                                                                          │
│  settings.register('auto-continue', Schema)  ← 拥有配置并实时 watch                        │
│                                                                                          │
│  ctx.on('session/event')  ──┬─ user/message(kind==='user') → 人类接管：清零连续计数          │
│                              ├─ turn/end                  → 判定是否该续跑                  │
│                              └─ llm/retry                 → 记录「本轮发生过重试」           │
│  ctx.on('agent/status')    ──  running → 有病取消（人类又动了）；idle → 结算待发续跑          │
│  ctx.on('agent/disposed')  ──  清理状态                                                   │
│                                                                                          │
│  续跑执行： agent.followup(createUserMessage({ content:[{type:'text',text:'继续'}],       │
│                                     source:{kind:'plugin',plugin:'auto-continue',...} })) │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 触发的「结束原因」判定

| `turn/end.reason` | 含义 | 默认是否续跑 | 配置项 |
| --- | --- | --- | --- |
| `error` | 回合失败（重试耗尽/供应商错误/超时…） | ✅ 是 | `onError` |
| `max-tokens` | 撞上输出 token 天花板，话没说完 | ✅ 是 | `onMaxTokens` |
| `aborted` + cause `user` | **用户自己按了停止** | ❌ 永不 | —（硬编码，尊重人类） |
| `aborted` + 其他 cause | 被 parent/hook/disposed 中止 | ⚠️ 否 | `onAborted` |
| `blocked` | 被策略阻断 | ⚠️ 否 | `onBlocked` |
| `completed` | 正常完成 | ❌ 否 | —（没什么可续的） |
| `interrupted` | 日志修复补写的结束 | ❌ 否 | — |

> `aborted + user` 是**硬性例外**：用户按下停止键就是要求停下来，
> 任何自动续跑都不得违背。这一条不提供开关。

### 3.2 消息的「来源」声明

DSH 的消息模型明确要求：**非人类生产者必须声明自己的来源**，不能冒充用户，
否则会继承到「直接人类输入」的权限（例如 goal 工具的激活判定
`hasDirectHumanInput` 只认可 `source.kind === 'user'`）。

因此插件投递的消息带：

```js
source: {
  kind: 'plugin',            // DSH 内置来源种类：谁产生的
  plugin: 'auto-continue',   // 具体是哪个插件
  form: 'notice',            // 这是什么性质的东西：一次性事件通报
  summary: '自动继续（回合失败：…）',  // 折叠行上的一行说明
}
```

渲染结果：在对话流里显示为一条**可展开的上下文行**（不是冒充用户的气泡），
点开就是发送给模型的「继续」正文。既诚实可追溯，又不伪造人类输入。

---

## 4. 状态机（每个 agent 一份）

```
        ┌──────────────┐  人类发消息 / 正常完成      ┌──────────────┐
        │    IDLE      │◄───────────────────────────│  (无待办)     │
        │  streak = 0  │                            └──────────────┘
        └──────┬───────┘
               │ turn/end 命中触发原因
               ▼
        ┌──────────────┐  人类插话 / agent 变 running / 开关关闭
        │   ARMED      │────────────────────────────► 取消定时器，回到 IDLE
        │ 等待 delayMs │
        └──────┬───────┘
               │ 定时器到点，且仍然 idle 且 streak < maxStreak
               ▼
        ┌──────────────┐
        │  SENT        │  streak += 1  →  agent.followup('继续')
        └──────────────┘
```

`streak`（连续自动续跑次数）**只被真实的人类消息清零**。
当 `streak >= maxStreak` 时插件**主动收手**并打一条 warn 日志：

> 这样即使模型陷入「失败 → 继续 → 又失败」的死循环，也不会无限烧钱；
> 由用户重新发一句话即可恢复自动续跑。

---

## 5. 安全围栏（每一条都是防误伤）

1. **尊重人类停止**：`aborted { kind:'user' }` 永不续跑。
2. **人类插话即让路**：等待期间收到人类消息 / agent 变为 running → 取消本次续跑。
3. **只在真空闲时发**：`agent.status !== 'running'` 时不发；不打断正在跑的回合。
4. **连续次数封顶**：`maxStreak`（默认 12）兜住死循环。
5. **只认活着的 agent**：发送前用 `ctx.agents.get(sessionId) === agent` 复核，
   agent 已被销毁就不发。
6. **默认不管子 agent**：只对根 agent（`ctx.agents.roots()`）生效，
   避免和父 agent 的编排逻辑打架；`includeSubagents` 可开。
7. **不抢占重试**：不碰 `agent/request-error`，重试策略仍归 `llm-retry` 与 provider 配置；
   插件只在**重试都没救回来**之后接手。
8. **不做「卡住看门狗」**：刻意**不**实现「N 秒没有事件就判定卡死」。
   长命令（编译、跑测试）本来就会长时间静默，那种看门狗必然误伤。
   宁可漏救，不可误杀。

---

## 6. 配置项（settings 命名空间 `auto-continue`）

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | 总开关，「+」菜单的滑动开关写的就是它（默认关） |
| `prompt` | string | `继续` | 自动发送的正文 |
| `delayMs` | natural 0..600000 | `1500` | 回合结束后等待多久再发（留出结算/回流时间） |
| `maxStreak` | natural 1..1000 | `12` | 连续自动续跑上限 |
| `onError` | boolean | `true` | 回合失败后续跑 |
| `onMaxTokens` | boolean | `true` | 输出截断后续跑 |
| `onAborted` | boolean | `false` | 非用户原因中止后续跑 |
| `onBlocked` | boolean | `false` | 被阻断后续跑 |
| `includeSubagents` | boolean | `false` | 是否也管子 agent |
| `announce` | boolean | `true` | 是否把续跑记录进会话日志（关掉则静默，不推荐） |

---

## 7. 「+」菜单集成方式

DSH 当前的「+」菜单（`packages/client/ui-conversation/.../InputBar.tsx`）里三个菜单项
（上传图片 / 上传文件 / 命令）是**硬编码**的，**没有对外暴露 slot**。
（已核对 `contract/slots.ts` 的完整 slot 目录：有 `conversation.input.left/right/dock/plan/model`
等，但没有「+」菜单的扩展点。）

因此客户端插件采用**受控 DOM 注入**，并遵守以下纪律以避免脆化：

1. **只在菜单真的打开时注入**：监听 `[data-composer-card]` 子树变化，
   发现 `[role="menu"]` 出现（且其中含 DSH 原生菜单项）才注入；菜单关闭时
   React 会连同我们的节点一起卸载，无需清理。
2. **复用原生样式**：不硬编码 CSS-module 的哈希类名（每次前端构建都会变），
   而是**从同菜单里的原生菜单项复制 `className`**，天然跟随主题与构建。
3. **复用原生语义**：`role="menuitem"`、`type="button"`、`aria-checked` 标记当前状态。
4. **点击后发 Escape 关闭菜单**：原生菜单正是用 capture 阶段的 Escape 关闭的，
   复用同一条路径，不自己实现关闭逻辑。
5. **幂等**：注入前检查标记属性，避免重复注入。
6. **失败降级**：settings 命名空间不可用时，菜单项显示为禁用并给出提示，
   绝不静默假装已切换。

> 已知边界：DOM 注入依赖 `data-composer-card` / `role="menu"` 这一层**稳定语义契约**
> （DSH 刻意保留的 `data-*` 钩子），而不是易碎的哈希类名。将来 DSH 若为「+」菜单
> 开放 slot，客户端半应优先改为 slot 注册（本文档 §9 记录迁移路径）。

---

## 8. 验收标准

- [ ] 插件作为 DSH 原生 bundle 被加载（宿主日志出现 `auto-continue: plugin active`）。
- [ ] 「+」菜单里出现「自动继续」+ 滑动开关一行，默认靠左「关」，点击滑至右侧「开」。
- [ ] 点击「开启」后 settings 里 `auto-continue.enabled === true`，刷新页面后仍保持。
- [ ] 回合因错误结束时，会话里自动出现一条「继续」的插件上下文消息，工作继续。
- [ ] 用户按停止（`aborted {kind:'user'}`）后**不会**自动续跑。
- [ ] 续跑次数达到 `maxStreak` 后停止并告警。
- [ ] 关掉总开关后，任何中断都不再自动续跑。
- [ ] 插件卸载/进程重启后不残留定时器与状态。

## 9. 演进路径

1. 若 DSH 上游为「+」菜单开放 slot：客户端半改为 slot 注册，删除 DOM 注入。
2. 若需要「按会话开关」：把 `enabled` 从全局命名空间下沉为按 session 记录的
   宿主侧状态，菜单项读写当前会话的状态。
3. 若需要「卡住也救」：以**显式的心跳探针**（例如工具执行的最后事件 seq + 白名单）
   替代朴素超时看门狗，并在文档里写明误伤边界。
