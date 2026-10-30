import "server-only";
import { and, desc, eq, getTableColumns, inArray, lt, lte, or, sql } from "drizzle-orm";
import {
  agentCommunications,
  agentPlans,
  agentTaskRuns,
  agentTasks,
  db,
  type AgentArtifact,
  type AgentCommunication,
  type AgentPlan,
  type AgentTask,
} from "@/db";
import type { AgentRoleId, WorkerRoleId } from "@/lib/agent-roles";
import { listArtifactsForTasks, toArtifactView } from "@/lib/orchestration/artifacts";
import { listDeliverablesForTasks } from "@/lib/orchestration/deliverables";
import {
  ACTIVE_PLAN_STATUSES,
  type CommunicationKind,
  type CommunicationView,
  type PlanStatus,
  type PlanView,
  type RepeatRule,
  type TaskResult,
  type TaskStatus,
  type TaskView,
} from "@/lib/orchestration/types";

// Every plan, task and agent message belongs to one user's campaign
export type Scope = { userId: string; campaignId: number };

export type NewPlanTask = {
  agentId: WorkerRoleId;
  title: string;
  instructions: string;
  // Indexes of earlier tasks in the same list
  dependsOn: number[];
  scheduledAt: Date;
  repeat: RepeatRule | null;
  nextRunAt: Date | null;
};

// Tasks due within this window are handed to Inngest, which sleeps until each one's time
export const DISPATCH_WINDOW_MS = 15 * 60 * 1000;
// A running task saves progress at least every few minutes (each action, each checkpoint), so one
// with no progress for this long lost its Inngest run (for example the dev server restarted) and is
// restarted from its last checkpoint
const STALE_RUNNING_MS = 15 * 60 * 1000;
// A queued task can wait up to 20 minutes for the sandbox before it starts
const STALE_QUEUED_MS = 45 * 60 * 1000;

// What the executor needs to know about one dispatch (the data of a task/execute event)
export type DispatchedTask = Pick<AgentTask, "id" | "planId" | "userId" | "campaignId" | "agentId" | "queueSeq" | "scheduledAt">;

const DISPATCH_COLUMNS = {
  id: agentTasks.id,
  planId: agentTasks.planId,
  userId: agentTasks.userId,
  campaignId: agentTasks.campaignId,
  agentId: agentTasks.agentId,
  queueSeq: agentTasks.queueSeq,
  scheduledAt: agentTasks.scheduledAt,
};

function scopeFilter(table: typeof agentPlans | typeof agentTasks, { userId, campaignId }: Scope) {
  return and(eq(table.userId, userId), eq(table.campaignId, campaignId));
}

// Saves a plan and its tasks in one go. Tasks must be in dependency order: each one may only depend
// on tasks listed before it, so their ids are known when it's inserted.
export async function createPlan(scope: Scope, plan: { title: string; request: string; tasks: NewPlanTask[] }) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(agentPlans)
      .values({ ...scope, title: plan.title, request: plan.request })
      .returning();

    const tasks: AgentTask[] = [];
    for (const [position, task] of plan.tasks.entries()) {
      const [inserted] = await tx
        .insert(agentTasks)
        .values({
          ...scope,
          planId: row.id,
          position,
          agentId: task.agentId,
          title: task.title,
          instructions: task.instructions,
          dependsOn: task.dependsOn.map((index) => tasks[index].id),
          scheduledAt: task.scheduledAt,
          repeat: task.repeat,
          nextRunAt: task.nextRunAt,
        })
        .returning();
      tasks.push(inserted);
    }

    await tx.insert(agentCommunications).values(
      tasks.map((task) => ({
        ...scope,
        planId: row.id,
        taskId: task.id,
        fromAgent: "master" as const,
        toAgent: task.agentId,
        kind: "assignment" as const,
        text: `${task.title}\n\n${task.instructions}`,
      }))
    );

    return { plan: row, tasks };
  });
}

