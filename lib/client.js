/**
 * dsh-auto-continue — browser half.
 *
 * Two surfaces, one shared settings namespace:
 *  1. The composer's "+" menu gets ONE toggle row (quick switch while composing).
 *  2. Settings → Plugins → 插件配置 gets a full card: every field the host
 *     namespace owns is editable there with staged drafts + save, mirroring the
 *     card pattern of ui-settings-plugins. The card is registered into the
 *     `settings.plugin.item` slot keyed by the `auto-continue` namespace.
 *
 * Both surfaces read/write through `ctx.settingsScope` bound to the same
 * `auto-continue` namespace, so a flip in either place is authoritative and
 * they stay in sync.
 *
 * Self-contained: consumes only `react`, `react/jsx-runtime`, and the injected
 * `slots` + `settingsScope` services.
 */
window.__ModuleLoader__.load({
	id: "dsh-auto-continue",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");

		const NAMESPACE = "auto-continue";
		const ITEM_ATTR = "data-auto-continue-item";
		const MENU_ATTR = "data-auto-continue-menu";
		const STYLE_ID = "dsh-auto-continue/menu.css";
		const ROW_CLASS = "ac_row";
		const SWITCH_CLASS = "ac_switch";
		const THUMB_CLASS = "ac_thumb";

		const css = `
.${SWITCH_CLASS}{flex:none;display:inline-flex;align-items:center;width:44px;height:24px;box-sizing:border-box;padding:2px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover-solid);transition:background-color .18s var(--ds-ease-in-out,ease);cursor:pointer}
.${THUMB_CLASS}{width:20px;height:20px;border-radius:999px;flex:none;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;font-size:10px;line-height:1;font-weight:600;color:var(--dsw-alias-label-tertiary);transition:transform .18s var(--ds-ease-in-out,ease),color .18s var(--ds-ease-in-out,ease);transform:translateX(0);user-select:none}
.${ROW_CLASS}[aria-checked="true"] .${SWITCH_CLASS}{background:var(--dsw-alias-state-business-primary)}
.${ROW_CLASS}[aria-checked="true"] .${THUMB_CLASS}{transform:translateX(20px);color:var(--dsw-alias-state-business-primary)}
.${ROW_CLASS}:disabled .${SWITCH_CLASS}{opacity:.55;cursor:default}
.ac_toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:3000;max-width:min(420px,calc(100vw - 32px));display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:10px;background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px;animation:ac_in .16s var(--ds-ease-in-out,ease-out)}
.ac_toast[data-state=error]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
@keyframes ac_in{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}
@media (prefers-reduced-motion:reduce){.${THUMB_CLASS},.${SWITCH_CLASS},.ac_toast{transition:none;animation:none}}
`;
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(STYLE_ID) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-auto-continue";
			tag.dataset.pluginCss = STYLE_ID;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		const cfgCss = `
.acfg_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;min-width:0;overflow:hidden}
.acfg_card[data-open=true]{border-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv1)}
.acfg_head{box-sizing:border-box;width:100%;min-height:52px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;display:flex}
.acfg_card[data-open=true]>.acfg_head,.acfg_head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.acfg_title{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:14px;font-weight:600;line-height:20px;overflow:hidden;display:flex;align-items:baseline;gap:8px}
.acfg_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:1px 0 0}
.acfg_trail{color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;gap:7px;display:inline-flex}
.acfg_dot{background:var(--dsw-alias-label-tertiary);border-radius:999px;flex:none;width:7px;height:7px;display:inline-block}
.acfg_dot[data-ok=true]{background:var(--dsw-alias-state-success-primary)}
.acfg_tag{background:var(--dsw-alias-bg-layer-1);min-height:20px;color:var(--dsw-alias-label-secondary);padding:1px 6px;font-size:11px;line-height:16px;border-radius:5px;display:inline-flex;align-items:center}
.acfg_tag[data-enabled=true]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary)}
.acfg_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .14s var(--ds-ease-in-out)}
.acfg_card[data-open=true] .acfg_chevron{transform:rotate(180deg)}
.acfg_body{border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.acfg_row{display:grid;grid-template-columns:180px minmax(0,1fr);gap:6px 10px;align-items:start}
.acfg_label{font-size:12px;font-weight:600;line-height:17px;padding-top:5px}
.acfg_input{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);width:100%;min-height:30px;font:inherit;font-size:13px;border-radius:6px;padding:4px 8px;outline:none}
.acfg_input:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent)}
.acfg_input:disabled{opacity:.55}
.acfg_check{display:flex;align-items:center;gap:8px;min-height:30px}
.acfg_hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin:3px 0 0}
.acfg_meta{display:flex;align-items:center;gap:8px;min-height:20px;margin-top:2px}
.acfg_override{color:var(--dsw-alias-state-business-primary);font-size:11px}
.acfg_reset{color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;padding:0;font-size:11px;text-decoration:underline}
.acfg_reset:hover{color:var(--dsw-alias-label-primary)}
.acfg_foot{display:flex;align-items:center;gap:10px;justify-content:flex-end;padding-top:2px}
.acfg_error{color:var(--dsw-alias-state-error-primary);font-size:12px;flex:1}
.acfg_note{color:var(--dsw-alias-label-tertiary);font-size:12px}
.acfg_btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;border-radius:6px;padding:4px 12px;font-size:12px}
.acfg_btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l1)}
.acfg_btn:disabled{opacity:.5;cursor:default}
.acfg_btn[data-primary=true]{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:var(--dsw-alias-interactive-text)}
.acfg_btn[data-primary=true]:hover:not(:disabled){filter:brightness(1.08)}
`;
		const CFG_STYLE_ID = "dsh-auto-continue/config-card.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CFG_STYLE_ID) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-auto-continue";
			tag.dataset.pluginCss = CFG_STYLE_ID;
			tag.textContent = cfgCss;
			document.head.appendChild(tag);
		}
		const cfgClass = {
			card: "acfg_card", head: "acfg_head", title: "acfg_title", desc: "acfg_desc",
			trail: "acfg_trail", dot: "acfg_dot", tag: "acfg_tag", chevron: "acfg_chevron",
			body: "acfg_body", row: "acfg_row", label: "acfg_label", input: "acfg_input",
			check: "acfg_check", hint: "acfg_hint", meta: "acfg_meta", override: "acfg_override",
			reset: "acfg_reset", foot: "acfg_foot", error: "acfg_error", note: "acfg_note", btn: "acfg_btn"
		};

		let toastTimer;
		function toast(text, state) {
			if (typeof document === "undefined") return;
			let node = document.querySelector(".ac_toast");
			if (node === null) {
				node = document.createElement("div");
				node.className = "ac_toast";
				node.setAttribute("role", "status");
				document.body.appendChild(node);
			}
			node.dataset.state = state;
			node.textContent = text;
			window.clearTimeout(toastTimer);
			toastTimer = window.setTimeout(() => { node?.remove(); }, state === "error" ? 5000 : 2200);
		}

		function findAddMenus() {
			return [...document.querySelectorAll("[data-trigger-menu]")];
		}

		function buildToggleRow(options) {
			const { template, label, enabled, onToggle, disabled } = options;
			const button = document.createElement("button");
			button.type = "button";
			button.setAttribute("role", "menuitemcheckbox");
			button.setAttribute(ITEM_ATTR, "");
			if (typeof template.className === "string" && template.className.length > 0) {
				button.className = template.className + " " + ROW_CLASS;
			} else {
				button.className = ROW_CLASS;
			}
			button.setAttribute("aria-checked", enabled ? "true" : "false");
			if (disabled) {
				button.disabled = true;
				button.title = "设置不可用：本部署没有可写的 settings 通道";
			}
			const labelSlot = document.createElement("span");
			labelSlot.textContent = label;
			labelSlot.style.flex = "1";
			labelSlot.style.minWidth = "0";
			button.appendChild(labelSlot);
			const sw = document.createElement("span");
			sw.className = SWITCH_CLASS;
			sw.setAttribute("aria-hidden", "true");
			const thumb = document.createElement("span");
			thumb.className = THUMB_CLASS;
			thumb.textContent = enabled ? "开" : "关";
			sw.appendChild(thumb);
			button.appendChild(sw);
			button.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); });
			button.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				if (disabled) return;
				onToggle();
			});
			return button;
		}

		const FIELD_HINTS = {
			enabled: "总开关。开启后，回合因错误或输出截断等非用户原因中断时，自动发送「继续」让工作继续。",
			prompt: "自动发送的提示文本，默认「继续」。",
			delayMs: "回合结束后等待的毫秒数再发送，让会话先刷完、排队工作先跑。",
			maxStreak: "连续自动继续的最大次数。超出后停手并告警，直到下一条真人消息才清零计数。",
			onError: "回合失败（重试耗尽、provider 报错、超时）后继续。",
			onMaxTokens: "输出达到 token 上限被截断后继续。",
			onAborted: "非用户原因的中止后继续。用户主动停止永不继续、不可配置。",
			onBlocked: "回合被阻断后继续。",
			includeSubagents: "同时管理子 agent 的回合。默认关：父编排器拥有子回合结构。",
			announce: "预留字段。续作已记入会话日志，此项预留给未来表面通知。"
		};
		const FIELDS = [
			{ field: "enabled", kind: "boolean", label: "启用自动继续" },
			{ field: "prompt", kind: "text", label: "继续提示词" },
			{ field: "delayMs", kind: "number", label: "延迟毫秒" },
			{ field: "maxStreak", kind: "number", label: "最大连续次数" },
			{ field: "onError", kind: "boolean", label: "失败后继续" },
			{ field: "onMaxTokens", kind: "boolean", label: "截断后继续" },
			{ field: "onAborted", kind: "boolean", label: "中止后继续" },
			{ field: "onBlocked", kind: "boolean", label: "阻断后继续" },
			{ field: "includeSubagents", kind: "boolean", label: "包含子 agent" },
			{ field: "announce", kind: "boolean", label: "表面通知（预留）" }
		];

		function createStore(initial) {
			let snapshot = initial;
			const listeners = new Set();
			return {
				getSnapshot: () => snapshot,
				subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
				set: (next) => {
					snapshot = next;
					for (const listener of [...listeners]) {
						try { listener(); } catch (error) { console.error("[auto-continue] store listener threw:", error); }
					}
				}
			};
		}

		function formatValue(spec, value) {
			if (spec.kind === "boolean") return value === true;
			if (spec.kind === "number") return typeof value === "number" ? String(value) : "";
			return typeof value === "string" ? value : "";
		}
		function parseDraft(spec, draft) {
			if (draft.clear === true) return { kind: "clear" };
			if (spec.kind === "boolean") return { kind: "set", value: draft.checked === true };
			const text = draft.text ?? "";
			if (text.trim() === "") return { kind: "clear" };
			if (spec.kind === "number") {
				const parsed = Number(text.trim());
				return Number.isFinite(parsed) ? { kind: "set", value: parsed } : void 0;
			}
			return { kind: "set", value: text };
		}

		var AutoContinueController = class {
			constructor(scope) {
				this.scope = scope;
				this.drafts = new Map();
				this.saving = false;
				this.failed = false;
				this.store = createStore(this.project());
				this.unsubscribe = scope.subscribe(() => { this.publish(); });
			}
			dispose() { this.unsubscribe?.(); this.unsubscribe = void 0; }
			snapshot() { return this.scope.getSnapshot(); }
			project() {
				const snapshot = this.snapshot();
				const available = snapshot?.status === "ready";
				const writable = snapshot?.writable === true;
				const effective = snapshot?.value ?? {};
				const user = snapshot?.user ?? {};
				const base = snapshot?.base ?? {};
				const fields = {};
				let dirty = false;
				let invalid = false;
				for (const spec of FIELDS) {
					const value = effective[spec.field];
					const draft = this.drafts.get(spec.field);
					let text, checked, overridden, fieldInvalid = false;
					if (draft === void 0) {
						text = formatValue(spec, value);
						checked = value === true;
						overridden = Object.hasOwn(user, spec.field);
					} else {
						const cleanValue = spec.kind === "boolean" ? base[spec.field] === true : base[spec.field];
						text = spec.kind === "boolean" ? "" : draft.clear ? formatValue(spec, cleanValue) : draft.text ?? "";
						checked = draft.clear ? cleanValue : draft.checked === true;
						const write = parseDraft(spec, draft);
						overridden = write === void 0 || write.kind === "set";
						fieldInvalid = write === void 0;
						dirty = true;
					}
					if (fieldInvalid) invalid = true;
					fields[spec.field] = {
						text, checked, overridden, invalid: fieldInvalid,
						baseText: formatValue(spec, spec.kind === "boolean" ? base[spec.field] === true : base[spec.field])
					};
				}
				return { available, writable, dirty, invalid, saving: this.saving, failed: this.failed, fields };
			}
			publish() { this.store.set(this.project()); }
			actions() {
				return {
					edit: (field, text) => { this.drafts.set(field, { text, clear: false }); this.publish(); },
					toggle: (field, checked) => { this.drafts.set(field, { checked, clear: false }); this.publish(); },
					resetField: (field) => { this.drafts.set(field, { clear: true }); this.publish(); },
					save: () => { this.save(); },
					discard: () => {
						if (this.drafts.size === 0 && !this.failed) return;
						this.drafts.clear();
						this.failed = false;
						this.publish();
					}
				};
			}
			inject() {
				return { hooks: { autoContinue: this.store }, ...this.actions() };
			}
			plan() {
				const ops = [];
				for (const spec of FIELDS) {
					if (!this.drafts.has(spec.field)) continue;
					const write = parseDraft(spec, this.drafts.get(spec.field));
					if (write === void 0) continue;
					if (write.kind === "clear") ops.push({ spec, op: "unset" });
					else ops.push({ spec, op: "set", value: write.value });
				}
				return ops;
			}
			async save() {
				const ops = this.plan();
				if (ops.length === 0 || this.saving) return;
				const before = this.snapshot().revision;
				this.saving = true;
				this.failed = false;
				this.publish();
				for (const item of ops) {
					if (item.op === "set") await this.scope.set(item.spec.field, item.value);
					else await this.scope.unset(item.spec.field);
				}
				const after = this.snapshot().revision;
				this.failed = ops.length > 0 && after === before;
				this.saving = false;
				if (!this.failed) this.drafts.clear();
				this.publish();
			}
		};

		function FieldControl({ spec, field, onEdit, onToggle, onReset, disabled }) {
			if (spec.kind === "boolean") {
				return react_jsx_runtime.jsx("div", {
					className: cfgClass.check,
					children: react_jsx_runtime.jsx("input", {
						type: "checkbox",
						checked: field.checked,
						disabled,
						onChange: (event) => onToggle(event.target.checked)
					})
				});
			}
			const common = {
				id: `auto-continue-${spec.field}`,
				className: cfgClass.input,
				disabled,
				value: field.text,
				onChange: (event) => onEdit(event.target.value)
			};
			if (spec.kind === "number") common.inputMode = "numeric";
			return react_jsx_runtime.jsx("input", { ...common, type: "text", spellCheck: false });
		}

		function AutoContinueCard(props) {
			const state = props.useAutoContinue((snapshot) => snapshot);
			const [open, setOpen] = react.useState(false);
			const disabled = !state.writable || state.saving;
			const active = state.available && state.fields.enabled?.checked === true;
			return react_jsx_runtime.jsxs("div", {
				className: cfgClass.card,
				"data-open": open ? "true" : void 0,
				children: [
					react_jsx_runtime.jsx("button", {
						type: "button",
						className: cfgClass.head,
						"aria-expanded": open,
						onClick: () => setOpen((value) => !value),
						children: [
							react_jsx_runtime.jsxs("div", {
								children: [
									react_jsx_runtime.jsxs("div", {
										className: cfgClass.title,
										children: ["自动继续 (auto-continue)", react_jsx_runtime.jsx("span", {
											className: cfgClass.tag,
											"data-enabled": active ? "true" : void 0,
											children: active ? "开" : "关"
										})]
									}),
									react_jsx_runtime.jsx("p", {
										className: cfgClass.desc,
										children: "回合因错误或输出截断等非用户原因中断时，自动发送「继续」让工作继续"
									})
								]
							}),
							react_jsx_runtime.jsxs("span", {
								className: cfgClass.trail,
								children: [
									react_jsx_runtime.jsx("span", {
										className: cfgClass.dot,
										"data-ok": state.available ? "true" : void 0
									}),
									react_jsx_runtime.jsx("svg", {
										className: cfgClass.chevron, width: "14", height: "14",
										viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2",
										children: react_jsx_runtime.jsx("path", {
											d: "M6 9l6 6 6-6", strokeLinecap: "round", strokeLinejoin: "round"
										})
									})
								]
							})
						]
					}),
					open ? react_jsx_runtime.jsx("div", {
						className: cfgClass.body,
						children: [
							!state.available ? react_jsx_runtime.jsx("p", {
								className: cfgClass.note, children: "正在读取配置…"
							}) : null,
							!state.writable ? react_jsx_runtime.jsx("p", {
								className: cfgClass.note, children: "当前部署不可写（只读视图）。"
							}) : null,
							FIELDS.map((spec) => {
								const field = state.fields[spec.field];
								return react_jsx_runtime.jsxs("div", {
									className: cfgClass.row,
									children: [
										react_jsx_runtime.jsxs("div", {
											children: [
												react_jsx_runtime.jsx("label", {
													className: cfgClass.label,
													htmlFor: `auto-continue-${spec.field}`,
													children: spec.label
												}),
												react_jsx_runtime.jsx("p", {
													className: cfgClass.hint,
													children: FIELD_HINTS[spec.field]
												})
											]
										}),
										react_jsx_runtime.jsxs("div", {
											children: [
												react_jsx_runtime.jsx(FieldControl, {
													spec, field, disabled,
													onEdit: (text) => props.edit(spec.field, text),
													onToggle: (checked) => props.toggle(spec.field, checked),
													onReset: () => props.resetField(spec.field)
												}),
												react_jsx_runtime.jsxs("div", {
													className: cfgClass.meta,
													children: [
														field.invalid ? react_jsx_runtime.jsx("span", {
															className: cfgClass.error, children: "请输入有效数字"
														}) : null,
														field.overridden ? react_jsx_runtime.jsx("span", {
															className: cfgClass.override, children: "已覆盖默认值"
														}) : null,
														field.overridden ? react_jsx_runtime.jsx("button", {
															type: "button", className: cfgClass.reset, disabled,
															onClick: () => props.resetField(spec.field),
															children: "恢复默认"
														}) : null
													]
												})
											]
										})
									]
								}, spec.field);
							}),
							react_jsx_runtime.jsxs("div", {
								className: cfgClass.foot,
								children: [
									state.failed ? react_jsx_runtime.jsx("span", {
										className: cfgClass.error, children: "保存失败，请重试"
									}) : null,
									react_jsx_runtime.jsx("button", {
										type: "button", className: cfgClass.btn,
										disabled: !state.dirty && !state.failed,
										onClick: props.discard, children: "丢弃"
									}),
									react_jsx_runtime.jsx("button", {
										type: "button", className: cfgClass.btn, "data-primary": "true",
										disabled: !state.dirty || state.invalid || !state.writable || state.saving,
										onClick: props.save,
										children: state.saving ? "保存中…" : "保存"
									})
								]
							})
						]
					}) : null
				]
			});
		}

		const inject = ["slots", "settingsScope"];

		function apply(ctx) {
			const scope = ctx.settingsScope.bind({ namespace: NAMESPACE });

			/* ── Settings → Plugins config card ─────────────────────────────── */
			const controller = new AutoContinueController(scope);
			ctx.effect(() => () => { controller.dispose(); }, "auto-continue: config card controller");
			ctx.slots.inject("settings.plugin.item", function* () {
				yield ctx.slots.register({
					name: "settings.plugin.item",
					key: NAMESPACE,
					inject: () => controller.inject()
				}, AutoContinueCard);
			});

			/* ── "+" menu quick toggle ─────────────────────────────────────── */
			let live = { enabled: undefined, ready: false, writable: false };

			const setEnabled = (next) => {
				if (!live.ready) { toast("自动继续：设置尚未就绪，请稍后重试", "error"); return; }
				if (!live.writable) { toast("自动继续：本部署的设置通道不可写", "error"); return; }
				if (live.enabled === next) return;
				live = { ...live, enabled: next };
				render();
				void scope.set("enabled", next).then(
					() => { toast(next ? "自动继续：已开启（中断后自动发送「继续」）" : "自动继续：已关闭", "ok"); },
					(error) => { toast(`自动继续：切换失败（${error instanceof Error ? error.message : String(error)}）`, "error"); }
				);
			};

			function injectInto(menu) {
				if (menu.hasAttribute(MENU_ATTR)) return;
				const template = [...menu.querySelectorAll('[role="option"]')]
					.find(node => !node.hasAttribute(ITEM_ATTR));
				if (template === undefined) return;
				menu.setAttribute(MENU_ATTR, "");
				const disabled = !live.ready || !live.writable;
				menu.appendChild(buildToggleRow({
					template, label: "自动继续", enabled: live.enabled === true, disabled,
					onToggle: () => { setEnabled(live.enabled !== true); }
				}));
			}

			const rendered = new WeakMap();
			function render() {
				if (typeof document === "undefined") return;
				const signature = `${live.ready ? "ready" : "pending"}|${live.writable ? "rw" : "ro"}`
					+ `|${live.enabled === true ? "on" : live.enabled === false ? "off" : "unknown"}`;
				for (const menu of findAddMenus()) {
					const present = menu.querySelector("[" + ITEM_ATTR + "]") !== null;
					if (rendered.get(menu) === signature && present) continue;
					for (const row of menu.querySelectorAll("[" + ITEM_ATTR + "]")) row.remove();
					menu.removeAttribute(MENU_ATTR);
					injectInto(menu);
					rendered.set(menu, signature);
				}
			}

			let queued = false;
			const schedule = () => {
				if (queued) return;
				queued = true;
				(typeof requestAnimationFrame === "function" ? requestAnimationFrame : window.setTimeout)(() => {
					queued = false;
					render();
				});
			};
			const scheduleAfterGesture = () => {
				(typeof requestAnimationFrame === "function" ? requestAnimationFrame : window.setTimeout)(schedule);
			};

			const SCOPE_WINDOW_MS = 600;
			let scopedObserver = null;
			let scopedTimer = null;
			const disarmScoped = () => {
				if (scopedObserver !== null) { scopedObserver.disconnect(); scopedObserver = null; }
				if (scopedTimer !== null) { window.clearTimeout(scopedTimer); scopedTimer = null; }
			};
			const armScoped = (card) => {
				disarmScoped();
				if (typeof MutationObserver === "undefined" || card === null) return;
				scopedObserver = new MutationObserver(schedule);
				scopedObserver.observe(card, { childList: true, subtree: true });
				scopedTimer = window.setTimeout(disarmScoped, SCOPE_WINDOW_MS);
			};

			const ADD_BTN_SELECTOR = '[data-composer-card] button[aria-haspopup="listbox"]';
			const onGesture = (event) => {
				const target = event.target;
				if (!(target instanceof Element)) return;
				const button = target.closest(ADD_BTN_SELECTOR);
				if (button === null) return;
				scheduleAfterGesture();
				armScoped(button.closest("[data-composer-card]"));
			};
			if (typeof document !== "undefined") {
				document.addEventListener("click", onGesture, true);
				document.addEventListener("keydown", onGesture, true);
			}

			const sync = () => {
				const snapshot = scope.getSnapshot();
				if (snapshot === null || snapshot === undefined || snapshot.status !== "ready") {
					live = { enabled: undefined, ready: false, writable: false };
				} else {
					live = {
						enabled: snapshot.value?.enabled === true,
						ready: true,
						writable: snapshot.writable === true
					};
				}
				schedule();
			};
			sync();
			const stopSync = scope.subscribe(sync);

			ctx.effect(() => () => {
				disarmScoped();
				if (typeof document !== "undefined") {
					document.removeEventListener("click", onGesture, true);
					document.removeEventListener("keydown", onGesture, true);
				}
				stopSync();
				window.clearTimeout(toastTimer);
				for (const node of document.querySelectorAll("[" + ITEM_ATTR + "]")) node.remove();
				document.querySelector(".ac_toast")?.remove();
			}, "dsh-auto-continue: + menu toggle");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
