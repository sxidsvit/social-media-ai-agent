import { after } from "next/server";
import { z } from "zod";
import { getRequestScope } from "@/lib/request-scope";
import { cancelPlan, resumeTask, retryPlan, retryTask } from "@/lib/orchestration/control";
import { dispatchDueTasks, resumePlans } from "@/lib/orchestration/engine";
import { listPlanViews } from "@/lib/orchestration/store";
import { getLatestChatMessageId } from "@/lib/agent-chats";

export const runtime = "nodejs";

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(10),
  // Set when the workspace first opens: dispatches anything that's due
  resume: z.literal("1").optional(),
});

const Action = z.union([
  z.object({ action: z.enum(["cancel", "retry"]), planId: z.number().int().positive() }),
  // "resume": the user is done in the sandbox ("Done"); "retry-task": run a failed or expired task again
  z.object({ action: z.enum(["resume", "retry-task"]), taskId: z.number().int().positive() }),
]);


// The campaign's latest plans with their tasks and agent messages: ?limit=10[&resume=1].
// Also the id of the Master Agent's newest chat message, so the chat knows when it has news.
export async function GET(request: Request) {
  const scope = await getRequestScope();
  if (!scope) return Response.json({ error: "Not signed in" }, { status: 401 });

  const parsed = ListQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  if (parsed.data.resume) {
    after(() => resumePlans(scope).catch((error) => console.error("Resuming plans failed", error)));
  }

  const [plans, lastMasterMessageId] = await Promise.all([
    listPlanViews(scope, parsed.data.limit),
    getLatestChatMessageId({ ...scope, agentId: "master" }),
  ]);
  return Response.json({ plans, lastMasterMessageId }, { headers: { "Cache-Control": "no-store" } });
}

// Cancel or retry a plan from the Tasks tab; resume or retry one task from the office or Computer tab
export async function POST(request: Request) {
  const scope = await getRequestScope();
  if (!scope) return Response.json({ error: "Not signed in" }, { status: 401 });

  const parsed = Action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const body = parsed.data;

  const result =
    "planId" in body
      ? body.action === "cancel"
        ? await cancelPlan(scope, body.planId)
        : await retryPlan(scope, body.planId)
      : body.action === "resume"
        ? await resumeTask(scope, body.taskId)
        : await retryTask(scope, body.taskId);
  if (!result.ok) return Response.json({ error: result.message }, { status: 409 });
  if (result.planId) {
    const restarted = result.planId;
    after(() => dispatchDueTasks({ planIds: [restarted] }));
  }
  return Response.json({ ok: true });
}
