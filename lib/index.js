/**
 * dsh-auto-continue — host half.
 *
 * Keeps a conversation moving when a turn is interrupted by something that is
 * not the user's decision: an exhausted model retry, a provider error, a
 * request timeout, or output truncated at the token ceiling.
 *
 * ── Why this shape ────────────────────────────────────────────────────────
 *
 * Every one of those causes converges on the SAME durable fact: a turn ends
 * and the session log records `turn/end` with a structured reason
 * (`completed` / `aborted` / `blocked` / `error` / `max-tokens`). So the plugin
 * observes one event instead of guessing at each cause, and it deliberately
 * does NOT touch `agent/request-error`: the retry policy belongs to
 * `llm-retry` and the provider's own `retryPolicy` config. This plugin only
 * takes over AFTER retries have already failed to save the turn.
 *
 * The continuation itself is a first-class DSH operation:
 * `agent.followup(message)` — "queue an ordinary follow-up turn and wake the
 * driver". It is the same public path `goal-round-driver` uses for goal
 * rounds, so nothing private is reached into.
 *
 * ── Honesty about provenance ──────────────────────────────────────────────
 *
 * The injected message declares `source: { kind: 'plugin', plugin, form:'notice' }`
 * rather than impersonating `{ kind: 'user' }`. DSH's own rule is that
 * non-human producers must carry their own source, because `kind: 'user'`
 * grants "direct human input" authority elsewhere (e.g. goal activation).
 * The browser renders a `plugin` source as an expandable context row, so the
 * user still SEES the continuation and can expand it to read the text sent.
 *
 * ── Hard fences (each one prevents a specific misfire) ────────────────────
 *
 *  1. A user stop is absolute. `aborted` with cause `user` NEVER continues,
 *     with no configuration to override it.
 *  2. Human input always wins. A real `user/message` clears the streak, and a
 *     turn that starts while a continuation is pending cancels that pending
 *     send.
 *  3. Never interrupt a running turn — continuation is only dispatched while
 *     the agent is idle.
 *  4. Bounded blast radius. `maxStreak` caps consecutive automatic
 *     continuations so an error→continue→error loop cannot burn tokens
 *     forever; the plugin then stands down and logs a warning.
 *  5. Liveness is re-checked at send time (`ctx.agents.get(id) === agent`).
 *  6. Subagents are out of scope by default: a parent orchestrator owns its
 *     children's turn structure, so interfering would fight that logic.
 *  7. No "stall watchdog". A long compile or test run is legitimately silent
 *     for minutes; a naive inactivity timeout would misfire on exactly the
 *     work this plugin exists to protect. Missing a rescue is recoverable;
 *     killing healthy work is not.
 *
 * @module auto-continue
 */
import z from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";

/** Cordis plugin name (must match the loader row id in cordis.patch.yml). */
const name = "auto-continue";

/**
 * Host services required at apply time.
 *
 * `agents` is the only hard requirement (registry + `followup`). `settings` is
 * injected optionally below so a minimal profile without a settings surface
 * still loads the plugin from its row config instead of failing to mount.
 */
const inject = ["agents"];

/** Settings namespace this plugin owns. */
const NAMESPACE = "auto-continue";

/** Defaults; the loader row's `config` is the `base` layer over these. */
const DEFAULTS = Object.freeze({
	enabled: true,
	prompt: "继续",
	delayMs: 1500,
	maxStreak: 12,
	onError: true,
	onMaxTokens: true,
	onAborted: false,
	onBlocked: false,
	includeSubagents: false,
	announce: true
});

/** Settings schema for the `auto-continue` namespace (also validates row config). */
const SettingsSchema = z.object({
	enabled: z.boolean().default(DEFAULTS.enabled),
	prompt: z.string().default(DEFAULTS.prompt),
	delayMs: z.natural().min(0).max(600_000).default(DEFAULTS.delayMs),
	maxStreak: z.natural().min(1).max(1000).default(DEFAULTS.maxStreak),
	onError: z.boolean().default(DEFAULTS.onError),
	onMaxTokens: z.boolean().default(DEFAULTS.onMaxTokens),
	onAborted: z.boolean().default(DEFAULTS.onAborted),
	onBlocked: z.boolean().default(DEFAULTS.onBlocked),
	includeSubagents: z.boolean().default(DEFAULTS.includeSubagents),
	announce: z.boolean().default(DEFAULTS.announce)
});

/** Human-readable zh labels for the reasons this plugin reports. */
const REASON_TEXT = {
	error: "回合失败",
	"max-tokens": "输出达到长度上限",
	aborted: "回合被中止",
	blocked: "回合被阻断"
};