export async function getPlan(planId: number) {
  const [plan] = await db.select().from(agentPlans).where(eq(agentPlans.id, planId)).limit(1);
  return plan ?? null;
}

// A plan only if it belongs to this user's campaign (for ids that came from a model or a request)
export async function getScopedPlan(scope: Scope, planId: number) {
  const [plan] = await db
    .select()
    .from(agentPlans)
    .where(and(eq(agentPlans.id, planId), scopeFilter(agentPlans, scope)))
    .limit(1);
  return plan ?? null;
}

export async function getScopedTask(scope: Scope, taskId: number) {
  const [task] = await db
    .select()
    .from(agentTasks)
    .where(and(eq(agentTasks.id, taskId), scopeFilter(agentTasks, scope)))
    .limit(1);
  return task ?? null;
}

export async function getTask(taskId: number) {
  const [task] = await db.select().from(agentTasks).where(eq(agentTasks.id, taskId)).limit(1);
  return task ?? null;
}

export async function listPlanTasks(planId: number) {
  return db.select().from(agentTasks).where(eq(agentTasks.planId, planId)).orderBy(agentTasks.position);
}

// Updates a plan, optionally only while it's in one of `from`. Returns null when nothing matched,
// which is how concurrent runs agree on who gets to make a transition.
export async function updatePlan(
  planId: number,
  patch: Partial<Pick<AgentPlan, "status" | "request" | "summary" | "error" | "completedAt">>,
  from?: PlanStatus[]
) {
  const [row] = await db
    .update(agentPlans)
    .set({ ...patch, updatedAt: new Date() })
    .where(from ? and(eq(agentPlans.id, planId), inArray(agentPlans.status, from)) : eq(agentPlans.id, planId))
    .returning();
  return row ?? null;
}

export type TaskPatch = Partial<
  Pick<
    AgentTask,
    | "status"
    | "instructions"
    | "output"
    | "question"
    | "review"
    | "revisions"
    | "attempts"
    | "error"
    | "startedAt"
    | "completedAt"
    | "scheduledAt"
    | "nextRunAt"
    | "runCount"
    | "consecutiveFailures"
    | "runOwner"
    | "sandboxId"
    | "runState"
    | "interruption"
    | "currentStep"
    | "waitingSince"
    | "expiresAt"
  >
>;

export async function updateTask(taskId: number, patch: TaskPatch, from?: TaskStatus[]) {
  const [row] = await db
    .update(agentTasks)
    .set({ ...patch, updatedAt: new Date() })
    .where(from ? and(eq(agentTasks.id, taskId), inArray(agentTasks.status, from)) : eq(agentTasks.id, taskId))
    .returning();
  return row ?? null;
}

// Updates a task only while the Inngest run `runId` owns it (and, optionally, it's in one of `from`).
// A run that lost the task (cancelled, or reclaimed after going stale) can't overwrite anything.
export async function updateOwnedTask(taskId: number, runId: string, patch: TaskPatch, from?: TaskStatus[]) {
  const owned = and(eq(agentTasks.id, taskId), eq(agentTasks.runOwner, runId));
  const [row] = await db
    .update(agentTasks)
    .set({ ...patch, updatedAt: new Date() })
    .where(from ? and(owned, inArray(agentTasks.status, from)) : owned)
    .returning();
  return row ?? null;
}

