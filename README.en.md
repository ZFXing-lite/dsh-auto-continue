# dsh-auto-continue

> An **auto-continue plugin for the DeepSeek Harness**: when a turn ends
> abnormally — an exhausted model retry, a provider error, a request timeout, or
> output truncated at the token ceiling — the plugin automatically sends
> `继续` so the work keeps running. It adds a single **「自动继续」** row with a
> **slider toggle** to the composer's **「+」 menu** — default left 「关」 (off),
> click to slide right to 「开」 (on), with the 开/关 glyph on the thumb.

[中文](./README.md) · [Design outline](./docs/DESIGN.md) · [Deployment guide](./docs/DEPLOY.md)

---

## The problem

Long tasks often die mid-way for reasons that are **not the user's decision**:

- the model provider returns a transient 5xx / rate-limit and retries don't save it;
- a request times out or the network hiccups;
- a single response hits the `max-tokens` ceiling mid-sentence;
- anything else that ends a turn with an **error**.

In the DeepSeek Harness every one of those converges on the same durable fact:
a **turn ends abnormally**, recorded as a `turn/end` event with a structured
reason. This plugin watches that one fact: turn ends badly → wait a short
settle delay → send `继续` through DSH's own public API (`agent.followup()`,
the same path goal-round continuation uses) → the conversation resumes.

## Why this shape

| Approach | Verdict |
| --- | --- |
| Take over `agent/request-error` and retry ourselves | ❌ Fights `llm-retry` on the same waterfall; retry policy belongs to the provider |
| Wrap the LLM stream and re-issue one request | ❌ Saves one request, not a turn that already failed while the work was unfinished |
| **Watch `turn/end` + `agent.followup('继续')`** (this plugin) | ✅ Uses DSH's own stable events and public API; covers **every** cause uniformly |

The key property: **it does not care which cause**. Retry exhaustion, timeout,
provider error, truncation — all become one `turn/end` + structured reason, so
the plugin judges that single fact and naturally covers "other factors" too.

## Features

- One row in the composer's **「+」 menu**: `自动继续` with a slider toggle on
  the right — default left 「关」 (off), click to slide right to 「开」 (on),
  the 开/关 glyph rides on the thumb.
- The switch goes through DSH's own settings channel — **persisted**, survives
  refresh/restart.
- After a failed / truncated turn, **automatically sends `继续`**, shown in the
  conversation as an expandable context row (source `plugin: auto-continue` — it
  never impersonates a user message).
- **Safety fences** (see [Design §5](./docs/DESIGN.md)):
  - a user stop is **never** continued;
  - human input always wins (cancels a pending continuation);
  - only dispatches while the agent is idle — never interrupts a running turn;
  - a `maxStreak` cap (default 12) stops error→continue→error loops from
    burning tokens forever;
  - subagents are out of scope by default;
  - no "stall watchdog" (a long compile/test is legitimately silent for minutes).

## Configuration

Via Settings → Plugins → `auto-continue`, or the `config` block in
`cordis.patch.yml`:

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | master switch (what the + menu writes; default off) |
| `prompt` | `继续` | text sent automatically |
| `delayMs` | `1500` | settle delay after a turn ends |
| `maxStreak` | `12` | cap on consecutive automatic continuations |
| `onError` | `true` | continue after a failed turn |
| `onMaxTokens` | `true` | continue after truncated output |
| `onAborted` | `false` | continue after a non-user abort (a user stop is never continued) |
| `onBlocked` | `false` | continue after a blocked turn |
| `includeSubagents` | `false` | also manage subagent sessions |
| `announce` | `true` | reserved: record continuations in the session log |

## Quick install

See [the deployment guide](./docs/DEPLOY.md). Short version:

```bash
dsh plugin --profile web add /path/to/dsh-auto-continue
# add "dsh-auto-continue" to the bundle list (see DEPLOY.md), then restart dsh
```

After restart, refresh the page, open the composer's 「+」, and the `自动继续`
toggle row appears.

## Verification

Three test layers ship in this repo:

```bash
node test/engine.test.mjs                                  # decision engine: 13 cases
node test/e2e.test.mjs http://127.0.0.1:3098 /path/to/work # real failed turn -> continue -> cap
node test/menu.probe.mjs http://127.0.0.1:3098             # + menu switches (needs playwright)
```

`e2e.test.mjs` runs against an isolated DSH host with **no usable credentials**
so every model request fails for real, then asserts: failed turn → the plugin
really sent `继续` → after `maxStreak` consecutive sends it really stood down.

## License

MIT