/** Render any thrown value as a log-safe message. */
function renderThrown(value) {
	return value instanceof Error ? value.message : String(value);
}

/**
 * Decide whether one ended turn warrants an automatic continuation.
 * @param reason - the `turn/end` reason recorded by the session log.
 * @param config - the live resolved settings document.
 * @returns a short human-readable cause, or `undefined` to stand down.
 */
function continuationCause(reason, config) {
	if (reason === undefined || reason === null || typeof reason !== "object") return undefined;
	switch (reason.kind) {
		// Normal completion and log-repair bookkeeping have nothing to continue.
		case "completed":
		case "interrupted":
			return undefined;
		case "error":
			return config.onError ? "error" : undefined;
		case "max-tokens":
			return config.onMaxTokens ? "max-tokens" : undefined;
		case "blocked":
			return config.onBlocked ? "blocked" : undefined;
		case "aborted": {
			// A user stop is final and not configurable: the user asked for the
			// turn to stop, and an automatic "继续" would directly contradict it.
			const cause = reason.reason;
			if (cause !== null && typeof cause === "object" && cause.kind === "user") return undefined;
			return config.onAborted ? "aborted" : undefined;
		}
		default:
			return undefined;
	}
}

/** One agent's continuation bookkeeping. */
function freshState() {
	return { streak: 0, pending: undefined, lastCause: undefined, retriedInTurn: false };
}

/**
 * Install the automatic continuation engine.
 * @param ctx - host context with the `agents` service injected.
 * @param config - loader row config; the settings `base` layer.
 */