// Moves every pending task that's due within the dispatch window, and whose dependencies are all
// completed, to "queued" in one statement, and returns them. Concurrent callers can't both get the
// same task: Postgres re-checks status = 'pending' on each row after any lock it waited on.
export async function queueDueTasks(filter: { planIds?: number[]; scope?: Scope } = {}): Promise<DispatchedTask[]> {
  if (filter.planIds && filter.planIds.length === 0) return [];
  const conditions = [
    eq(agentTasks.status, "pending"),
    lte(agentTasks.scheduledAt, new Date(Date.now() + DISPATCH_WINDOW_MS)),
    // Qualified by table name: inside the subquery an unqualified depends_on would mean dep's own
    sql`NOT EXISTS (SELECT 1 FROM public.agent_tasks dep WHERE dep.id = ANY("agent_tasks"."depends_on") AND dep.status <> 'completed')`,
  ];
  if (filter.planIds) conditions.push(inArray(agentTasks.planId, filter.planIds));
  if (filter.scope) conditions.push(scopeFilter(agentTasks, filter.scope)!);

  return db
    .update(agentTasks)
    .set({ status: "queued", queueSeq: sql`${agentTasks.queueSeq} + 1`, runOwner: null, updatedAt: new Date() })
    .where(and(...conditions))
    .returning(DISPATCH_COLUMNS);
}

// Puts a queued task back to pending (its event couldn't be sent, or a dependency isn't done yet)
export async function releaseQueuedTask(taskId: number, queueSeq: number) {
  const [row] = await db
    .update(agentTasks)
    .set({ status: "pending", updatedAt: new Date() })
    .where(and(eq(agentTasks.id, taskId), eq(agentTasks.queueSeq, queueSeq), eq(agentTasks.status, "queued")))
    .returning({ id: agentTasks.id });
  return !!row;
}

// Claims one dispatch for the Inngest run `runId`: queued → in_progress, only for the current
// queue_seq, and records the run. Calling it again from the same run (a retried step) returns the
// task again instead of failing, so a retry can't lose the claim.
export async function claimTask(taskId: number, queueSeq: number, runId: string) {
  try {
    return await claimInTransaction(taskId, queueSeq, runId);
  } catch (error) {
    if (error instanceof AlreadyClaimed) return null;
    throw error;
  }
}

// Thrown to roll the claim back when another run already recorded this dispatch
class AlreadyClaimed extends Error {}

async function claimInTransaction(taskId: number, queueSeq: number, runId: string) {
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(agentTasks)
      .set({ status: "in_progress", runOwner: runId, attempts: 0, startedAt: new Date(), error: null, updatedAt: new Date() })
      .where(
        and(
          eq(agentTasks.id, taskId),
          eq(agentTasks.queueSeq, queueSeq),
          or(eq(agentTasks.status, "queued"), and(eq(agentTasks.runOwner, runId), inArray(agentTasks.status, ["in_progress", "in_review"])))
        )
      )
      .returning();
    if (!claimed) return null;

    await tx
      .insert(agentTaskRuns)
      .values({
        taskId: claimed.id,
        userId: claimed.userId,
        campaignId: claimed.campaignId,
        queueSeq,
        scheduledFor: claimed.scheduledAt,
        inngestRunId: runId,
      })
      .onConflictDoNothing({ target: [agentTaskRuns.taskId, agentTaskRuns.queueSeq] });

    // The unique (task_id, queue_seq) row is the last word on who runs this dispatch
    const [run] = await tx
      .select({ inngestRunId: agentTaskRuns.inngestRunId })
      .from(agentTaskRuns)
      .where(and(eq(agentTaskRuns.taskId, claimed.id), eq(agentTaskRuns.queueSeq, queueSeq)));
    if (run?.inngestRunId !== runId) throw new AlreadyClaimed();
    return claimed;
  });
}

// The agent_task_runs row of one dispatch
export async function getTaskRunId(taskId: number, queueSeq: number) {
  const [run] = await db
    .select({ id: agentTaskRuns.id })
    .from(agentTaskRuns)
    .where(and(eq(agentTaskRuns.taskId, taskId), eq(agentTaskRuns.queueSeq, queueSeq)))
    .limit(1);
  return run?.id ?? null;
}

// Keeps what the agent reported for this dispatch
export async function saveRunResult(taskId: number, queueSeq: number, result: TaskResult) {
  await db
    .update(agentTaskRuns)
    .set({ result })
    .where(and(eq(agentTaskRuns.taskId, taskId), eq(agentTaskRuns.queueSeq, queueSeq)));
}

