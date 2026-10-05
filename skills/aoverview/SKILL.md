---
name: aoverview
description: Report meaningful agent progress to the local AOVerview MCP dashboard. Use when AOVerview reporting is requested or a parent provides a writer handle. Covers session goals, macro activity blocks, tentative next steps, resuming context, and subagent delegation.
---

# AOVerview reporting

Keep the user's dashboard useful with small, factual progress updates. Report objectives, actions, results, blockers, and intended next steps. Never include transcripts, raw tool output, secrets, or private reasoning. Continue the main task if reporting is temporarily unavailable.

## Start or resume

- If the parent supplied a writer handle, use that identity. **Do not call `overview_open` as a subagent.**
- Otherwise call `overview_open` once with a concrete session title, your agent name, a globally unique `requestId`, and normally 3–6 macro goals. Use a native session identifier or a unique random suffix for the opening request.
- Save `handle`, `agentId`, `sessionId`, and `revision` in your working context and any handoff/compaction summary. Preserve child identities too; never replace a lost identity by opening another session.
- After context loss, restart, or `REVISION_CONFLICT`, call `overview_resume` with your existing handle. Continue from its revision and short IDs.
- Resume is compact: the current block's last three details, up to five blocked/proposed blocks, and twenty children with unfinished delegations first. Preserve older child identities; if unfinished-work checks fail, resolve the visible work and resume again.
- Only the main agent manages the session goals. Subagents report their own blocks, optionally linked to the delegated goal.

## Report at meaningful boundaries

Use `overview_update` when starting a macro phase, obtaining an important result, discovering a blocker, changing direction, delegating, or finishing. Do not report every tool call or send a heartbeat. Skip updates that add no useful information.

Use short stable IDs such as `g1`, `b1`, and `d1`. Goal IDs belong to the session; block IDs belong to your agent; detail IDs belong to their block. Reuse IDs to update existing records. Every new request needs a distinct `requestId`; an exact retry must reuse the original request, including its revision and content.

The input contains `handle`, `requestId`, `expectedRevision`, and `operations`. Every successful mutation, including subagent registration, returns your new revision. Operations are:

- `goal`: `id`, optional `title`, `description`, `status`. New goals need a title. States: `pending`, `active`, `blocked`, `completed`, `cancelled`.
- `block`: `id`, optional `title`, `summary`, `goalId`, `status`, `outcome`, `concern`, `details`. New blocks need a title. Details contain `id`, `action`, optional `result`.
- `delegation`: `childAgentId`, `status: "cancelled"` for an unstarted reservation; or `status: "integrated"`, `blockId`, optional `note` when the parent actually incorporates a completed contribution.
- `finish`: `status: "completed" | "failed" | "cancelled"`.

Omitted fields remain unchanged. Use `null` to clear optional description, summary, goal association, result, outcome, or concern. Sending details adds or corrects those IDs; it does not replace the full detail list.

Keep titles concrete and brief. Summaries should normally be one or two sentences; add 1–3 meaningful details per update. Each detail says what was done and, when known, its result. Prefer improving the current block to creating another small block.

## Blocks and tentative next steps

- Keep at most one `active` block per agent. Other work can remain `blocked`.
- A new block is `proposed` or `active`. Proposed blocks contain intentions, not completed actions.
- Normally maintain only one or two proposed next steps. Change their titles or summaries when the plan changes; cancel obsolete proposals.
- Activate a proposed block when starting it. That transition is its confirmation.
- Active work can become `blocked`, `completed`, `failed`, or `cancelled`. Blocked work can resume as `active`. Terminal block states do not reopen.
- Bundle the current block's result, its completion, the next block's activation, and goal changes in one request.

Example phase transition:

```json
{
  "handle": "YOUR_HANDLE",
  "requestId": "phase-2",
  "expectedRevision": 3,
  "operations": [
    {"op":"block","id":"b1","status":"completed","outcome":"Defined a consistent data model."},
    {"op":"block","id":"b2","title":"Implement persistence","status":"active","goalId":"g1"},
    {"op":"block","id":"b3","title":"Verify simultaneous agents","status":"proposed"}
  ]
}
```

## Subagents

1. From your active block, call `overview_register_subagent` with your handle, revision, a unique request ID, `name`, `mandate`, `blockId`, and optional `goalId`.
2. Update your saved revision from the response. Pass the returned child handle, identity, initial revision, task, and this skill to the child **when spawning it**.
3. The child uses its handle to report. Its first accepted update confirms it is running. Nested subagents follow the same flow.
4. If spawning fails, cancel the still-reserved delegation using `overview_update`.
5. Child completion does not imply integration. Once you use its contribution, explicitly register `delegation` integration into your own started block.

Do not rewrite a child's blocks or copy all its progress into your timeline. Your own block should describe how its contribution affected your work.

## Finish and failures

- Before finishing successfully, close active/blocked work, wait for descendants to finish, and have the main agent complete or cancel remaining goals. Integrate relevant contributions before finishing the parent.
- Add a final outcome and `finish` in the same update. Remaining tentative proposals are cancelled by the server.
- A failed/cancelled finish records that explicit outcome; it does not infer that descendants stopped.
- For transient reporting errors, retry the exact request once. If still unavailable, keep working and reconcile important progress on recovery. Never loop on dashboard reporting errors.
- On validation errors, correct the request. On a revision conflict, resume first; rebuild the intended update with a new request ID and current revision.
- Treat reported `completed` as an observed result. Describe unverified expectations as proposals, not achievements.
