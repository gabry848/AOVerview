import { z } from "zod";

export const keySchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
const requestId = z.string().min(1).max(100).regex(/^[a-zA-Z0-9:_-]+$/);
const title = z.string().trim().min(1).max(160);
const text = z.string().trim().min(1).max(1600);
export const blockStatusSchema = z.enum(["proposed", "active", "blocked", "completed", "failed", "cancelled"]);
export const agentStatusSchema = z.enum(["reserved", "running", "completed", "failed", "cancelled"]);
export const goalStatusSchema = z.enum(["pending", "active", "blocked", "completed", "cancelled"]);
export const detailLevelSchema = z.enum(["low", "medium", "high"]);

export const goalMutationSchema = z.strictObject({
  op: z.literal("goal"), id: keySchema,
  title: title.optional(), description: text.nullable().optional(),
  status: goalStatusSchema.optional(),
});
export const detailMutationSchema = z.strictObject({
  id: keySchema, action: text, result: text.nullable().optional(),
  reference: z.string().trim().min(1).max(600).nullable().optional()
    .describe("Observed file path, test command or evidence identifier; omit if unavailable."),
});
export const blockMutationSchema = z.strictObject({
  op: z.literal("block"), id: keySchema,
  title: title.optional(), summary: text.nullable().optional(),
  goalId: keySchema.nullable().optional(), status: blockStatusSchema.optional(),
  outcome: text.nullable().optional(), concern: text.nullable().optional(),
  details: z.array(detailMutationSchema).max(12).optional(),
});
export const finishMutationSchema = z.strictObject({
  op: z.literal("finish"), status: z.enum(["completed", "failed", "cancelled"]),
});
export const delegationMutationSchema = z.strictObject({
  op: z.literal("delegation"), childAgentId: keySchema,
  status: z.enum(["cancelled", "integrated"]),
  blockId: keySchema.optional(), note: text.optional(),
});
export const mutationSchema = z.discriminatedUnion("op", [
  goalMutationSchema, blockMutationSchema, finishMutationSchema, delegationMutationSchema,
]);
export const openSchema = z.strictObject({
  requestId, title, agentName: title,
  detailLevel: detailLevelSchema.optional().describe("Block granularity: low groups related work, medium separates tasks, high separates meaningful subactivities. Default medium; goals stay macro."),
  goals: z.array(z.strictObject({ id: keySchema, title, description: text.optional() })).max(12).optional(),
});
export const updateSchema = z.strictObject({
  handle: z.string().min(1).max(100), requestId,
  expectedRevision: z.number().int().nonnegative(),
  operations: z.array(mutationSchema).min(1).max(16),
});
export const registerSchema = z.strictObject({
  handle: z.string().min(1).max(100), requestId,
  expectedRevision: z.number().int().nonnegative(),
  name: title, mandate: text, blockId: keySchema, goalId: keySchema.optional(),
});
export const resumeSchema = z.strictObject({ handle: z.string().min(1).max(100) });

const readPagination = {
  limit: z.number().int().min(1).max(100).default(30),
  cursor: z.string().regex(/^\d+$/).refine(value => Number.isSafeInteger(Number(value)))
    .default("0").describe("Use nextCursor from the previous page; omit for the first page."),
};
export const listSessionsSchema = z.strictObject(readPagination);
export const getSessionSchema = z.strictObject({ sessionId: keySchema });
export const listBlocksSchema = z.strictObject({
  agentId: keySchema, ...readPagination,
  view: z.enum(["all", "history", "proposed"]).default("all"),
});
export const getBlockSchema = z.strictObject({ agentId: keySchema, blockId: keySchema });

export type OpenInput = z.infer<typeof openSchema>;
export type UpdateInput = z.infer<typeof updateSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type Mutation = z.infer<typeof mutationSchema>;
export type BlockStatus = z.infer<typeof blockStatusSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type GoalStatus = z.infer<typeof goalStatusSchema>;
export type DetailLevel = z.infer<typeof detailLevelSchema>;

export interface Session {
  id: string; title: string; rootAgentId: string; detailLevel: DetailLevel; createdAt: number; updatedAt: number;
  archivedAt: number | null;
}
export interface Agent {
  id: string; sessionId: string; parentAgentId: string | null; parentBlockId: string | null;
  goalId: string | null; name: string; mandate: string | null; status: AgentStatus;
  revision: number; createdAt: number; updatedAt: number; endedAt: number | null;
  integratedAt: number | null; integratedIntoBlockId: string | null; integrationNote: string | null;
}
export interface Goal {
  id: string; sessionId: string; title: string; description: string | null;
  status: GoalStatus; position: number; createdAt: number; updatedAt: number;
}
export interface Block {
  id: string; agentId: string; goalId: string | null; title: string; summary: string | null;
  status: BlockStatus; outcome: string | null; concern: string | null; position: number;
  createdAt: number; updatedAt: number; startedAt: number | null; endedAt: number | null;
  detailCount: number;
}
export interface Detail {
  id: string; agentId: string; blockId: string; action: string; result: string | null;
  reference: string | null;
  position: number; createdAt: number; updatedAt: number;
}
export interface BlockDetail extends Block { details: Detail[] }
export interface AgentOverview extends Agent { currentBlock: Block | null; proposedCount: number }
export interface SessionSummary extends Session {
  rootAgentName: string; status: AgentStatus; agentCount: number; runningCount: number; workingCount: number;
  completedGoals: number; totalGoals: number; openGoals: number; blockedCount: number; currentBlock: Block | null;
}
export interface SessionOverview { session: Session; goals: Goal[]; agents: AgentOverview[] }
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface WriteResult { agentId: string; revision: number }
// Replayed v1 receipts retain their original payload; resume recovers the level.
export interface OpenResult extends WriteResult { sessionId: string; handle: string; detailLevel?: DetailLevel }
export interface RegisterResult extends WriteResult {
  child: { agentId: string; sessionId: string; handle: string; revision: number; detailLevel?: DetailLevel };
}
export interface ResumeResult {
  agentId: string; sessionId: string; revision: number; status: AgentStatus;
  detailLevel: DetailLevel;
  parentAgentId: string | null; goalId: string | null;
  mandate: string | null; goals: Pick<Goal, "id" | "title" | "status">[];
  active: (BlockContext & { details: Pick<Detail, "id" | "action" | "result" | "reference">[] }) | null;
  blocked: BlockContext[]; lastCompleted: BlockContext | null;
  proposed: BlockContext[];
  children: Pick<Agent, "id" | "name" | "status" | "integratedAt">[];
}
export type BlockContext = Pick<Block, "id" | "title" | "status" | "goalId" | "summary" | "outcome" | "concern">;
export interface ChangeEvent { sequence: number; sessionId: string; agentId: string }