// Tasks nobody resumed in time: waiting_for_user → expired, in one statement. Returns them so the
// caller can free their sandbox and settle their plans.
export async function expireWaitingTasks() {
  return db
    .update(agentTasks)
    .set({
      status: "expired",
      runState: null,
      currentStep: null,
      runOwner: null,
      error: "Nobody picked this up in time, so it expired. Retry it when you're ready.",
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(agentTasks.status, "waiting_for_user"), lt(agentTasks.expiresAt, new Date())))
    .returning();
}

// Records how one dispatch ended
export async function finishTaskRun(
  taskId: number,
  queueSeq: number,
  result: { status: "completed" | "failed" | "cancelled"; output?: string | null; error?: string | null }
) {
  await db
    .update(agentTaskRuns)
    .set({ status: result.status, output: result.output ?? null, error: result.error ?? null, completedAt: new Date() })
    .where(and(eq(agentTaskRuns.taskId, taskId), eq(agentTaskRuns.queueSeq, queueSeq), eq(agentTaskRuns.status, "in_progress")));
}

export async function addCommunication(
  scope: Scope,
  message: { planId: number; taskId?: number | null; from: AgentRoleId | "user"; to: AgentRoleId | "user"; kind: CommunicationKind; text: string }
) {
  await db.insert(agentCommunications).values({
    ...scope,
    planId: message.planId,
    taskId: message.taskId ?? null,
    fromAgent: message.from,
    toAgent: message.to,
    kind: message.kind,
    text: message.text,
  });
}

// A task's instructions as saved now (they grow when the user adds information while it runs)
export async function getTaskInstructions(taskId: number) {
  const [row] = await db.select({ instructions: agentTasks.instructions }).from(agentTasks).where(eq(agentTasks.id, taskId)).limit(1);
  return row?.instructions ?? null;
}

export async function listTaskCommunications(taskId: number) {
  return db.select().from(agentCommunications).where(eq(agentCommunications.taskId, taskId)).orderBy(agentCommunications.id);
}

export async function listActivePlans(scope: Scope) {
  return db
    .select()
    .from(agentPlans)
    .where(and(scopeFilter(agentPlans, scope), inArray(agentPlans.status, ACTIVE_PLAN_STATUSES)))
    .orderBy(desc(agentPlans.id));
}

// Tasks waiting for the user to do something in the sandbox (log in, hand it back), oldest first
export async function listWaitingTasks(scope: Scope) {
  return db
    .select({ id: agentTasks.id, planId: agentTasks.planId, agentId: agentTasks.agentId, title: agentTasks.title, interruption: agentTasks.interruption })
    .from(agentTasks)
    .where(and(scopeFilter(agentTasks, scope), eq(agentTasks.status, "waiting_for_user")))
    .orderBy(agentTasks.id);
}

// Tasks waiting on an answer from the user, oldest first
export async function listOpenQuestions(scope: Scope) {
  return db
    .select()
    .from(agentTasks)
    .where(and(scopeFilter(agentTasks, scope), eq(agentTasks.status, "awaiting_input")))
    .orderBy(agentTasks.id);
}

// A worker's latest assignments, newest first
export async function listAgentTasks(scope: Scope, agentId: WorkerRoleId, limit = 8) {
  return db
    .select()
    .from(agentTasks)
    .where(and(scopeFilter(agentTasks, scope), eq(agentTasks.agentId, agentId)))
    .orderBy(desc(agentTasks.id))
    .limit(limit);
}

