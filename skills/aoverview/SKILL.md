---
name: aoverview
description: Report agent progress to AOVerview when requested or when a parent supplies a writer handle. Separate macro goals, configurable activity blocks, and factual action/result/reference steps. Covers tentative next steps, recovery and subagents.
---

# AOVerview reporting

Give the user a concise account of what is happening and what it achieves. Report observable work, results, blockers and tentative next steps. Never include transcripts, raw tool output, secrets or private reasoning. Keep working if reporting is temporarily unavailable.

## Three distinct levels

- **Goals (floating todo):** the user's broad desired outcomes. Keep a few, independent of reporting detail. A goal can span several blocks; do not copy implementation phases into the todo or create one goal per block. Completing a block does not automatically complete its goal. Change goals only when scope or their actual state changes.
- **Blocks (canvas):** bounded activities advancing those outcomes, such as creating storage, connecting the editor or verifying imports. Choose their boundaries using the session's `detailLevel` below. Link related blocks to the same `goalId`; their titles describe the work, not repeat the goal.
- **Details (inside a block):** concrete performed steps with `action`, `result` and `reference`. Record what was done, the observed outcome, and where it can be checked (file path, test command, issue/URL or other observed evidence). Keep each field brief. If an outcome is pending, say so; if no reference exists, omit it. Never fabricate evidence or claim a planned test passed.

For a Markdown library, macro goals could be “Deliver a complete Markdown library”, “Verify persistence and main flows”, “Provide a runnable, documented demo”. The first goal can have storage, document API and editor blocks; a storage detail could describe adding a transaction, its observed behavior, and the relevant source path. The todo stays the same at every detail level.

## Start, choose detail, resume

- With a parent-supplied handle, use that identity. **Subagents never call `overview_open`.** Resume if the inherited level or revision is missing.
- Otherwise call `overview_open` once with title, agent name, the free-text `project` you are working on (for example `AOVerview`), globally unique `requestId`, broad goals and optional `detailLevel`. Use the known repository/product name directly; no project list or prior registration is needed. If the project is unknown, omit it. Grouping ignores case, accents, spaces, hyphens and underscores. Follow the user's choice: basso/low → `low`, medio/medium → `medium`, alto/high → `high`. If unspecified, use **medium** without asking. This is reporting granularity for the session, not a visual filter.
- Save `handle`, `agentId`, `sessionId`, `revision`, `project` and `detailLevel` in working context and handoff/compaction summaries. Preserve child identities. Never replace a lost identity by opening another session.
- After context loss, restart or `REVISION_CONFLICT`, call `overview_resume` with your saved handle. Its level is authoritative; continue from the returned revision and short IDs. An old saved opening receipt may lack the level: resume to recover it.
- Resume returns the active block's last three details, up to five blocked/proposed blocks and twenty children, unfinished delegations first. Preserve older child identities; if unfinished-work checks fail, resolve visible work and resume again.
- Only the main agent manages goals and the session project. To assign or change the project later, include `{ "op": "project", "name": "AOVerview" }` in `overview_update`; `name: null` clears it. All descendants inherit the same project and session level and report their own blocks under the delegated goal.

| detailLevel | When to open a new block | Same library work might be grouped as |
| --- | --- | --- |
| `low` | A coherent group of related tasks producing a broader result. Keep meaningful steps inside it. | One “Build document storage and API” block. |
| `medium` | A task with a distinct result, or a meaningful change in focus. | “Create document storage”, then “Expose document API”. |
| `high` | A significant subactivity, investigation or verification with an independently useful result. | “Define document schema”, “Implement persistence”, “Implement document endpoints”, “Verify API contracts”. |

These are grouping examples, **not required titles or block counts**. Never create a block for each read, command, tool call or tiny edit, even at high detail. Increase the number of useful boundaries, not the verbosity of each entry. The format of details and the macro goals remain the same across levels.

## Report only meaningful changes

For read-only browsing, use `overview_list_sessions` → `overview_get_session` with `sessionId` → `overview_list_blocks` with `agentId` → `overview_get_block` with both `agentId` and `blockId`. Session reads include goals and the agent hierarchy; block reads include every action/result/reference step. These tools need no writer handle and never return one. Lists accept `limit` (1–100, default 30) and the previous page's `nextCursor` as `cursor`; stop when it is null. Block lists accept `view: "all" | "history" | "proposed"`. Archived sessions are hidden from the list but remain readable by ID. Keep `overview_resume` for recovering your writer context and revision.

