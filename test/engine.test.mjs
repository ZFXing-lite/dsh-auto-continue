/**
 * dsh-auto-continue — host-engine behaviour test.
 *
 * Drives the real `apply()` from `lib/index.js` against a minimal fake cordis
 * context and a fake agent, then asserts the decisions the engine makes. This
 * is the part a browser probe cannot reach: what the plugin does about a turn
 * that ended badly, and — more importantly — what it refuses to do.
 *
 * Run: node test/engine.test.mjs
 */
import assert from "node:assert/strict";
import { apply, continuationCause, DEFAULTS } from "../lib/index.js";

/* ── fake cordis context ─────────────────────────────────────────────────── */

/** A context stand-in that records listeners and honours `ctx.effect`. */
function fakeContext(overrides = {}) {
	const listeners = new Map();
	const cleanups = [];
	const warnings = [];
	const ctx = {
		logger: {
			info: () => {},
			warn: (message) => { warnings.push(String(message)) },
			error: () => {},
		},
		on(name, handler) {
			const list = listeners.get(name) ?? [];
			list.push(handler);
			listeners.set(name, list);
			return () => {
				const current = listeners.get(name) ?? [];
				listeners.set(name, current.filter((entry) => entry !== handler));
			};
		},
		// The plugin injects `settings` optionally; here it is absent, which is
		// exactly the minimal-profile path (row config stands).
		inject() {
			return undefined;
		},
		effect(body, label) {
			if (typeof body === "function" && body.constructor?.name === "GeneratorFunction") {
				const iterator = body.call(ctx);
				let step = iterator.next();
				while (!step.done) {
					cleanups.push(step.value);
					step = iterator.next();
				}
			} else if (typeof body === "function") {
				const returned = body();
				if (typeof returned === "function") cleanups.push(returned);
			}
			void label;
		},
		...overrides,
	};
	return {
		ctx,
		warnings,
		emit(name, ...args) {
			for (const handler of listeners.get(name) ?? []) handler(...args);
		},
		listenerCount: (name) => (listeners.get(name) ?? []).length,
		async teardown() {
			for (const cleanup of cleanups.reverse()) await cleanup();
		},
	};
}

/** A fake live agent that records the messages the plugin sends it. */
function fakeAgent({ id = "s1", status = "idle", root = true } = {}) {
	return {
		id,
		status,
		session: { id, events: [] },
		sent: [],
		followup(message) {
			this.sent.push(message);
		},
		isRoot: root,
	};
}

/** Build a harness with one registry holding the given agents. */
function harness(agents, config) {
	const registry = {
		roots: () => agents.filter((agent) => agent.isRoot),
		get: (id) => agents.find((agent) => agent.id === id),
		list: () => [...agents],
	};
	const fake = fakeContext();
	apply(fake.ctx, config);
	// The plugin reads `ctx.agents` lazily at event time, so patch it in after
	// apply (which is what the injected service would provide).
	fake.ctx.agents = registry;
	return fake;
}

/** Let the plugin's settle timer fire. */
const settle = (ms = 2500) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── 1. pure decision table ──────────────────────────────────────────────── */

const on = { ...DEFAULTS };
assert.equal(continuationCause(undefined, on), undefined, "missing reason never continues");
assert.equal(continuationCause({ kind: "completed" }, on), undefined, "a completed turn is not continued");
assert.equal(continuationCause({ kind: "interrupted" }, on), undefined, "log repair is not continued");
assert.equal(continuationCause({ kind: "error", error: { message: "boom", code: "SERVER" } }, on), "error", "a failed turn is continued");
assert.equal(continuationCause({ kind: "max-tokens" }, on), "max-tokens", "a truncated turn is continued");
assert.equal(continuationCause({ kind: "blocked" }, on), undefined, "blocked is off by default");
assert.equal(continuationCause({ kind: "blocked" }, { ...on, onBlocked: true }), "blocked", "blocked can be opted in");
assert.equal(continuationCause({ kind: "aborted", reason: { kind: "user" } }, { ...on, onAborted: true }), undefined,
	"a USER stop is never continued, even with onAborted set");
assert.equal(continuationCause({ kind: "aborted", reason: { kind: "parent" } }, { ...on, onAborted: true }), "aborted",
	"a non-user abort is continued only when opted in");
