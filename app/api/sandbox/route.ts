import { after } from "next/server";
import { z } from "zod";
import { hasComputer, WORKER_IDS } from "@/lib/agent-roles";
import { getRequestScope } from "@/lib/request-scope";
import { dispatchDueTasks } from "@/lib/orchestration/engine";
import { resumeTask } from "@/lib/orchestration/control";
import { getScopedTask, listWaitingTasks } from "@/lib/orchestration/store";
import {
  getCampaignEndedAt,
  getSandboxRow,
  getStreamUrl,
  markSandboxActive,
  openAgentSandbox,
  pauseAgentSandbox,
  setSandboxControl,
  type SandboxKey,
} from "@/lib/sandbox/agent-sandbox";
import { extendDesktop } from "@/lib/sandbox/e2b";

export const runtime = "nodejs";
// Starting or resuming a desktop can take a little while
export const maxDuration = 120;

// Each computer agent's own computer in the campaign, for its owner. Stream URLs carry a password,
// so they're only handed out here: a view-only one to watch, and a full-control one only while the
// user has taken over or the agent is waiting for them (to log in). API keys never leave the server.

const AgentId = z.enum(WORKER_IDS).refine(hasComputer, "This agent doesn't have a computer.");

const StreamQuery = z.object({ mode: z.enum(["view", "control"]), agent: AgentId });

const Action = z.discriminatedUnion("action", [
  // Open the agent's computer so the user can do what its waiting task asked (usually log in)
  z.object({ action: z.literal("login-now"), taskId: z.number().int().positive() }),
  // Take control: the agent stops at its next action until the user hands it back
  z.object({ action: z.literal("take-over"), agent: AgentId }),
  z.object({ action: z.literal("hand-back"), agent: AgentId }),
  z.object({ action: z.literal("pause"), agent: AgentId }),
  z.object({ action: z.literal("start"), agent: AgentId }),
  // Sent while the full-control viewer is open, so the computer isn't paused under the user
  z.object({ action: z.literal("heartbeat"), agent: AgentId }),
]);

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// ?mode=view&agent=research: watch the agent's running computer (null url while it's paused or not started)
// ?mode=control&agent=research: interact, only while the user has control or the agent waits for them
export async function GET(request: Request) {
  const scope = await getRequestScope();
  if (!scope) return json({ error: "Not signed in" }, 401);
  const parsed = StreamQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);

  const key: SandboxKey = { campaignId: scope.campaignId, agentId: parsed.data.agent };
  if (await getCampaignEndedAt(scope.campaignId)) return json({ error: "This campaign's computers were shut down." }, 409);
  if (parsed.data.mode === "control") {
    const row = await getSandboxRow(key);
    const waiting = (await listWaitingTasks(scope)).some((task) => task.agentId === key.agentId);
    if (row?.control !== "user" && !waiting) return json({ error: "Take over the computer first." }, 403);
  }
  try {
    return json({ url: await getStreamUrl(key, parsed.data.mode) });
  } catch (error) {
    console.error("Getting the sandbox stream failed", error);
    return json({ error: "The computer couldn't be reached. Please try again." }, 502);
  }
}

export async function POST(request: Request) {
  const scope = await getRequestScope();
  if (!scope) return json({ error: "Not signed in" }, 401);
  const parsed = Action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  const body = parsed.data;

  if (await getCampaignEndedAt(scope.campaignId)) return json({ error: "This campaign has ended, so its computers were shut down." }, 409);

  try {
    if (body.action === "login-now") {
      // The computer is the one of the agent whose task is waiting
      const task = await getScopedTask(scope, body.taskId);
      if (!task || task.status !== "waiting_for_user") return json({ error: "That task isn't waiting for you any more." }, 409);
      return json({ url: await getStreamUrl({ campaignId: scope.campaignId, agentId: task.agentId }, "control") });
    }

    const key: SandboxKey = { campaignId: scope.campaignId, agentId: body.agent };
    switch (body.action) {
      case "take-over":
        await setSandboxControl(key, "user");
        return json({ url: await getStreamUrl(key, "control") });
      case "hand-back": {
        await setSandboxControl(key, "agent");
        // The agent's task that stopped because of the takeover carries on
        const held = (await listWaitingTasks(scope)).filter((task) => task.agentId === key.agentId && task.interruption?.kind === "takeover");
        const planIds: number[] = [];
        for (const task of held) {
          const result = await resumeTask(scope, task.id);
          if (result.ok && result.planId) planIds.push(result.planId);
        }
        if (planIds.length) after(() => dispatchDueTasks({ planIds }));
        return json({ ok: true });
      }
      case "pause": {
        // Not while the agent is working in it (unless the user has taken over)
        const row = await getSandboxRow(key);
        const working =
          row?.taskId && row.control === "agent" && row.leaseUntil && row.leaseUntil > new Date() ? await getScopedTask(scope, row.taskId) : null;
        if (working && ["queued", "in_progress", "in_review"].includes(working.status)) {
          return json({ error: "The agent is using its computer. Take over first, then pause it." }, 409);
        }
        await pauseAgentSandbox(key);
        return json({ ok: true });
      }
      case "start":
        await openAgentSandbox(key);
        return json({ url: await getStreamUrl(key, "view") });
      case "heartbeat": {
        const row = await getSandboxRow(key);
        if (row?.status === "running" && row.sandboxId) {
          await markSandboxActive(key);
          await extendDesktop(row.sandboxId).catch(() => undefined);
        }
        return json({ ok: true });
      }
    }
  } catch (error) {
    console.error(`Sandbox action ${body.action} failed`, error);
    return json({ error: "The computer couldn't be reached. Please try again." }, 502);
  }
}