function apply(ctx, config = {}) {
	ctx.logger.info("auto-continue: plugin active");

	/** Live configuration; falls back to row config without a settings surface. */
	let live = Object.freeze({ ...DEFAULTS, ...config });

	const resolveRow = () => {
		try {
			return Object.freeze(SettingsSchema({ ...DEFAULTS, ...config }));
		} catch (error) {
			ctx.logger.warn(`auto-continue: invalid row config, using defaults: ${renderThrown(error)}`);
			return Object.freeze({ ...DEFAULTS });
		}
	};
	live = resolveRow();

	// The settings namespace is the shared switch: the browser half writes
	// `enabled` through DSH's own settings scope, so a toggle needs no bespoke
	// HTTP route and survives a restart.
	try {
		ctx.inject(["settings"], (sctx) => {
			const scope = sctx.settings.register(NAMESPACE, SettingsSchema, { base: resolveRow() });
			live = scope.get();
			scope.watch(() => {
				live = scope.get();
				ctx.logger.info(`auto-continue: configuration changed (enabled=${live.enabled}, prompt=${JSON.stringify(live.prompt)})`);
				// Turning the switch off must also cancel anything already armed.
				if (!live.enabled) {
					for (const [agent, state] of states) {
						if (state.pending !== undefined) {
							clearTimeout(state.pending.timer);
							state.pending = undefined;
						}
						void agent;
					}
				}
			});
		});
	} catch (error) {
		ctx.logger.warn(`auto-continue: settings namespace unavailable, using row config: ${renderThrown(error)}`);
	}

	/** Per-agent bookkeeping, keyed by the live agent handle. */
	const states = new Map();

	/** Read (or create) the bookkeeping for one live agent. */
	function stateFor(agent) {
		let state = states.get(agent);
		if (state === undefined) {
			state = freshState();
			states.set(agent, state);
		}
		return state;
	}

	/** Cancel an armed continuation for one agent, if any. */
	function disarm(state, why) {
		if (state.pending === undefined) return;
		clearTimeout(state.pending.timer);
		state.pending = undefined;
		if (why !== undefined) ctx.logger.info(`auto-continue: cancelled pending continuation (${why})`);
	}

	/** Whether this agent is in scope for automatic continuation. */
	function inScope(agent) {
		if (live.includeSubagents) return true;
		// Root agents only: `roots()` is the runtime parent relation, so a
		// subagent is excluded even when durable session lineage says otherwise.
		return ctx.agents.roots().includes(agent);
	}

	/**
	 * Arm one continuation after the configured settle delay.
	 * @param agent - the live agent whose turn just ended.
	 * @param cause - the short cause label used in the log and the summary.
	 */
	function arm(agent, cause) {
		const state = stateFor(agent);
		disarm(state);

		if (state.streak >= live.maxStreak) {
			ctx.logger.warn(
				`auto-continue: agent "${agent.id}" hit the consecutive-continuation limit `
				+ `(${live.maxStreak}); standing down until the next human message`,
			);
			return;
		}

		const timer = setTimeout(() => {
			state.pending = undefined;
			void dispatch(agent, cause);
		}, live.delayMs);
		// Never hold the process open for a pending continuation.
		timer.unref?.();
		state.pending = { timer, cause };
		ctx.logger.info(
			`auto-continue: armed a continuation for agent "${agent.id}" in ${live.delayMs}ms `
			+ `(cause=${cause}, streak=${state.streak}/${live.maxStreak})`,
		);
	}

	/**
	 * Send the continuation if every fence still holds.
	 * @param agent - the agent that ended its turn.
	 * @param cause - the cause label recorded when the continuation was armed.
	 */
	async function dispatch(agent, cause) {
		// Re-read the configuration at send time: the user may have flipped the
		// switch off during the settle delay.
		if (!live.enabled) {
			ctx.logger.info(`auto-continue: skipping continuation for agent "${agent.id}" (disabled)`);
			return;
		}
		// Liveness: the agent may have been disposed or replaced during the wait.
		if (ctx.agents.get(agent.id) !== agent) {
			ctx.logger.info(`auto-continue: skipping continuation for agent "${agent.id}" (no longer live)`);
			return;
		}
		// Never interrupt an active turn — a human message or queued work may
		// have started one while we waited.
		if (agent.status !== "idle") {
			ctx.logger.info(`auto-continue: skipping continuation for agent "${agent.id}" (status=${agent.status})`);
			return;
		}
		if (!inScope(agent)) {
			ctx.logger.info(`auto-continue: skipping continuation for agent "${agent.id}" (out of scope)`);
			return;
		}

		const state = stateFor(agent);
		if (state.streak >= live.maxStreak) return;

		const label = REASON_TEXT[cause] ?? cause;
		const retryNote = state.retriedInTurn ? "，本轮模型曾重试" : "";
		const text = typeof live.prompt === "string" && live.prompt.length > 0 ? live.prompt : DEFAULTS.prompt;
		const message = createUserMessage({
			content: [{ type: "text", text }],
			source: {
				kind: "plugin",
				plugin: "auto-continue",
				form: "notice",
				summary: `自动继续（${label}${retryNote}，第 ${state.streak + 1}/${live.maxStreak} 次）`
			}
		});

		try {
			agent.followup(message);
		} catch (error) {
			state.pending = undefined;
			ctx.logger.warn(`auto-continue: could not queue continuation for agent "${agent.id}": ${renderThrown(error)}`);
			return;
		}
		state.streak += 1;
		state.lastCause = cause;
		state.retriedInTurn = false;
		ctx.logger.info(`auto-continue: sent "${text}" to agent "${agent.id}" (cause=${cause}, streak=${state.streak}/${live.maxStreak})`);

		// `announce` is reserved for future surface reporting; the durable log
		// already carries the continuation as a plugin-source user message.
		void live.announce;
	}

	ctx.effect(function* () {
		ctx.on("agent/disposed", ({ agent }) => {
			const state = states.get(agent);
			if (state !== undefined) disarm(state);
			states.delete(agent);
		});

		ctx.on("session/event", (session, event) => {
			const agent = ctx.agents.get(session.id);
			if (agent === undefined) return;
			const state = states.get(agent);

			switch (event.type) {
				case "user/message": {
					const source = event.data?.source;
					// Only a REAL human message clears the streak and cancels a
					// pending continuation. Our own plugin notice, goal rounds,
					// and injected context do not count as human takeover.
					if (source?.kind === "user") {
						if (state !== undefined) {
							disarm(state, "human message arrived");
							state.streak = 0;
							state.retriedInTurn = false;
						}
					}
					return;
				}
				case "llm/retry": {
					if (state !== undefined) state.retriedInTurn = true;
					return;
				}
				case "turn/start": {
					// A new turn started before our timer fired: the situation
					// resolved itself, so the armed continuation is stale.
					if (state !== undefined) disarm(state, "a new turn started");
					return;
				}
				case "turn/end": {
					if (state !== undefined) disarm(state, "the turn ended again");
					if (!live.enabled) return;
					if (!inScope(agent)) return;
					const cause = continuationCause(event.data?.reason, live);
					if (cause === undefined) {
						if (state !== undefined) state.retriedInTurn = false;
						return;
					}
					arm(agent, cause);
					return;
				}
				default:
					return;
			}
		});

		ctx.on("agent/status", ({ agent, status }) => {
			// Busy again means the user (or queued work) owns the agent now.
			if (status === "running") {
				const state = states.get(agent);
				if (state !== undefined) disarm(state, "the agent became busy");
			}
		});

		yield () => {
			for (const state of states.values()) disarm(state);
			states.clear();
		};
	}, "auto-continue lifecycle");
}

export { apply, inject, name, DEFAULTS, SettingsSchema, NAMESPACE, continuationCause };
