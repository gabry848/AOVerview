import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  openSchema, registerSchema, updateSchema, resumeSchema,
  type Agent, type AgentOverview, type Block, type BlockContext, type BlockDetail, type BlockStatus,
  type ChangeEvent, type Detail, type Goal, type Mutation, type OpenResult, type Page,
  type RegisterResult, type ResumeResult, type Session, type SessionOverview,
  type SessionSummary, type WriteResult,
} from "./contracts.js";
import { connectDatabase, schemaVersion } from "./database.js";
import { OverviewError, requireCondition } from "./errors.js";
import { projectKey } from "./project.js";

type AgentRecord = Agent & { handle: string };
const terminalBlocks = new Set<BlockStatus>(["completed", "failed", "cancelled"]);
const transitions: Record<BlockStatus, readonly BlockStatus[]> = {
  proposed: ["active", "cancelled"],
  active: ["blocked", "completed", "failed", "cancelled"],
  blocked: ["active", "completed", "failed", "cancelled"],
  completed: [], failed: [], cancelled: [],
};
const blockSelection = `SELECT b.*, (SELECT COUNT(*) FROM details d
  WHERE d.agentId=b.agentId AND d.blockId=b.id) AS detailCount FROM blocks b`;
const publicAgentColumns = `id, sessionId, parentAgentId, parentBlockId, goalId, name, mandate,
  status, revision, createdAt, updatedAt, endedAt, integratedAt, integratedIntoBlockId, integrationNote`;

