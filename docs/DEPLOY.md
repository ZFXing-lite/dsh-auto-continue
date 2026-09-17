# 部署文档

> `dsh-auto-continue` 是一个标准的 DSH 双面插件（宿主半 `lib/index.js` + 浏览器半
> `lib/client.js`）。本文给出从零到在 GUI 里看到开关的完整步骤，以及常见问题。

---

## 1. 前置条件

- 已安装 DeepSeek Harness（`dsh` 可执行），版本需含 `agent.followup()` 与
  `session/event` 事件（0.1.1-rc.2 及以上）。
- 已有一个 web profile（默认 `$DSH_HOME/profiles/web`，`$DSH_HOME` 一般是
  `/var/lib/dsh`）。
- 插件目录里的 `node_modules/@deepseek-ai` 需指向 dsh 运行时的包（见下文「依赖链接」）。

## 2. 放置插件

把本仓库放到你存放第三方插件的位置，例如：

```bash
git clone <repo-url> /root/普通目录/dsh-auto-continue
# 或直接把已写好的目录拷过去
```

### 2.1 依赖链接

插件的 `lib/index.js` 会 `import` `@deepseek-ai/dsh-llm`、`@deepseek-ai/schemastery`
等运行时包。这些包由 dsh 自身提供，只需在插件目录里建一个符号链接指向 dsh 的
`node_modules/@deepseek$`：

```bash
mkdir -p /root/普通目录/dsh-auto-continue/node_modules
ln -sfn /usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai \
       /root/普通目录/dsh-auto-continue/node_modules/@deepseek-ai
```

> 如果你用 `pnpm`/`npm install` 在插件目录里装 `peerDependencies`，也可以不建这个链接；
> 链接方式只是最轻量的做法，和本仓库里其它插件（`dsh-restart-ui` 等）一致。

## 3. 登记到 web profile

profile 的 `package.json` 在 `$DSH_HOME/profiles/web/package.json`。

### 3.1 加依赖（link 到本地目录）

在 `dependencies` 里加一行：

```jsonc
"dependencies": {
  "dsh-auto-continue": "link:/root/普通目录/dsh-auto-continue",
  // ... 你已有的其它插件
}
```

并在 `node_modules` 里建对应符号链接（`dsh plugin add` 会自动做；手动做如下）：

```bash
cd $DSH_HOME/profiles/web/node_modules
ln -sfn /root/普通目录/dsh-auto-continue dsh-auto-continue
```

### 3.2 加入 bundle 列表

在同一个 `package.json` 的 `dsh.profile.bundles` 末尾追加 `"dsh-auto-continue"`：

```jsonc
"dsh": {
  "profile": {
    "bundles": [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      // ... 你已有的其它插件
      "dsh-auto-continue"
    ]
  }
}
```

> **注意**：bundle 列表在启动时固化，**改了需要重启 dsh**（见第 5 步）。
> 相比之下，profile 的 `cordis.patch.yml` 是热加载的，但新增 bundle 必须重启。

### 3.3 一键方式（推荐）

```bash
dsh plugin --profile web add /root/普通目录/dsh-auto-continue
```

它会跑 pnpm 装好 link，并把声明了 `dsh.bundle` 的依赖自动加进 `dsh.profile.bundles`。
之后仍需重启（第 5 步）。

## 4. （可选）改默认配置

插件的 `cordis.patch.yml` 已经带了一组合理默认。想改默认值（比如默认关闭、
或把 `maxStreak` 调成 20），编辑插件目录下的 `cordis.patch.yml`：

```yaml
- insert:
    - id: auto-continue
      name: dsh-auto-continue
      config:
        enabled: true
        maxStreak: 20
        # ... 其余字段见 README
```

用户随后在 GUI 里的切换会覆盖这些默认（写到 `$DSH_HOME/settings.yaml` 的
`auto-continue` 命名空间）。

## 5. 重启 dsh

```bash
# systemd 托管
systemctl restart dsh.service

# 或 nohup 手动
pkill -f "dsh web"; nohup dsh web --no-open --trusted-host <your-host> \
  > /var/log/dsh.log 2>&1 &
```

重启后**刷新浏览器页面**（新增的客户端 bundle 需要一次页面加载才能进入引导图）。

## 6. 验收

1. 打开聊天框，点「+」菜单，应看到：
   - `✓ 开启自动继续`
   - `○ 关闭自动继续`
   （当前状态用对勾标记；两项样式与原生菜单项一致。）
2. 点「关闭自动继续」，底部弹出「自动继续：已关闭」；再点「+」，对勾移到「关闭」。
3. 在 `$DSH_HOME/settings.yaml` 里应能看到：
   ```yaml
   auto-continue:
     enabled: false
   ```
4. 触发一次真实的回合失败（例如临时把模型改成一个不存在的 id），观察对话流里
   自动出现一条「自动继续（回合失败，第 1/12 次）」的上下文行，工作继续。
5. 按「停止」按钮中止一回话，**不会**自动续跑。

## 7. 卸载

1. 从 `package.json` 的 `dependencies` 和 `dsh.profile.bundles` 里删掉
   `dsh-auto-continue`，删掉 `node_modules` 里的符号链接。
2. 重启 dsh。
3. （可选）删 `$DSH_HOME/settings.yaml` 里的 `auto-continue:` 段。

## 8. 常见问题

**Q：重启后「+」菜单里没有出现这两项？**
A：99% 是 bundle 列表没加 / 没重启 / 没刷新页面。用 `dsh --profile web --dump-config`
   确认输出里有 `# == dsh-auto-continue` 段；有就说明宿主半已加载，剩下就是刷新页面。

**Q：客户端浏览器控制台报 `Cannot access 'schedule' before initialization`？**
A：那是早期版本的初始化顺序 bug，已修复。拉最新代码即可。

**Q：自动续跑停不下来 / 一直发「继续」？**
A：那是 `maxStreak` 在生效——它就是用来兜住「失败→继续→又失败」死循环的。
   连续到上限后会自动收手并打一条 warn 日志；你重新发一条人类消息即可恢复。
   想放宽上限，把 `maxStreak` 调大；想关掉自动续跑，在「+」菜单点「关闭」。

**Q：会不会把子 agent 也自动续跑、干扰编排？**
A：默认不会。`includeSubagents` 默认 `false`，只管根 agent。

**Q：用户按了「停止」还会被续跑吗？**
A：不会。`aborted` 且原因是 `user` 是**硬性例外**，没有任何开关能覆盖。

**Q：支持哪些中断原因？**
A：默认 `error`（含重试耗尽、供应商错误、超时）和 `max-tokens`（输出截断）。
   `aborted`（非用户）和 `blocked` 默认关，可开。`completed` 永不续跑。

## 9. 与 DSH 升级的关系

本插件只依赖 DSH 的**公开** API 与稳定事件（`session/event`、`agent.followup`、
`settings.register`、`turn/end` 的结构化原因、`[data-composer-card]`/`[role="(menu|menuitem)"]`
的语义契约）。不 patch 任何核心代码。DSH 若将来为「+」菜单开放 slot，客户端半可改为
slot 注册（见 [设计文档 §9](./DESIGN.md#9-演进路径)），届时删除 DOM 注入即可。
