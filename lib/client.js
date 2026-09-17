/**
 * dsh-auto-continue — browser half.
 *
 * Adds the plugin's two switches to the composer's "+" (plus) menu:
 *
 *    ✓ 开启自动继续
 *      关闭自动继续
 *
 * ── Why DOM injection, and why it is disciplined ──────────────────────────
 *
 * The "+"菜单's three stock items (上传图片 / 上传文件 / 命令) are HARDCODED in
 * `ui-conversation`'s InputBar. The full slot catalogue
 * (`ui-conversation/src/client/contract/slots.ts`) has seats for
 * `conversation.input.left/right/dock/plan/model/…` but NOTHING for the add
 * menu, so a third-party plugin has no slot to register into. Injecting the
 * items is the only way to honour "in the + menu" without patching core.
 *
 * The injection therefore obeys rules that keep it from rotting or breaking
 * React's reconciliation:
 *
 *  1. We only ever APPEND siblings inside the already-open menu. React creates
 *     and removes only the nodes it owns; extra trailing siblings are never
 *     targeted by its removals, so no `removeChild` race is possible. We never
 *     clear or reorder existing children.
 *  2. We never match a hashed CSS-module class name. Instead we COPY the
 *     `className` off a real sibling `[role="menuitem"]`, so our rows inherit
 *     the current look, hover state, dark theme, and any future restyle.
 *  3. We locate the menu structurally, not by text or locale: the add menu is
 *     the `[role="menu"]` inside `[data-composer-card]` whose parent also holds
 *     a `button[aria-haspopup="menu"]` — the "+" button itself.
 *  4. The menu unmounts on close, taking our nodes with it; the observer simply
 *     re-injects on the next open. No teardown bookkeeping is needed, and an
 *     `data-` marker keeps a single open menu from being injected twice.
 *  5. Closing reuses the app's OWN path: the menu installs a capture-phase
 *     Escape listener, so we dispatch Escape rather than inventing a close.
 *
 * ── State ─────────────────────────────────────────────────────────────────
 *
 * The switches read and write the host-owned `auto-continue` settings
 * namespace through `ctx.settingsScope`. That means the toggle goes through
 * DSH's own revision-fenced settings write path and is persisted by DSH —
 * no bespoke HTTP route, and the state survives a restart.
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

		/* ── stylesheet (design tokens only, so it follows the active theme) ── */
		const CSS_PREFIX = "ac_";
		const css = `
.${CSS_PREFIX}toast{
  position:fixed;left:50%;bottom:24px;transform:translateX(-50%);
  z-index:3000;max-width:min(420px,calc(100vw - 32px));
  display:flex;align-items:center;gap:8px;
  padding:9px 14px;border-radius:10px;
  background:var(--dsw-specific-menu);
  border:1px solid var(--dsw-alias-border-l2);
  box-shadow:var(--dsw-shadow-lv3);
  color:var(--dsw-alias-label-primary);
  font-size:13px;line-height:19px;
  animation:${CSS_PREFIX}in .16s var(--ds-ease-in-out,ease-out);
}
.${CSS_PREFIX}toast[data-state=error]{
  border-color:var(--dsw-alias-state-error-primary);
  color:var(--dsw-alias-state-error-primary);
}
.${CSS_PREFIX}icon{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center}
@keyframes ${CSS_PREFIX}in{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}
@media (prefers-reduced-motion:reduce){.${CSS_PREFIX}toast{animation:none}}
`;
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(STYLE_ID) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-auto-continue";
			tag.dataset.pluginCss = STYLE_ID;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		/* ── icon (hand-drawn: the client bundle cannot import the app's icon set) ── */
		const NS = "http://www.w3.org/2000/svg";
		/**
		 * Build a 16px status glyph in the app's own outline language.
		 * @param active - whether this row is the currently effective switch.
		 * @returns a fresh SVG element.
		 */
		function statusIcon(active) {
			const svg = document.createElementNS(NS, "svg");
			svg.setAttribute("viewBox", "0 0 16 16");
			svg.setAttribute("width", "14");
			svg.setAttribute("height", "14");
			svg.setAttribute("aria-hidden", "true");
			svg.style.display = "block";
			if (active) {
				// A filled disc with a check: "this one is in effect".
				const circle = document.createElementNS(NS, "circle");
				circle.setAttribute("cx", "8");
				circle.setAttribute("cy", "8");
				circle.setAttribute("r", "7");
				circle.setAttribute("fill", "currentColor");
				svg.appendChild(circle);
				const check = document.createElementNS(NS, "path");
				check.setAttribute("d", "M4.6 8.4 L7 10.8 L11.5 5.6");
				check.setAttribute("fill", "none");
				check.setAttribute("stroke", "var(--dsw-specific-menu, #fff)");
				check.setAttribute("stroke-width", "1.8");
				check.setAttribute("stroke-linecap", "round");
				check.setAttribute("stroke-linejoin", "round");
				svg.appendChild(check);
			} else {
				const ring = document.createElementNS(NS, "circle");
				ring.setAttribute("cx", "8");
				ring.setAttribute("cy", "8");
				ring.setAttribute("r", "6.2");
				ring.setAttribute("fill", "none");
				ring.setAttribute("stroke", "currentColor");
				ring.setAttribute("stroke-width", "1.4");
				ring.setAttribute("opacity", "0.55");
				svg.appendChild(ring);
			}
			return svg;
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
			let node = document.querySelector("." + CSS_PREFIX + "toast");
			if (node === null) {
				node = document.createElement("div");
				node.className = CSS_PREFIX + "toast";
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
		 * Structural contract, deliberately free of locale text and hashed
		 * class names: inside `[data-composer-card]`, a `[role="menu"]` whose
		 * parent element also owns a `button[aria-haspopup="menu"]` is the menu
		 * that "+" button opened.
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
		 * Build one switch row that mirrors a native menu item's appearance.
		 * @param options - row configuration.
		 * @returns the button element.
		 */
		function buildItem(options) {
			const { template, label, active, onSelect, disabled } = options;
			const button = document.createElement("button");
			button.type = "button";
			button.setAttribute("role", "menuitem");
			button.setAttribute(ITEM_ATTR, "");
			// Adopt the native row's styling instead of guessing a class name.
			if (typeof template.className === "string" && template.className.length > 0) {
				button.className = template.className;
			}
			button.setAttribute("aria-checked", active ? "true" : "false");
			if (disabled) {
				button.disabled = true;
				button.title = "设置不可用：本部署没有可写的 settings 通道";
			}

			// The native icon slot is a span carrying the icon; mirror that so
			// the label lines up with the stock rows.
			const iconSlot = document.createElement("span");
			const nativeIcon = template.querySelector("span");
			if (nativeIcon !== null) iconSlot.className = nativeIcon.className;
			iconSlot.setAttribute("aria-hidden", "true");
			iconSlot.appendChild(statusIcon(active));
			button.appendChild(iconSlot);
			button.appendChild(document.createTextNode(label));

			button.addEventListener("pointerdown", (event) => {
				// Keep focus in the composer, exactly like the stock rows.
				event.preventDefault();
				event.stopPropagation();
			});
			button.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				if (disabled) return;
				onSelect();
			});
			return button;
		}

		/* ── plugin entry ─────────────────────────────────────────────────────── */
		const inject = ["settingsScope"];

		/**
		 * Register the "+" menu switches.
		 * @param ctx - client context with `settingsScope` injected.
		 */
		function apply(ctx) {
			const scope = ctx.settingsScope.bind({ namespace: NAMESPACE });

			/** Latest known effective state; `undefined` until the namespace is ready. */
			let live = { enabled: undefined, ready: false, writable: false };

			// One subscription drives both the cached state and the re-render, so
			// a settings change and its visible effect can never disagree.
			// Declared here, STARTED below (after `schedule` exists): `sync()`
			// runs a render, and a `const` binding read before its own
			// initializer throws.
			const sync = () => {
				const snapshot = scope.getSnapshot();
				if (snapshot === null || snapshot === undefined || snapshot.status !== "ready") {
					live = { enabled: undefined, ready: false, writable: false };
				} else {
					live = {
						// The host default is `true`; only an explicit `false` means off.
						enabled: snapshot.value?.enabled !== false,
						ready: true,
						writable: snapshot.writable === true
					};
				}
				schedule();
			};

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
					toast(next ? "自动继续：已经是开启状态" : "自动继续：已经是关闭状态", "ok");
					return;
				}
				// Optimistic echo so the row marks itself immediately; the
				// settings snapshot is authoritative and will re-render us.
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

			/** Take over the keyboard focus-free close path the app already owns. */
			const closeMenu = (menu) => {
				menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
			};

			/**
			 * Append the two switch rows to one open add menu, once.
			 * @param menu - the open menu element.
			 */
			function injectInto(menu) {
				if (menu.hasAttribute(MENU_ATTR)) return;
				// The template must be a stock row: ours must not exist yet, and
				// cloning our own row would compound its class list.
				const template = [...menu.querySelectorAll('[role="menuitem"]')]
					.find(node => !node.hasAttribute(ITEM_ATTR));
				if (template === undefined) return;
				menu.setAttribute(MENU_ATTR, "");

				const disabled = !live.ready || !live.writable;
				menu.appendChild(buildItem({
					template,
					label: "开启自动继续",
					active: live.enabled === true,
					disabled,
					onSelect: () => {
						setEnabled(true);
						closeMenu(menu);
					}
				}));
				menu.appendChild(buildItem({
					template,
					label: "关闭自动继续",
					active: live.enabled === false,
					disabled,
					onSelect: () => {
						setEnabled(false);
						closeMenu(menu);
					}
				}));
			}

			/**
			 * Signature of the state last written into one menu element.
			 *
			 * This is what makes `render()` idempotent, and idempotence is
			 * REQUIRED, not an optimisation: our own insertion is a DOM
			 * mutation, the observer sees it, and a `render()` that rebuilt
			 * unconditionally would mutate again — a livelock that keeps
			 * detaching the row from under the user's pointer. Keyed by the
			 * menu element, so a reopened menu (a fresh element) always gets a
			 * first render, while a steady menu gets none.
			 */
			const rendered = new WeakMap();

			/**
			 * Re-inject after a settings change: the menu may still be open, and
			 * its marks must reflect the new state. Writes happen only when the
			 * rendered state actually differs from the live one.
			 */
			function render() {
				if (typeof document === "undefined") return;
				const signature = `${live.ready ? "ready" : "pending"}|${live.writable ? "rw" : "ro"}`
					+ `|${live.enabled === true ? "on" : live.enabled === false ? "off" : "unknown"}`;
				for (const menu of findAddMenus()) {
					const present = menu.querySelector("[" + ITEM_ATTR + "]") !== null;
					if (rendered.get(menu) === signature && present) continue;
					// Rebuild rather than mutate: the rows are ours, and a rebuild
					// cannot leave a stale class list or an orphaned listener.
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

			// Now that `schedule`/`render` exist, take the first reading and
			// subscribe. A settings namespace that resolves later still lands
			// here through the same subscription.
			sync();
			const stopSync = scope.subscribe(sync);

			ctx.effect(() => () => {
				observer?.disconnect();
				stopSync();
				window.clearTimeout(toastTimer);
				for (const node of document.querySelectorAll("[" + ITEM_ATTR + "]")) node.remove();
				document.querySelector("." + CSS_PREFIX + "toast")?.remove();
			}, "dsh-auto-continue: + menu switches");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
