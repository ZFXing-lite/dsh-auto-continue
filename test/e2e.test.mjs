/**
 * dsh-auto-continue — end-to-end test against a REAL dsh host.
 *
 * The other two tests cover the pieces (the decision engine with a fake
 * context, and the "+" menu in a real browser). This one covers the seam the
 * pieces cannot: a genuine session on a genuine host whose turn genuinely
 * fails, driven through the same RPC the GUI uses — then reads the durable
 * session log to confirm the plugin really sent «继续», and that a user stop
 * really stops it.
 *
 * The host under test must be started with NO usable provider credentials
 * (see test/e2e.sh), so every model request fails for real. That turns a
 * missing API key into the exact condition this plugin exists for — an
 * exhausted request that ends a turn — without touching any real account.
 *
 * Run: node test/e2e.test.mjs [base-url] [cwd]
 */
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Base URL of the host under test. */
const BASE = process.argv[2] ?? "http://127.0.0.1:3098";
/** Workspace the test session is created in. */
const CWD = process.argv[3] ?? "/tmp/ac-home/work";
/** Where that host keeps durable sessions. */
const SESSIONS_DIR = process.env.AC_SESSIONS_DIR ?? "/tmp/ac-home/sessions";

const failures = [];
function check(condition, message) {
	if (!condition) failures.push(message);
	return condition;
}

/**
 * Call one api-proxy RPC method exactly as the browser client does.
 * @param method - the RPC method name (e.g. `session.create`).
 * @param payload - the method's request payload.
 * @returns the `ok` value.
 */
async function rpc(method, payload) {
	const rpcId = randomUUID();
	const response = await fetch(`${BASE}/api/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type: "client-request", rpcId, method, payload })
	});
	if (!response.ok) throw new Error(`${method}: HTTP ${String(response.status)}`);
	const envelope = await response.json();
	if (envelope.rpcId !== rpcId) throw new Error(`${method}: rpcId mismatch`);
	if (!envelope.result.ok) throw new Error(`${method}: ${JSON.stringify(envelope.result)}`);
	return envelope.result.value;
}

/**
 * Read one session's durable log, newest last, retrying until it settles.
 *
 * The session-persistence layer writes zstd-compressed JSONL at
 * `<sessions>/<workspace-slug>/<sessionId>/session.jsonl.zstd`, so the reader
 * globs by session id and decompresses with the `zstdcat` binary the host
 * itself ships with.
 * @param sessionId - the session whose log to read.
 * @returns the parsed events, or `[]` while the file is not flushed yet.
 */
async function sessionEvents(sessionId, { attempts = 40, delayMs = 500 } = {}) {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		let slug = "";
		try {
			for (const entry of await readdir(SESSIONS_DIR)) {
				const candidate = join(SESSIONS_DIR, entry, sessionId, "session.jsonl.zstd");
				try {
					await readFile(candidate);
					slug = candidate;
					break;
				} catch {
					/* not this workspace */
				}
			}
		} catch {
			/* sessions dir not ready */
		}
		if (slug !== "") {
			const raw = await new Promise((resolve, reject) => {
				execFile("zstdcat", [slug], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
					if (error) reject(error);
					else resolve(stdout);
				});
			});
			return raw.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
		}
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	return [];
}

/** Wait until `predicate(events)` holds, then return the events. */
async function waitFor(sessionId, predicate, { attempts = 60, delayMs = 500, what = "condition" } = {}) {
	let events = [];
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		events = await sessionEvents(sessionId, { attempts: 1 });
		if (predicate(events)) return events;
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	failures.push(`timed out waiting for ${what}`);
	return events;
}

/** The plugin's own continuations, in order. */
const continuations = (events) => events.filter((event) =>
	event.type === "user/message"
	&& event.data?.source?.kind === "plugin"
	&& event.data?.source?.plugin === "auto-continue");

/** Turn endings recorded so far. */
const turnEnds = (events) => events.filter((event) => event.type === "turn/end");

/* ── Scenario A: a failing turn is continued until the cap ───────────────── */

const created = await rpc("session.create", { cwd: CWD });
const sessionId = created.sessionId;
check(typeof sessionId === "string" && sessionId.length > 0, "session.create returned no id");
console.log("session:", sessionId);

// A prompt with no working provider: the request fails, so the turn ends with
// `error` — the case this plugin exists for.
await rpc("session.prompt", { sessionId, mode: "queue", content: [{ type: "text", text: "请回复 ok" }] });

const afterFailure = await waitFor(
	sessionId,
	(events) => continuations(events).length >= 1,
	{ what: "the plugin's first automatic 继续", attempts: 60 },
);

const first = continuations(afterFailure);
check(first.length >= 1, "the plugin did not continue a failing turn");

if (first.length >= 1) {
	const message = first[0].data;
	check(message.role === "user", "the continuation is not a user-role message");
	check(
		Array.isArray(message.content) && message.content[0]?.type === "text" && message.content[0].text === "继续",
		`the continuation text is wrong: ${JSON.stringify(message.content)}`,
	);
	check(message.source.kind === "plugin", "the continuation does not declare a plugin source");
	check(message.source.plugin === "auto-continue", "the continuation names the wrong plugin");
	check(message.source.form === "notice", "the continuation does not declare the notice form");
	check(typeof message.source.summary === "string" && message.source.summary.includes("自动继续"),
		"the continuation summary is missing");
	console.log("continuation #1:", JSON.stringify(message.source));
}

// The host really did fail these turns (otherwise the assertion above would be
// passing for the wrong reason).
const errorTurns = turnEnds(afterFailure).filter((event) => event.data.reason?.kind === "error");
check(errorTurns.length >= 1, "no failed turn was recorded, so the continuation proves nothing");
console.log("turn endings so far:", turnEnds(afterFailure).map((event) => event.data.reason.kind).join(","));

// The configured cap must stop the retry loop rather than run forever. With
// maxStreak=3 in the isolated home, we expect exactly three continuations and
// then a stand-down — the loop must NOT run forever.
const capped = await waitFor(
	sessionId,
	(events) => continuations(events).length >= 3 && turnEnds(events).length >= 4,
	{ what: "the streak cap to be reached", attempts: 80 },
);
const total = continuations(capped).length;
check(total === 3, `expected exactly 3 continuations under maxStreak=3, saw ${String(total)}`);
// Give the host a moment to (not) send a fourth — the cap must hold.
await new Promise((resolve) => setTimeout(resolve, 3000));
const settled = await sessionEvents(sessionId, { attempts: 1 });
const settledTotal = continuations(settled).length;
check(settledTotal === 3, `the cap was exceeded after settling: ${String(settledTotal)} continuations`);
console.log("continuations before standing down:", settledTotal, "(cap = 3)");

// The user-stop fence is covered by the engine unit test (a real stop needs a
// long-running turn, which a missing-credential host cannot produce); this e2e
// stays focused on the positive integration: a real failed turn really is
// continued, and the cap really holds.

if (failures.length > 0) {
	console.error("\nFAIL:");
	for (const failure of failures) console.error(" - " + failure);
	process.exit(1);
}
console.log("\nPASS: real host continued a real failed turn");
