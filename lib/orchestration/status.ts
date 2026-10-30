import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { agentPlans, agentTasks, db } from "@/db";
import { AGENT_ROLES, type WorkerRoleId } from "@/lib/agent-roles";
import { countArtifactsForTasks, listArtifactsForTasks, toArtifactView } from "@/lib/orchestration/artifacts";
import type { Scope } from "@/lib/orchestration/store";
import { ACTIVE_PLAN_STATUSES, type AgentLiveStatus, type AgentStatusView, type LiveStatus, type TaskStatus } from "@/lib/orchestration/types";
import { getSandboxViews } from "@/lib/sandbox/agent-sandbox";

// What every agent is doing right now, straight from the database. The browser polls this and shows
// it as is, so the office, the picker and the popover never guess or fall back to a fixed label.

// A finished task stays the agent's status for this long, unless something newer is going on
const RECENT_MS = 12 * 60 * 60 * 1000;
// Tasks looked at per poll (newest first); plenty to find each agent's current one
const SCAN_LIMIT = 300;

const STATUS_FOR: Partial<Record<TaskStatus, AgentLiveStatus>> = {
  pending: "scheduled",
  queued: "queued",
  in_progress: "running",
  in_review: "running",
  awaiting_input: "needs_input",
  waiting_for_user: "waiting_for_user",
  completed: "done",
  failed: "failed",
  expired: "expired",
};

type Row = Awaited<ReturnType<typeof scanTasks>>[number];

function scanTasks(scope: Scope) {
  return db
    .select({
      id: agentTasks.id,
      planId: agentTasks.planId,
      agentId: agentTasks.agentId,
      title: agentTasks.title,
      status: agentTasks.status,
      currentStep: agentTasks.currentStep,
      question: agentTasks.question,
      interruption: agentTasks.interruption,
      error: agentTasks.error,
      // Only the start of the output: it's the summary in the popover
      summary: sql<string | null>`left(${agentTasks.output}, 600)`,
      scheduledAt: agentTasks.scheduledAt,
      startedAt: agentTasks.startedAt,
      waitingSince: agentTasks.waitingSince,
      expiresAt: agentTasks.expiresAt,
      completedAt: agentTasks.completedAt,
      updatedAt: agentTasks.updatedAt,
    })
    .from(agentTasks)
    .where(and(eq(agentTasks.userId, scope.userId), eq(agentTasks.campaignId, scope.campaignId)))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(SCAN_LIMIT);
}

// The one task that best describes what an agent is doing: anything waiting on the user first, then
// running, queued, a recent result, the next scheduled run, and finally an older result
function pickTask(tasks: Row[]) {
  const find = (...statuses: TaskStatus[]) => tasks.find((task) => statuses.includes(task.status));
  const settled = find("completed", "failed", "expired");
  const recent = settled && Date.now() - settled.updatedAt.getTime() < RECENT_MS ? settled : undefined;
  const scheduled = tasks
    .filter((task) => task.status === "pending")
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];
  return find("waiting_for_user", "awaiting_input") ?? find("in_progress", "in_review") ?? find("queued") ?? recent ?? scheduled ?? settled ?? null;
}

export async function getLiveStatus(scope: Scope): Promise<LiveStatus> {
  const [tasks, activePlans, sandboxes] = await Promise.all([
    scanTasks(scope),
    db
      .select({ status: agentPlans.status })
      .from(agentPlans)
      .where(and(eq(agentPlans.userId, scope.userId), eq(agentPlans.campaignId, scope.campaignId), sql`${agentPlans.status} IN ('in_progress', 'awaiting_user')`)),
    getSandboxViews(scope.campaignId),
  ]);

  const picked = new Map<WorkerRoleId, Row>();
  for (const role of AGENT_ROLES) {
    const task = pickTask(tasks.filter((row) => row.agentId === role.id));
    if (task) picked.set(role.id, task);
  }
  const taskIds = [...picked.values()].map((task) => task.id);
  const [artifacts, counts] = await Promise.all([listArtifactsForTasks(taskIds, 6), countArtifactsForTasks(taskIds)]);

  const agents: AgentStatusView[] = AGENT_ROLES.map((role) => {
    const task = picked.get(role.id);
    if (!task) return { agentId: role.id, status: "idle", task: null };
    return {
      agentId: role.id,
      status: STATUS_FOR[task.status] ?? "idle",
      task: {
        id: task.id,
        planId: task.planId,
        title: task.title,
        status: task.status,
        currentStep: task.currentStep,
        waitingReason: task.status === "waiting_for_user" ? (task.interruption?.reason ?? null) : task.status === "awaiting_input" ? task.question : null,
        interruption: task.status === "waiting_for_user" ? task.interruption : null,
        error: task.error,
        summary: task.summary,
        scheduledAt: task.scheduledAt.toISOString(),
        startedAt: task.startedAt?.toISOString() ?? null,
        waitingSince: task.waitingSince?.toISOString() ?? null,
        expiresAt: task.expiresAt?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
        artifactCount: counts.get(task.id) ?? 0,
        artifacts: (artifacts.get(task.id) ?? []).map(toArtifactView),
      },
    };
  });

  // The Master Agent is busy while any plan is, and waiting while any plan waits on the user
  const masterStatus: AgentLiveStatus = activePlans.some((plan) => plan.status === "awaiting_user")
    ? "needs_input"
    : activePlans.some((plan) => ACTIVE_PLAN_STATUSES.includes(plan.status))
      ? "running"
      : "idle";
  agents.unshift({ agentId: "master", status: masterStatus, task: null });

  return { agents, sandboxes, serverTime: new Date().toISOString() };
}