assert.equal(continuationCause({ kind: "error" }, { ...on, onError: false }), undefined, "onError=false stands down");
assert.equal(continuationCause({ kind: "max-tokens" }, { ...on, onMaxTokens: false }), undefined, "onMaxTokens=false stands down");
console.log("decision table: OK");

/* ── 2. an errored turn produces exactly one «继续» ───────────────────────── */

{
	const agent = fakeAgent();
	const h = harness([agent]);
	h.emit("agent/created", { agent });
	h.emit("session/event", { id: agent.id }, { type: "turn/end", data: { turn: 1, reason: { kind: "error", error: { message: "retries exhausted", code: "SERVER" } } } });
	assert.equal(agent.sent.length, 0, "the continuation waits out the settle delay first");
	await settle();
	assert.equal(agent.sent.length, 1, "the failed turn was continued exactly once");
	const message = agent.sent[0];
	assert.equal(message.role, "user");
	assert.deepEqual(message.content, [{ type: "text", text: "继续" }]);
	assert.equal(message.source.kind, "plugin", "the message declares its real producer");
	assert.equal(message.source.plugin, "auto-continue");
	assert.equal(message.source.form, "notice");
	assert.match(message.source.summary, /自动继续/, "the summary explains the row");
	assert.match(message.source.summary, /回合失败/, "the summary names the cause");
	await h.teardown();
	console.log("error turn -> one 继续: OK");
}

/* ── 3. a user stop is honoured ──────────────────────────────────────────── */

{
	const agent = fakeAgent();
	const h = harness([agent], { onAborted: true });
	h.emit("session/event", { id: agent.id }, { type: "turn/end", data: { turn: 1, reason: { kind: "aborted", reason: { kind: "user" } } } });
	await settle();
	assert.equal(agent.sent.length, 0, "the user pressed stop; the plugin must not argue");
	await h.teardown();
	console.log("user stop -> no 继续: OK");
}

/* ── 4. a completed turn produces nothing ────────────────────────────────── */

{
	const agent = fakeAgent();
	const h = harness([agent]);
	h.emit("session/event", { id: agent.id }, { type: "turn/end", data: { turn: 2, reason: { kind: "completed" } } });
	await settle();
	assert.equal(agent.sent.length, 0, "nothing to continue after a clean finish");
	await h.teardown();
	console.log("completed turn -> no 继续: OK");
}

/* ── 5. the master switch ────────────────────────────────────────────────── */

{
	const agent = fakeAgent();
	const h = harness([agent], { enabled: false });
	h.emit("session/event", { id: agent.id }, { type: "turn/end", data: { turn: 1, reason: { kind: "error", error: { message: "x", code: "SERVER" } } } });
	await settle();
	assert.equal(agent.sent.length, 0, "the switch off means no automatic continuation");
	await h.teardown();
	console.log("enabled=false -> no 继续: OK");
}

/* ── 6. human takeover cancels an armed continuation ─────────────────────── */

{
	const agent = fakeAgent();
	const h = harness([agent]);
	h.emit("session/event", { id: agent.id }, { type: "turn/end", data: { turn: 1, reason: { kind: "error", error: { message: "x", code: "SERVER" } } } });
	// The user types while the continuation is still waiting out its delay.
	h.emit("session/event", { id: agent.id }, { type: "user/message", data: { source: { kind: "user" } } });
	await settle();
	assert.equal(agent.sent.length, 0, "a human message outranks the armed continuation");
	await h.teardown();
	console.log("human takeover -> armed continuation cancelled: OK");
}

/* ── 7. the plugin's own notice is not human takeover ────────────────────── */

{
	const agent = fakeAgent();
	const h = harness([agent]);
	// A plugin-sourced message (our own, or another plugin's) must NOT reset
	// the streak, or the cap could never be reached.
	h.emit("session/event", { id: agent.id }, { type: "user/message", data: { source: { kind: "plugin", plugin: "auto-continue" } } });
	h.emit("session/event", { id: agent.id }, { type: "turn/end", data: { turn: 1, reason: { kind: "error", error: { message: "x", code: "SERVER" } } } });
	await settle();
	assert.equal(agent.sent.length, 1, "a plugin-sourced message still allows continuation");
	await h.teardown();
	console.log("plugin source is not human takeover: OK");
}