function context(block: Block): BlockContext {
  const { id, title, status, goalId, summary, outcome, concern } = block;
  return { id, title, status, goalId, summary, outcome, concern };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export class OverviewStore {
  readonly db: DatabaseSync;
  constructor(path: string, private readonly readOnly = false) {
    this.db = connectDatabase(path, readOnly);
    if (Number(this.db.prepare("PRAGMA user_version").get()?.user_version) !== schemaVersion) {
      this.db.close();
      throw new Error("Database schema unavailable. Run npm run db:migrate first.");
    }
  }

  close(): void { this.db.close(); }

  private one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  private all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  private run(sql: string, ...params: SQLInputValue[]): void { this.db.prepare(sql).run(...params); }

  private transaction<T>(write: boolean, operation: () => T): T {
    requireCondition(!write || !this.readOnly, "READ_ONLY", "This connection cannot write.", 403);
    this.db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private write<T>(scope: string, requestId: string, input: unknown, operation: () => T): T {
    const hash = createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex");
    return this.transaction(true, () => {
      const receipt = this.one<{ hash: string; result: string }>(
        "SELECT hash, result FROM receipts WHERE scope=? AND requestId=?", scope, requestId);
      if (receipt) {
        requireCondition(receipt.hash === hash, "REQUEST_REUSED", "Use a new requestId for different content.", 409);
        return JSON.parse(receipt.result) as T;
      }
      const result = operation();
      this.run("INSERT INTO receipts(scope, requestId, hash, result) VALUES(?,?,?,?)",
        scope, requestId, hash, JSON.stringify(result));
      return result;
    });
  }

  private authenticate(handle: string): AgentRecord {
    const agent = this.one<AgentRecord>("SELECT * FROM agents WHERE handle=?", handle);
    requireCondition(agent, "INVALID_HANDLE", "Unknown writer handle.", 403);
    return agent;
  }
  private checkRevision(agent: Agent, revision: number): void {
    if (agent.revision !== revision) {
      throw new OverviewError("REVISION_CONFLICT", "Resume this agent before retrying the update.", 409, agent.revision);
    }
    requireCondition(agent.status === "running" || agent.status === "reserved",
      "AGENT_FINISHED", "This agent has already finished.", 409);
  }
  private touch(agent: Agent, now: number): WriteResult {
    this.run("UPDATE agents SET revision=revision+1, updatedAt=? WHERE id=?", now, agent.id);
    this.run("UPDATE sessions SET updatedAt=? WHERE id=?", now, agent.sessionId);
    this.run("INSERT INTO changes(sessionId, agentId) VALUES(?,?)", agent.sessionId, agent.id);
    return { agentId: agent.id, revision: agent.revision + 1 };
  }
  private nextPosition(table: "goals" | "blocks" | "details", where: string, ...params: SQLInputValue[]): number {
    return this.one<{ position: number }>(`SELECT COALESCE(MAX(position), -1)+1 AS position FROM ${table} WHERE ${where}`, ...params)!.position;
  }

  private resolveProject(name: string | null): Pick<Session, "project" | "projectKey"> {
    if (name === null) return { project: null, projectKey: null };
    const key = projectKey(name);
    const existing = this.one<{ project: string }>(
      "SELECT project FROM sessions WHERE projectKey=? ORDER BY createdAt,id LIMIT 1", key);
    return { project: existing?.project ?? name, projectKey: key };
  }

  open(input: unknown): OpenResult {
    const data = openSchema.parse(input);
    return this.write("open", data.requestId, data, () => {
      const now = Date.now();
      const sessionId = `s_${randomUUID()}`;
      const agentId = `a_${randomUUID()}`;
      const handle = `w_${randomBytes(24).toString("base64url")}`;
      const detailLevel = data.detailLevel ?? "medium";
      const { project, projectKey } = this.resolveProject(data.project ?? null);
      this.run("INSERT INTO sessions(id,title,rootAgentId,detailLevel,project,projectKey,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)",
        sessionId, data.title, agentId, detailLevel, project, projectKey, now, now);
      this.run(`INSERT INTO agents(id,sessionId,handle,name,status,createdAt,updatedAt)
        VALUES(?,?,?,?,'running',?,?)`, agentId, sessionId, handle, data.agentName, now, now);
      const ids = new Set<string>();
      for (const [position, goal] of (data.goals ?? []).entries()) {
        requireCondition(!ids.has(goal.id), "DUPLICATE_GOAL", "Initial goal IDs must be unique.");
        ids.add(goal.id);
        this.run(`INSERT INTO goals(sessionId,id,title,description,status,position,createdAt,updatedAt)
          VALUES(?,?,?,?,'pending',?,?,?)`, sessionId, goal.id, goal.title, goal.description ?? null, position, now, now);
      }
      this.run("INSERT INTO changes(sessionId,agentId) VALUES(?,?)", sessionId, agentId);
      return { sessionId, agentId, handle, revision: 0, detailLevel, project };
    });
  }

  update(input: unknown): WriteResult {
    const data = updateSchema.parse(input);
    const owner = this.authenticate(data.handle);
    return this.write(owner.id, data.requestId, data, () => {
      const agent = this.authenticate(data.handle);
      this.checkRevision(agent, data.expectedRevision);
      const now = Date.now();
      if (agent.status === "reserved") this.run("UPDATE agents SET status='running' WHERE id=?", agent.id);
      const finishes = data.operations.filter(op => op.op === "finish");
      requireCondition(finishes.length <= 1, "INVALID_BATCH", "Use at most one finish operation.");
      for (const op of data.operations) if (op.op !== "finish") this.apply(agent, op, now);
      const activeCount = this.one<{ count: number }>(
        "SELECT COUNT(*) AS count FROM blocks WHERE agentId=? AND status='active'", agent.id)!.count;
      requireCondition(activeCount <= 1, "MULTIPLE_ACTIVE_BLOCKS", "Close or block the current activity before starting another.", 409);
      const finish = finishes[0];
      if (finish?.op === "finish") this.finish(agent, finish.status, now);
      return this.touch(agent, now);
    });
  }

  private apply(agent: Agent, op: Exclude<Mutation, { op: "finish" }>, now: number): void {
    if (op.op === "project") {
      requireCondition(agent.parentAgentId === null, "FORBIDDEN", "Only the main agent can update the session project.", 403);
      const { project, projectKey } = this.resolveProject(op.name);
      this.run("UPDATE sessions SET project=?, projectKey=? WHERE id=?", project, projectKey, agent.sessionId);
    } else if (op.op === "goal") {
      requireCondition(agent.parentAgentId === null, "FORBIDDEN", "Only the main agent can update session goals.", 403);
      const previous = this.one<Goal>("SELECT * FROM goals WHERE sessionId=? AND id=?", agent.sessionId, op.id);
      requireCondition(previous || op.title, "TITLE_REQUIRED", "New goals need a title.");
      this.run(`INSERT INTO goals(sessionId,id,title,description,status,position,createdAt,updatedAt)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(sessionId,id) DO UPDATE SET
        title=excluded.title, description=excluded.description, status=excluded.status, updatedAt=excluded.updatedAt`,
        agent.sessionId, op.id, op.title ?? previous!.title,
        op.description === undefined ? previous?.description ?? null : op.description,
        op.status ?? previous?.status ?? "pending",
        previous?.position ?? this.nextPosition("goals", "sessionId=?", agent.sessionId), previous?.createdAt ?? now, now);
    } else if (op.op === "block") {
      this.upsertBlock(agent, op, now);
    } else {
      const child = this.one<Agent>(`SELECT ${publicAgentColumns} FROM agents WHERE id=?`, op.childAgentId);
      requireCondition(child?.parentAgentId === agent.id, "FORBIDDEN", "Only a direct parent can resolve a delegation.", 403);
      if (op.status === "cancelled") {
        requireCondition(child.status === "reserved", "INVALID_TRANSITION", "Only an unstarted delegation can be cancelled.", 409);
        this.run("UPDATE agents SET status='cancelled', endedAt=?, updatedAt=?, revision=revision+1 WHERE id=?", now, now, child.id);
      } else {
        requireCondition(child.status === "completed", "INVALID_TRANSITION", "Only completed contributions can be integrated.", 409);
        requireCondition(!child.integratedAt, "ALREADY_INTEGRATED", "This contribution is already integrated.", 409);
        const block = op.blockId ? this.block(agent.id, op.blockId) : undefined;
        requireCondition(block?.startedAt && block.status !== "cancelled" && block.status !== "failed",
          "INVALID_BLOCK", "Integration needs a started block belonging to the parent.");
        this.run("UPDATE agents SET integratedAt=?, integratedIntoBlockId=?, integrationNote=? WHERE id=?",
          now, block.id, op.note ?? null, child.id);
      }
    }
  }

  private upsertBlock(agent: Agent, op: Extract<Mutation, { op: "block" }>, now: number): void {
    const previous = this.block(agent.id, op.id);
    requireCondition(previous || op.title, "TITLE_REQUIRED", "New blocks need a title.");
    const status = op.status ?? previous?.status ?? "proposed";
    if (previous && previous.status !== status) {
      requireCondition(transitions[previous.status].includes(status), "INVALID_TRANSITION",
        `A ${previous.status} block cannot become ${status}.`, 409);
    }
    if (!previous) requireCondition(status === "proposed" || status === "active", "INVALID_TRANSITION", "New blocks must be proposed or active.");
    const goalId = op.goalId === undefined ? (previous ? previous.goalId : agent.goalId) : op.goalId;
    if (goalId !== null) requireCondition(this.one("SELECT id FROM goals WHERE sessionId=? AND id=?", agent.sessionId, goalId),
      "INVALID_GOAL", "The goal does not belong to this session.");
    const startedAt = previous?.startedAt ?? (status === "active" ? now : null);
    const endedAt = previous?.endedAt ?? (terminalBlocks.has(status) ? now : null);
    this.run(`INSERT INTO blocks(agentId,id,goalId,title,summary,status,outcome,concern,position,createdAt,updatedAt,startedAt,endedAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(agentId,id) DO UPDATE SET
      goalId=excluded.goalId, title=excluded.title, summary=excluded.summary, status=excluded.status,
      outcome=excluded.outcome, concern=excluded.concern, updatedAt=excluded.updatedAt,
      startedAt=excluded.startedAt, endedAt=excluded.endedAt`, agent.id, op.id, goalId,
      op.title ?? previous!.title,
      op.summary === undefined ? previous?.summary ?? null : op.summary,
      status, op.outcome === undefined ? previous?.outcome ?? null : op.outcome,
      op.concern === undefined ? previous?.concern ?? null : op.concern,
      previous?.position ?? this.nextPosition("blocks", "agentId=?", agent.id), previous?.createdAt ?? now, now, startedAt, endedAt);
    for (const detail of op.details ?? []) {
      requireCondition(startedAt !== null, "UNSTARTED_BLOCK", "Proposed blocks cannot contain work already performed.");
      const old = this.one<Detail>("SELECT * FROM details WHERE agentId=? AND blockId=? AND id=?", agent.id, op.id, detail.id);
      this.run(`INSERT INTO details(agentId,blockId,id,action,result,reference,position,createdAt,updatedAt)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(agentId,blockId,id) DO UPDATE SET
        action=excluded.action, result=excluded.result, reference=excluded.reference, updatedAt=excluded.updatedAt`, agent.id, op.id, detail.id,
        detail.action, detail.result === undefined ? old?.result ?? null : detail.result,
        detail.reference === undefined ? old?.reference ?? null : detail.reference,
        old?.position ?? this.nextPosition("details", "agentId=? AND blockId=?", agent.id, op.id), old?.createdAt ?? now, now);
    }
  }

  private finish(agent: Agent, status: "completed" | "failed" | "cancelled", now: number): void {
    if (status === "completed") {
      requireCondition(!this.one("SELECT id FROM blocks WHERE agentId=? AND status IN ('active','blocked') LIMIT 1", agent.id),
        "UNFINISHED_WORK", "Close active and blocked work before finishing.", 409);
      requireCondition(!this.one(`WITH RECURSIVE descendants(id,status) AS (
        SELECT id,status FROM agents WHERE parentAgentId=? UNION ALL
        SELECT a.id,a.status FROM agents a JOIN descendants d ON a.parentAgentId=d.id
      ) SELECT id FROM descendants WHERE status IN ('reserved','running') LIMIT 1`, agent.id),
        "UNFINISHED_DELEGATION", "A descendant has not finished yet.", 409);
      if (agent.parentAgentId === null) requireCondition(!this.one(
        "SELECT id FROM goals WHERE sessionId=? AND status NOT IN ('completed','cancelled') LIMIT 1", agent.sessionId),
        "UNFINISHED_GOALS", "Complete or cancel the remaining session goals.", 409);
    } else {
      this.run("UPDATE blocks SET status=?, endedAt=?, updatedAt=? WHERE agentId=? AND status IN ('active','blocked')",
        status, now, now, agent.id);
    }
    this.run("UPDATE blocks SET status='cancelled', endedAt=?, updatedAt=? WHERE agentId=? AND status='proposed'", now, now, agent.id);
    this.run("UPDATE agents SET status=?, endedAt=? WHERE id=?", status, now, agent.id);
  }

  registerSubagent(input: unknown): RegisterResult {
    const data = registerSchema.parse(input);
    const owner = this.authenticate(data.handle);
    return this.write(owner.id, data.requestId, data, () => {
      const parent = this.authenticate(data.handle);
      this.checkRevision(parent, data.expectedRevision);
      requireCondition(parent.status === "running", "UNSTARTED_PARENT", "The parent must have started reporting.");
      const block = this.block(parent.id, data.blockId);
      requireCondition(block?.status === "active", "INVALID_BLOCK", "Delegate from the parent's active block.");
      const goalId = data.goalId ?? block.goalId;
      if (goalId !== null) requireCondition(this.one("SELECT id FROM goals WHERE sessionId=? AND id=?", parent.sessionId, goalId),
        "INVALID_GOAL", "The goal does not belong to this session.");
      const now = Date.now();
      const childId = `a_${randomUUID()}`;
      const handle = `w_${randomBytes(24).toString("base64url")}`;
      this.run(`INSERT INTO agents(id,sessionId,parentAgentId,parentBlockId,goalId,handle,name,mandate,status,createdAt,updatedAt)
        VALUES(?,?,?,?,?,?,?,?,'reserved',?,?)`, childId, parent.sessionId, parent.id, block.id, goalId, handle, data.name, data.mandate, now, now);
      const { detailLevel, project } = this.one<Session>("SELECT * FROM sessions WHERE id=?", parent.sessionId)!;
      return { ...this.touch(parent, now), child: { agentId: childId, sessionId: parent.sessionId, handle, revision: 0, detailLevel, project } };
    });
  }

  private block(agentId: string, blockId: string): Block | undefined {
    return this.one<Block>(`${blockSelection} WHERE b.agentId=? AND b.id=?`, agentId, blockId);
  }
  private currentBlock(agentId: string): Block | null {
    return this.one<Block>(`${blockSelection} WHERE b.agentId=? AND b.status IN ('active','blocked')
      ORDER BY CASE WHEN b.status='active' THEN 0 ELSE 1 END, b.updatedAt DESC LIMIT 1`, agentId) ?? null;
  }

  getBlock(agentId: string, blockId: string): BlockDetail {
    return this.transaction(false, () => {
      const block = this.block(agentId, blockId);
      requireCondition(block, "NOT_FOUND", "Block not found.", 404);
      return { ...block, details: this.all<Detail>("SELECT * FROM details WHERE agentId=? AND blockId=? ORDER BY position", agentId, blockId) };
    });
  }

  private page<T>(rows: T[], limit: number, offset: number): Page<T> {
    return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? String(offset + limit) : null };
  }

  listSessions(limit = 30, offset = 0): Page<SessionSummary> {
    return this.transaction(false, () => {
      const rows = this.all<Omit<SessionSummary, "currentBlock">>(`SELECT s.*, a.name AS rootAgentName, a.status,
        (SELECT COUNT(*) FROM agents WHERE sessionId=s.id) AS agentCount,
        (SELECT COUNT(*) FROM agents WHERE sessionId=s.id AND status='running') AS runningCount,
        (SELECT COUNT(*) FROM agents worker WHERE worker.sessionId=s.id AND worker.status='running'
          AND (EXISTS(SELECT 1 FROM blocks WHERE agentId=worker.id AND status='active')
            OR NOT EXISTS(SELECT 1 FROM blocks WHERE agentId=worker.id AND status='blocked'))) AS workingCount,
        (SELECT COUNT(*) FROM goals WHERE sessionId=s.id AND status='completed') AS completedGoals,
        (SELECT COUNT(*) FROM goals WHERE sessionId=s.id AND status NOT IN ('completed','cancelled')) AS openGoals,
        (SELECT COUNT(*) FROM blocks b JOIN agents child ON child.id=b.agentId
          WHERE child.sessionId=s.id AND b.status='blocked') AS blockedCount,
        (SELECT COUNT(*) FROM goals WHERE sessionId=s.id) AS totalGoals
        FROM sessions s JOIN agents a ON a.id=s.rootAgentId
        WHERE s.archivedAt IS NULL
        ORDER BY s.createdAt DESC, s.id DESC LIMIT ? OFFSET ?`, limit + 1, offset);
      return this.page(rows.map(row => ({ ...row, currentBlock: this.currentBlock(row.rootAgentId) })), limit, offset);
    });
  }

  setSessionArchived(sessionId: string, archived: boolean): Session {
    return this.transaction(true, () => {
      const session = this.one<Session>("SELECT * FROM sessions WHERE id=?", sessionId);
      requireCondition(session, "NOT_FOUND", "Session not found.", 404);
      if ((session.archivedAt !== null) === archived) return { ...session };
      const archivedAt = archived ? Date.now() : null;
      this.run("UPDATE sessions SET archivedAt=? WHERE id=?", archivedAt, sessionId);
      this.run("INSERT INTO changes(sessionId, agentId) VALUES(?,?)", sessionId, session.rootAgentId);
      return { ...session, archivedAt };
    });
  }

  getSession(sessionId: string): SessionOverview {
    return this.transaction(false, () => {
      const session = this.one<Session>("SELECT * FROM sessions WHERE id=?", sessionId);
      requireCondition(session, "NOT_FOUND", "Session not found.", 404);
      const agents: AgentOverview[] = this.all<Agent>(`SELECT ${publicAgentColumns} FROM agents WHERE sessionId=? ORDER BY createdAt,id`, sessionId)
        .map(agent => ({ ...agent, currentBlock: this.currentBlock(agent.id),
          proposedCount: this.one<{ count: number }>("SELECT COUNT(*) AS count FROM blocks WHERE agentId=? AND status='proposed'", agent.id)!.count }));
      return { session, agents, goals: this.all<Goal>("SELECT * FROM goals WHERE sessionId=? ORDER BY position", sessionId) };
    });
  }

  listBlocks(agentId: string, limit = 30, offset = 0, view: "all" | "history" | "proposed" = "all"): Page<Block> {
    requireCondition(this.one("SELECT id FROM agents WHERE id=?", agentId), "NOT_FOUND", "Agent not found.", 404);
    const filter = view === "history" ? "AND b.startedAt IS NOT NULL" : view === "proposed" ? "AND b.status='proposed'" : "";
    const order = view === "history" ? "b.startedAt DESC, b.position DESC" : "CASE WHEN b.startedAt IS NULL THEN 1 ELSE 0 END, b.startedAt, b.position";
    const rows = this.all<Block>(`${blockSelection} WHERE b.agentId=? ${filter} ORDER BY ${order} LIMIT ? OFFSET ?`, agentId, limit + 1, offset);
    return this.page(rows, limit, offset);
  }

  resume(input: unknown): ResumeResult {
    const { handle } = resumeSchema.parse(input);
    return this.transaction(false, () => {
      const agent = this.authenticate(handle);
      const session = this.one<Session>("SELECT * FROM sessions WHERE id=?", agent.sessionId)!;
      const activeBlock = this.one<Block>(`${blockSelection} WHERE b.agentId=? AND b.status='active'`, agent.id);
      const active = activeBlock ? { ...context(activeBlock), details: this.all<Pick<Detail, "id" | "action" | "result" | "reference">>(`SELECT id,action,result,reference FROM details
        WHERE agentId=? AND blockId=? ORDER BY position DESC LIMIT 3`, agent.id, activeBlock.id).reverse() } : null;
      return {
        agentId: agent.id, sessionId: agent.sessionId, revision: agent.revision,
        detailLevel: session.detailLevel, project: session.project,
        status: agent.status, mandate: agent.mandate, parentAgentId: agent.parentAgentId, goalId: agent.goalId,
        goals: this.all<Pick<Goal, "id" | "title" | "status">>("SELECT id,title,status FROM goals WHERE sessionId=? ORDER BY position", agent.sessionId),
        active,
        blocked: this.all<Block>(`${blockSelection} WHERE b.agentId=? AND b.status='blocked' ORDER BY b.updatedAt DESC LIMIT 5`, agent.id).map(context),
        lastCompleted: (() => {
          const last = this.one<Block>(`${blockSelection} WHERE b.agentId=? AND b.status='completed' ORDER BY b.endedAt DESC,b.position DESC LIMIT 1`, agent.id);
          return last ? context(last) : null;
        })(),
        proposed: this.all<Block>(`${blockSelection} WHERE b.agentId=? AND b.status='proposed' ORDER BY b.position LIMIT 5`, agent.id).map(context),
        children: this.all<Pick<Agent, "id" | "name" | "status" | "integratedAt">>(
          `SELECT id,name,status,integratedAt FROM agents WHERE parentAgentId=?
            ORDER BY CASE WHEN status IN ('reserved','running') THEN 0
              WHEN status='completed' AND integratedAt IS NULL THEN 1 ELSE 2 END, createdAt DESC,id DESC LIMIT 20`, agent.id),
      };
    });
  }

  latestSequence(): number { return this.one<{ sequence: number }>("SELECT COALESCE(MAX(sequence),0) AS sequence FROM changes")!.sequence; }
  changesSince(sequence: number, limit = 200): ChangeEvent[] {
    return this.all<ChangeEvent>("SELECT * FROM changes WHERE sequence>? ORDER BY sequence LIMIT ?", sequence, limit);
  }
}
