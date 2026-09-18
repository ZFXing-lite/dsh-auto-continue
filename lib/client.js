/**
 * dsh-auto-continue — browser half.
 *
 * Adds ONE row to the composer's "+" (plus) menu:
 *
 *    自动继续                         [ 关 ━─● ]      (off, default)
 *    自动继续                         [ ●━─ 开 ]      (on)
 *
 * The row is a single toggle: a native-styled menu item on the left carrying
 * the label 「自动继续」, and a custom slider switch on the right whose thumb
 * carries the 「开」/「关」 glyph and slides left↔right. Clicking the row flips
 * the switch; the menu stays open so the user sees the slide.
 *
 * ── Why DOM injection, and why it is disciplined ──────────────────────────
 *
 * The "+" menu's three stock items (上传图片 / 上传文件 / 命令) are HARDCODED in
 * `ui-conversation`'s InputBar. The full slot catalogue has seats for
 * `conversation.input.left/right/dock/plan/model/…` but NOTHING for the add
 * menu, so a third-party plugin has no slot to register into. Injecting the
 * row is the only way to honour "in the + menu" without patching core.
 *
 * The injection obeys rules that keep it from rotting or breaking React:
 *
 *  1. We only ever APPEND a sibling inside the already-open menu. React creates
 *     and removes only the nodes it owns; an extra trailing sibling is never
 *     targeted by its removals, so no `removeChild` race is possible.
 *  2. We never match a hashed CSS-module class name. We COPY the `className`
 *     off a real sibling `[role="menuitem"]`, so our row inherits the current
 *     look, hover state, dark theme, and any future restyle.
 *  3. We locate the menu structurally: the `[role="menu"]` inside
 *     `[data-composer-card]` whose parent also holds a `button[aria-haspopup="menu"]`.
 *  4. The menu unmounts on close, taking our node with it; the observer simply
 *     re-injects on the next open. A render-signature guard makes `render()`
 *     idempotent, so our own mutation does not re-trigger the observer forever.
 *  5. A toggle does NOT close the menu (unlike the stock action items); the
 *     user clicks outside or presses Escape to dismiss, exactly as the app does.
 *
 * ── State ─────────────────────────────────────────────────────────────────
 *
 * The switch reads and writes the host-owned `auto-continue` settings namespace
 * through `ctx.settingsScope` — DSH's own revision-fenced write path, persisted
 * by DSH, no bespoke HTTP route.
 *
 * Self-contained: consumes only `settingsScope` and the DOM.
 */