/* ── 8. never interrupt a running turn ───────────────────────────────────── */

{
	const agent = fakeAgent();
	const h = harness([agent]);
	h.emit("session/event", { id: agent.id }, { type: "turn/end", data: { turn: 1, reason: { kind: "error", error: { message: "x", code: "SERVER" } } } });
	agent.status = "running"; // work resumed during the settle delay
	await settle();
	assert.equal(agent.sent.length, 0, "a busy agent is left alone");
	await h.teardown();
	console.log("running agent -> no 继续: OK");
}

/* ── 9. the streak cap stops an error loop ───────────────────────────────── */

{
	const agent = fakeAgent();
	const h = harness([agent], { maxStreak: 2, delayMs: 0 });
	for (let turn = 1; turn <= 5; turn += 1) {
		h.emit("session/event", { id: agent.id }, { type: "turn/end", data: { turn, reason: { kind: "error", error: { message: "loop", code: "SERVER" } } } });
		await settle(80);
	}
	assert.equal(agent.sent.length, 2, `the cap must stop the loop (sent ${String(agent.sent.length)})`);
	assert.ok(h.warnings.some((line) => /consecutive-continuation limit/.test(line)), "the stand-down is reported");
	await h.teardown();
	console.log("streak cap -> loop stopped: OK");
}

/* ── 10. a human message re-arms the cap ─────────────────────────────────── */

{
	const agent = fakeAgent();
	const h = harness([agent], { maxStreak: 1, delayMs: 0 });
	const fail = (turn) => h.emit("session/event", { id: agent.id }, { type: "turn/end", data: { turn, reason: { kind: "error", error: { message: "x", code: "SERVER" } } } });
	fail(1);
	await settle(80);
	assert.equal(agent.sent.length, 1);
	fail(2);
	await settle(80);
	assert.equal(agent.sent.length, 1, "still capped");
	h.emit("session/event", { id: agent.id }, { type: "user/message", data: { source: { kind: "user" } } });
	fail(3);
	await settle(80);
	assert.equal(agent.sent.length, 2, "a human message gives the plugin its budget back");
	await h.teardown();
	console.log("human message re-arms the cap: OK");
}

/* ── 11. a disposed agent is not written to ──────────────────────────────── */

{
	const agent = fakeAgent();
	const h = harness([agent]);
	h.emit("session/event", { id: agent.id }, { type: "turn/end", data: { turn: 1, reason: { kind: "error", error: { message: "x", code: "SERVER" } } } });
	h.emit("agent/disposed", { agent });
	await settle();
	assert.equal(agent.sent.length, 0, "a disposed agent must not receive a continuation");
	await h.teardown();
	console.log("disposed agent -> no 继续: OK");
}

/* ── 12. subagents are out of scope by default ───────────────────────────── */

{
	const parent = fakeAgent({ id: "root" });
	const child = fakeAgent({ id: "child", root: false });
	const h = harness([parent, child]);
	h.emit("session/event", { id: child.id }, { type: "turn/end", data: { turn: 1, reason: { kind: "error", error: { message: "x", code: "SERVER" } } } });
	await settle();
	assert.equal(child.sent.length, 0, "a subagent's turns belong to its parent");
	await h.teardown();

	const h2 = harness([parent, child], { includeSubagents: true });
	h2.emit("session/event", { id: child.id }, { type: "turn/end", data: { turn: 1, reason: { kind: "error", error: { message: "x", code: "SERVER" } } } });
	await settle();
	assert.equal(child.sent.length, 1, "includeSubagents opts in");
	await h2.teardown();
	console.log("subagent scope: OK");
}

/* ── 13. the natural prompt is configurable ─────────────────────────────── */

{
	const agent = fakeAgent();
	const h = harness([agent], { prompt: "接着干", delayMs: 0 });
	h.emit("session/event", { id: agent.id }, { type: "turn/end", data: { turn: 1, reason: { kind: "max-tokens" } } });
	await settle(80);
	assert.deepEqual(agent.sent[0].content, [{ type: "text", text: "接着干" }]);
	await h.teardown();
	console.log("custom prompt: OK");
}

console.log("\nPASS: host engine verified");