// Tasks whose Inngest run went missing. Queued ones are returned to be sent again under the same
// dispatch (Inngest drops the duplicate if the first event did arrive). Running ones go back to
// pending, so the next dispatch gets a new queue_seq and the lost run can no longer write.
export async function recoverStaleTasks() {
  const cutoff = new Date(Date.now() - STALE_QUEUED_MS);
  const runningCutoff = new Date(Date.now() - STALE_RUNNING_MS);
  const queued = await db
    .select(DISPATCH_COLUMNS)
    .from(agentTasks)
    .where(and(eq(agentTasks.status, "queued"), lt(agentTasks.updatedAt, cutoff), lt(agentTasks.scheduledAt, cutoff)));

  const interrupted = await db
    .update(agentTasks)
    .set({ status: "pending", runOwner: null, error: "The previous run was interrupted, so it was restarted.", updatedAt: new Date() })
    .where(and(inArray(agentTasks.status, ["in_progress", "in_review"]), lt(agentTasks.updatedAt, runningCutoff)))
    .returning({ id: agentTasks.id, queueSeq: agentTasks.queueSeq });
  await Promise.all(interrupted.map((task) => finishTaskRun(task.id, task.queueSeq, { status: "failed", error: "Interrupted" })));

  return queued;
}

// Recent plans with their tasks and agent messages, newest first, ready for the browser
export async function listPlanViews(scope: Scope, limit = 10): Promise<PlanView[]> {
  const plans = await db.select().from(agentPlans).where(scopeFilter(agentPlans, scope)).orderBy(desc(agentPlans.id)).limit(limit);
  if (plans.length === 0) return [];

  const planIds = plans.map((plan) => plan.id);
  // Everything but the saved run, which can be large
  const { runState: _runState, ...taskColumns } = getTableColumns(agentTasks);
  const [tasks, communications] = await Promise.all([
    db.select(taskColumns).from(agentTasks).where(inArray(agentTasks.planId, planIds)).orderBy(agentTasks.position),
    db.select().from(agentCommunications).where(inArray(agentCommunications.planId, planIds)).orderBy(agentCommunications.id),
  ]);
  const taskIds = tasks.map((task) => task.id);
  const [artifacts, { drafts, research }] = await Promise.all([listArtifactsForTasks(taskIds), listDeliverablesForTasks(taskIds)]);

  return plans.map((plan) => ({
    id: plan.id,
    title: plan.title,
    request: plan.request,
    status: plan.status,
    summary: plan.summary,
    error: plan.error,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    tasks: tasks.filter((task) => task.planId === plan.id).map((task) => ({
      ...toTaskView(task, artifacts.get(task.id) ?? []),
      drafts: drafts.get(task.id) ?? [],
      research: research.get(task.id) ?? [],
    })),
    communications: communications.filter((message) => message.planId === plan.id).map(toCommunicationView),
  }));
}

function toTaskView(task: Omit<AgentTask, "runState">, artifacts: AgentArtifact[]): Omit<TaskView, "drafts" | "research"> {
  return {
    id: task.id,
    planId: task.planId,
    agentId: task.agentId,
    title: task.title,
    instructions: task.instructions,
    dependsOn: task.dependsOn,
    status: task.status,
    scheduledAt: task.scheduledAt.toISOString(),
    repeat: task.repeat,
    nextRunAt: task.nextRunAt?.toISOString() ?? null,
    runCount: task.runCount,
    output: task.output,
    question: task.question,
    review: task.review,
    revisions: task.revisions,
    attempts: task.attempts,
    error: task.error,
    currentStep: task.currentStep,
    interruption: task.interruption,
    waitingSince: task.waitingSince?.toISOString() ?? null,
    expiresAt: task.expiresAt?.toISOString() ?? null,
    artifacts: artifacts.map(toArtifactView),
    startedAt: task.startedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    updatedAt: task.updatedAt.toISOString(),
  };
}

function toCommunicationView(message: AgentCommunication): CommunicationView {
  return {
    id: message.id,
    taskId: message.taskId,
    from: message.fromAgent,
    to: message.toAgent,
    kind: message.kind,
    text: message.text,
    createdAt: message.createdAt.toISOString(),
  };
}