window.__ModuleLoader__.load({
	id: "dsh-auto-continue",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/** Settings namespace owned by this plugin's host half. */
		const NAMESPACE = "auto-continue";
		/** Marker attribute: one menu is injected at most once per open. */
		const ITEM_ATTR = "data-auto-continue-item";
		/** Marker attribute on the menu we already extended. */
		const MENU_ATTR = "data-auto-continue-menu";
		/** Stylesheet tag id, so a re-apply cannot duplicate the sheet. */
		const STYLE_ID = "dsh-auto-continue/menu.css";
		/** Stable class on our row, so the on/off CSS can scope to it. */
		const ROW_CLASS = "ac_row";
		const SWITCH_CLASS = "ac_switch";
		const THUMB_CLASS = "ac_thumb";

		/* ── stylesheet (design tokens only, so it follows the active theme) ── */
		const css = `
/* The toggle row reuses the native menu-item className for its chrome; this
   sheet only paints the slider switch on the right. Every colour is a design
   token, so light/dark and future restyles are inherited for free. */
.${SWITCH_CLASS}{
  flex:none;display:inline-flex;align-items:center;
  width:44px;height:24px;box-sizing:border-box;padding:2px;
  border-radius:999px;
  background:var(--dsw-alias-interactive-bg-hover-solid);
  transition:background-color .18s var(--ds-ease-in-out,ease);
  cursor:pointer;
}
.${THUMB_CLASS}{
  width:20px;height:20px;border-radius:999px;flex:none;
  background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 1px 2px rgba(0,0,0,.18);
  display:flex;align-items:center;justify-content:center;
  font-size:10px;line-height:1;font-weight:600;
  color:var(--dsw-alias-label-tertiary);
  transition:transform .18s var(--ds-ease-in-out,ease),color .18s var(--ds-ease-in-out,ease);
  transform:translateX(0);
  user-select:none;
}
/* ON: the row carries aria-checked="true". */
.${ROW_CLASS}[aria-checked="true"] .${SWITCH_CLASS}{
  background:var(--dsw-alias-state-business-primary);
}
.${ROW_CLASS}[aria-checked="true"] .${THUMB_CLASS}{
  transform:translateX(20px);
  color:var(--dsw-alias-state-business-primary);
}
.${ROW_CLASS}:disabled .${SWITCH_CLASS}{opacity:.55;cursor:default}

/* transient status toast */
.ac_toast{
  position:fixed;left:50%;bottom:24px;transform:translateX(-50%);
  z-index:3000;max-width:min(420px,calc(100vw - 32px));
  display:flex;align-items:center;gap:8px;
  padding:9px 14px;border-radius:10px;
  background:var(--dsw-specific-menu);
  border:1px solid var(--dsw-alias-border-l2);
  box-shadow:var(--dsw-shadow-lv3);
  color:var(--dsw-alias-label-primary);
  font-size:13px;line-height:19px;
  animation:ac_in .16s var(--ds-ease-in-out,ease-out);
}
.ac_toast[data-state=error]{
  border-color:var(--dsw-alias-state-error-primary);
  color:var(--dsw-alias-state-error-primary);
}
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

		/* ── transient status toast ───────────────────────────────────────────── */
		let toastTimer;
		/**
		 * Show a short status line so a toggle always has visible feedback.
		 * @param text - the message to show.
		 * @param state - "ok" or "error".
		 */
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
			toastTimer = window.setTimeout(() => {
				node?.remove();
			}, state === "error" ? 5000 : 2200);
		}

		/* ── the "+" menu: locate it structurally ────────────────────────────── */
		/**
		 * Find every open composer "+" menu.
		 *
		 * Structural contract, free of locale text and hashed class names: inside
		 * `[data-composer-card]`, a `[role="menu"]` whose parent element also owns
		 * a `button[aria-haspopup="menu"]` is the menu that "+" button opened.
		 * @returns the matching menu elements.
		 */
		function findAddMenus() {
			const found = [];
			for (const menu of document.querySelectorAll('[data-composer-card] [role="menu"]')) {
				const wrap = menu.parentElement;
				if (wrap === null) continue;
				if (wrap.querySelector(':scope > button[aria-haspopup="menu"]') === null) continue;
				found.push(menu);
			}
			return found;
		}

		/**
		 * Build the single toggle row that mirrors a native menu item's chrome.
		 * @param options - row configuration.
		 * @returns the button element.
		 */
		function buildToggleRow(options) {
			const { template, label, enabled, onToggle, disabled } = options;
			const button = document.createElement("button");
			button.type = "button";
			// menuitemcheckbox is the correct ARIA for a toggle inside a menu.
			button.setAttribute("role", "menuitemcheckbox");
			button.setAttribute(ITEM_ATTR, "");
			// Adopt the native row's styling instead of guessing a class name.
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

			// Left: the label, taking the available space so the switch pins right.
			const labelSlot = document.createElement("span");
			labelSlot.textContent = label;
			labelSlot.style.flex = "1";
			labelSlot.style.minWidth = "0";
			button.appendChild(labelSlot);

			// Right: the slider switch with its sliding thumb carrying 开/关.
			const sw = document.createElement("span");
			sw.className = SWITCH_CLASS;
			sw.setAttribute("aria-hidden", "true");
			const thumb = document.createElement("span");
			thumb.className = THUMB_CLASS;
			thumb.textContent = enabled ? "开" : "关";
			sw.appendChild(thumb);
			button.appendChild(sw);

			// Keep focus in the composer (the stock rows do the same) and stop the
			// click from closing the menu — a toggle is a setting, not an action.
			button.addEventListener("pointerdown", (event) => {
				event.preventDefault();
				event.stopPropagation();
			});
			button.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				if (disabled) return;
				onToggle();
			});
			return button;
		}

		/* ── plugin entry ─────────────────────────────────────────────────────── */
		const inject = ["settingsScope"];

		/**
		 * Register the "+" menu toggle.
		 * @param ctx - client context with `settingsScope` injected.
		 */
		function apply(ctx) {
			const scope = ctx.settingsScope.bind({ namespace: NAMESPACE });

			/** Latest known effective state; `undefined` until the namespace is ready. */
			let live = { enabled: undefined, ready: false, writable: false };

			/**
			 * Flip the switch through DSH's own settings write path.
			 * @param next - the desired state.
			 */
			const setEnabled = (next) => {
				if (!live.ready) {
					toast("自动继续：设置尚未就绪，请稍后重试", "error");
					return;
				}
				if (!live.writable) {
					toast("自动继续：本部署的设置通道不可写", "error");
					return;
				}
				if (live.enabled === next) {
					return;
				}
				// Optimistic echo so the thumb slides immediately; the settings
				// snapshot is authoritative and will re-render us if it disagrees.
				live = { ...live, enabled: next };
				render();
				void scope.set("enabled", next).then(
					() => {
						toast(next ? "自动继续：已开启（中断后自动发送「继续」）" : "自动继续：已关闭", "ok");
					},
					(error) => {
						toast(`自动继续：切换失败（${error instanceof Error ? error.message : String(error)}）`, "error");
					}
				);
			};

			/**
			 * Append the toggle row to one open add menu, once.
			 * @param menu - the open menu element.
			 */
			function injectInto(menu) {
				if (menu.hasAttribute(MENU_ATTR)) return;
				const template = [...menu.querySelectorAll('[role="menuitem"]')]
					.find(node => !node.hasAttribute(ITEM_ATTR));
				if (template === undefined) return;
				menu.setAttribute(MENU_ATTR, "");

				const disabled = !live.ready || !live.writable;
				menu.appendChild(buildToggleRow({
					template,
					label: "自动继续",
					enabled: live.enabled === true,
					disabled,
					onToggle: () => {
						// Clicking the row flips the current effective state.
						setEnabled(live.enabled !== true);
					}
				}));
			}

			/**
			 * Signature of the state last written into one menu element.
			 *
			 * This is what makes `render()` idempotent, and idempotence is
			 * REQUIRED: our own insertion is a DOM mutation the observer sees, and
			 * an unconditional rebuild would mutate again — a livelock that keeps
			 * detaching the row from under the user's pointer.
			 */
			const rendered = new WeakMap();

			/**
			 * Re-inject after a settings change. Writes happen only when the
			 * rendered state actually differs from the live one.
			 */
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

			/* Coalesced through rAF: a streaming turn mutates the DOM constantly,
			 * and one query per frame is far cheaper than one per mutation. */
			let queued = false;
			const schedule = () => {
				if (queued) return;
				queued = true;
				(typeof requestAnimationFrame === "function" ? requestAnimationFrame : window.setTimeout)(() => {
					queued = false;
					render();
				});
			};

			const observer = typeof MutationObserver === "undefined" ? undefined : new MutationObserver(schedule);
			if (observer !== undefined) {
				observer.observe(document.documentElement, { childList: true, subtree: true });
			}

			// One subscription drives both the cached state and the re-render.
			const sync = () => {
				const snapshot = scope.getSnapshot();
				if (snapshot === null || snapshot === undefined || snapshot.status !== "ready") {
					live = { enabled: undefined, ready: false, writable: false };
				} else {
					live = {
						// The host default is `false` (关); only an explicit `true` means on.
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
				observer?.disconnect();
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