Use `overview_update` when starting an activity, obtaining a useful result, discovering a blocker, changing direction, delegating or finishing. Start a block when work begins; add factual details as results become available. Every nontrivial performed block needs meaningful action/result/reference steps by closure, including work that failed. A proposal cancelled before work starts needs no performed details.

Do not report every tool call, heartbeat or repeated summary. Group related steps, send only new or corrected fields, and reuse detail IDs when filling in a result or reference. Do not repeat the goal list or copy the same result into summary, detail and outcome; the outcome briefly states what the whole activity achieved. Low detail still includes useful performed steps.

Use short stable IDs (`g1`, `b1`, `d1`). Goals belong to the session, blocks to your agent, details to their block. Every new request has a distinct `requestId`; an exact retry reuses all original arguments, including revision and content.

`overview_update` takes `handle`, `requestId`, `expectedRevision`, `operations`. Each accepted mutation, including registration, returns your new revision:

- `goal`: `id`, optional `title`, `description`, `status`. New goals need a title. States: `pending`, `active`, `blocked`, `completed`, `cancelled`.
- `block`: `id`, optional `title`, `summary`, `goalId`, `status`, `outcome`, `concern`, `details`. New blocks need a title. Each detail has `id`, `action`, optional `result` and `reference`.
- `delegation`: `childAgentId`, `status: "cancelled"` for an unstarted reservation; or `status: "integrated"`, `blockId`, optional `note` after actually incorporating a completed contribution.
- `finish`: `status: "completed" | "failed" | "cancelled"`.

Omitted fields stay unchanged; `null` clears optional text or goal association, including a detail's result/reference. Details are upserted by ID, never replace the full list. Keep titles concrete and brief; include a summary only if it adds context.

## Blocks and tentative next steps

- Keep at most one `active` block per agent; other work may remain `blocked`.
- New blocks are `proposed` or `active`. Proposals contain intentions, never performed details.
- Normally keep only one or two upcoming proposals. Confirm by activating when starting; revise or cancel them if the plan changes. A proposed check must not appear to have already passed.
- Active work may become `blocked`, `completed`, `failed` or `cancelled`. Blocked work can resume as `active`; terminal states cannot reopen. When a failed approach requires new work, add a fresh block under the same macro goal.
- Batch the current result and closure, next activation and any genuine goal-state changes. Do not complete a broad goal just because one associated block finished.

Example at medium detail, **after the transaction test has actually passed**: both blocks advance the same broad goal; the goal is still unfinished.

```json
{
  "handle": "YOUR_HANDLE",
  "requestId": "storage-verified",
  "expectedRevision": 3,
  "operations": [
    {"op":"block","id":"b1","status":"completed","outcome":"Document storage is ready for API integration.","details":[{"id":"d2","action":"Tested rollback of an invalid document write.","result":"The invalid batch leaves existing documents unchanged.","reference":"npm test -- storage.test.ts"}]},
    {"op":"block","id":"b2","title":"Expose document API","status":"active","goalId":"g1"},
    {"op":"block","id":"b3","title":"Connect Markdown editor","status":"proposed","goalId":"g1"}
  ]
}
```

## Subagents

1. Before spawning, call `overview_register_subagent` from your active block with handle, revision, unique request ID, `name`, `mandate`, `blockId`, optional `goalId`.
2. Save the new parent revision. Pass the returned child handle, identity, revision, **inherited `detailLevel`**, task and this skill when spawning. The child resumes if needed and uses the same grouping rules; it does not create another macro todo.
3. Its first accepted update confirms it is running. Nested delegates follow the same flow. If spawning fails, cancel the still-reserved delegation.
4. Completion does not imply integration: record `delegation` integration into your started block only when using the completed contribution. Your details say what you checked/incorporated and its effect; do not copy the child's timeline or rewrite its blocks.

## Finish and recovery

- Before closing a performed block, check its meaningful steps contain an action, honest outcome and available reference. If the outcome remains unverified, record that limit rather than imply success.
- Before successful finish, close active/blocked work, wait for descendants, integrate used contributions and have the main agent complete/cancel goals according to their broad acceptance criteria.
- Batch the final activity outcome and `finish`; the server cancels leftover proposals. Explicit failed/cancelled finish does not infer descendants stopped.
- On transient reporting errors, retry the identical request once, then continue the main task and reconcile meaningful progress on recovery. Never loop on reporting errors.
- Correct validation errors. On revision conflicts, resume and rebuild the intended update with a new request ID and current revision.
