import "server-only";
import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { agentSandboxes, agentTasks, campaigns, db, sandboxPreviews, type AgentSandbox } from "@/db";
import { hasComputer, WORKER_IDS, type WorkerRoleId } from "@/lib/agent-roles";
import type { SandboxControl, SandboxView, TaskStatus } from "@/lib/orchestration/types";
import {
  connectDesktop,
  createDesktop,
  ensureStream,
  getDesktopState,
  keepAlive,
  killDesktop,
  newStreamKey,
  pauseDesktop,
  streamUrl,
  type Desktop,
} from "@/lib/sandbox/e2b";

// One E2B desktop per agent per campaign, so agents with a computer work at the same time. Each
// agent keeps its own logins and files between tasks; teammates hand files over as uploaded
// artifacts. The database is the source of truth for each desktop's state; E2B is only asked when
// something has to happen.
//
// One task per agent at a time: a task takes its agent's lease before it starts and renews it with
// every action. A task waiting for the user keeps the lease, so the agent doesn't start other work
// on that desktop while the user logs in. A lease whose task has finished, or that wasn't renewed in
// time, is free to take.

export type SandboxKey = { campaignId: number; agentId: WorkerRoleId };

// A running sandbox nobody has used for this long is paused
export const SANDBOX_IDLE_MS = 3 * 60 * 1000;
// A working task renews its lease with every action; one that stops renewing loses it after this
const LEASE_MS = 10 * 60 * 1000;
// Task statuses that still hold the lease
const LEASE_HOLDING: TaskStatus[] = ["queued", "in_progress", "in_review", "waiting_for_user"];

// The agents that have a computer
const SANDBOX_AGENTS = WORKER_IDS.filter(hasComputer);

const byKey = ({ campaignId, agentId }: SandboxKey) => and(eq(agentSandboxes.campaignId, campaignId), eq(agentSandboxes.agentId, agentId));

// Raw SQL: the lease holder (if any) is still working or waiting
const holderIsLive = sql`EXISTS (SELECT 1 FROM public.agent_tasks t WHERE t.id = "agent_sandboxes"."task_id" AND t.status IN (${sql.join(
  LEASE_HOLDING.map((status) => sql`${status}`),
  sql`, `
)}))`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getCampaignEndedAt(campaignId: number) {
  const [row] = await db.select({ endedAt: campaigns.endedAt }).from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  return row ? row.endedAt : undefined;
}

export async function getSandboxRow(key: SandboxKey): Promise<AgentSandbox | null> {
  const [row] = await db.select().from(agentSandboxes).where(byKey(key)).limit(1);
  return row ?? null;
}

// The agent's row, created on first use (owned by the campaign's user)
async function ensureSandboxRow(key: SandboxKey): Promise<AgentSandbox> {
  const existing = await getSandboxRow(key);
  if (existing) return existing;
  const [campaign] = await db.select({ userId: campaigns.userId }).from(campaigns).where(eq(campaigns.id, key.campaignId)).limit(1);
  if (!campaign) throw new Error("The campaign doesn't exist.");
  await db.insert(agentSandboxes).values({ campaignId: key.campaignId, agentId: key.agentId, userId: campaign.userId }).onConflictDoNothing();
  return (await getSandboxRow(key))!;
}

// Connects to the agent's sandbox, resuming it if it's paused or creating it if there is none.
// Concurrent callers share one creation: the first marks it "starting", the others wait for it.
export async function openAgentSandbox(key: SandboxKey): Promise<Desktop> {
  for (let attempt = 0; attempt < 45; attempt++) {
    if (await getCampaignEndedAt(key.campaignId)) throw new Error("This campaign has ended, so its computers were shut down.");
    const row = await ensureSandboxRow(key);

    if (row.sandboxId) {
      try {
        const desktop = await connectDesktop(row.sandboxId);
        await db
          .update(agentSandboxes)
          .set({ status: "running", activeAt: new Date() })
          .where(and(byKey(key), eq(agentSandboxes.sandboxId, row.sandboxId)));
        return desktop;
      } catch (error) {
        // E2B still has it, so this is a real failure; otherwise it's gone and a new one starts
        if ((await getDesktopState(row.sandboxId)) !== null) throw error;
        console.warn(`Sandbox ${row.sandboxId} of campaign ${key.campaignId} (${key.agentId}) no longer exists; starting a new one`);
        await db
          .update(agentSandboxes)
          .set({ sandboxId: null, status: "none" })
          .where(and(byKey(key), eq(agentSandboxes.sandboxId, row.sandboxId)));
        continue;
      }
    }

    // Claim the creation; a "starting" claim older than two minutes was abandoned
    const [claimed] = await db
      .update(agentSandboxes)
      .set({ status: "starting", activeAt: new Date() })
      .where(
        and(
          byKey(key),
          isNull(agentSandboxes.sandboxId),
          or(ne(agentSandboxes.status, "starting"), lt(agentSandboxes.activeAt, new Date(Date.now() - 120_000)))
        )
      )
      .returning({ campaignId: agentSandboxes.campaignId });
    if (!claimed) {
      await sleep(2000);
      continue;
    }

    try {
      const desktop = await createDesktop({ campaignId: String(key.campaignId), agentId: key.agentId });
      await db
        .update(agentSandboxes)
        .set({ sandboxId: desktop.sandboxId, status: "running", activeAt: new Date(), streamKey: newStreamKey(), viewKey: newStreamKey() })
        .where(byKey(key));
      return desktop;
    } catch (error) {
      await db
        .update(agentSandboxes)
        .set({ status: "none" })
        .where(and(byKey(key), eq(agentSandboxes.status, "starting")));
      throw error;
    }
  }
  throw new Error("The agent's computer is taking too long to start.");
}

// Someone used the sandbox: push back the idle pause
export async function markSandboxActive(key: SandboxKey, desktop?: Desktop) {
  await db.update(agentSandboxes).set({ activeAt: new Date() }).where(byKey(key));
  if (desktop) await keepAlive(desktop).catch(() => undefined);
}

// Saves a screenshot to show while the sandbox is paused
async function savePreview(key: SandboxKey, userId: string, png: Uint8Array) {
  const image = Buffer.from(png).toString("base64");
  await db
    .insert(sandboxPreviews)
    .values({ ...key, userId, image, takenAt: new Date() })
    .onConflictDoUpdate({ target: [sandboxPreviews.campaignId, sandboxPreviews.agentId], set: { image, takenAt: new Date() } });
}

export async function getPreview(key: SandboxKey) {
  const [row] = await db
    .select()
    .from(sandboxPreviews)
    .where(and(eq(sandboxPreviews.campaignId, key.campaignId), eq(sandboxPreviews.agentId, key.agentId)))
    .limit(1);
  return row ?? null;
}

// Pauses the agent's sandbox, after saving a screenshot of where it was. Pass the open desktop
// when there is one, to skip reconnecting.
export async function pauseAgentSandbox(key: SandboxKey, desktop?: Desktop) {
  const row = await getSandboxRow(key);
  if (!row?.sandboxId || row.status !== "running") return false;
  try {
    const open = desktop ?? (await connectDesktop(row.sandboxId));
    await savePreview(key, row.userId, await open.screenshot());
  } catch (error) {
    console.warn(`Couldn't save a preview of campaign ${key.campaignId}'s ${key.agentId} sandbox`, error);
  }
  await pauseDesktop(row.sandboxId);
  await db
    .update(agentSandboxes)
    .set({ status: "paused" })
    .where(and(byKey(key), eq(agentSandboxes.sandboxId, row.sandboxId)));
  return true;
}

// Every agent desktop the campaign has (for exporting files when it ends)
export async function listCampaignSandboxes(campaignId: number) {
  return db.select().from(agentSandboxes).where(and(eq(agentSandboxes.campaignId, campaignId), sql`${agentSandboxes.sandboxId} IS NOT NULL`));
}

// Shuts down every agent's desktop in the campaign
export async function killCampaignSandboxes(campaignId: number) {
  const rows = await listCampaignSandboxes(campaignId);
  await Promise.all(
    rows.map((row) => killDesktop(row.sandboxId!).catch((error) => console.warn(`Killing sandbox ${row.sandboxId} failed`, error)))
  );
  await db
    .update(agentSandboxes)
    .set({ sandboxId: null, status: "killed", taskId: null, leaseUntil: null, control: "agent" })
    .where(eq(agentSandboxes.campaignId, campaignId));
}

// Takes (or renews) the agent's sandbox for a task. False while another of its tasks holds it.
export async function acquireSandboxLease(key: SandboxKey, taskId: number) {
  await ensureSandboxRow(key);
  const [row] = await db
    .update(agentSandboxes)
    .set({ taskId, leaseUntil: new Date(Date.now() + LEASE_MS) })
    .where(
      and(
        byKey(key),
        or(isNull(agentSandboxes.taskId), eq(agentSandboxes.taskId, taskId), lt(agentSandboxes.leaseUntil, new Date()), sql`NOT ${holderIsLive}`)
      )
    )
    .returning({ campaignId: agentSandboxes.campaignId });
  return !!row;
}

// Keeps the lease while the task works, or (until) while it waits for the user
export async function renewSandboxLease(key: SandboxKey, taskId: number, until = new Date(Date.now() + LEASE_MS)) {
  await db
    .update(agentSandboxes)
    .set({ leaseUntil: until })
    .where(and(byKey(key), eq(agentSandboxes.taskId, taskId)));
}

export async function releaseSandboxLease(key: SandboxKey, taskId: number) {
  await db
    .update(agentSandboxes)
    .set({ taskId: null, leaseUntil: null })
    .where(and(byKey(key), eq(agentSandboxes.taskId, taskId)));
}

export async function setSandboxControl(key: SandboxKey, control: SandboxControl) {
  await ensureSandboxRow(key);
  await db.update(agentSandboxes).set({ control, activeAt: new Date() }).where(byKey(key));
}

export async function getSandboxControl(key: SandboxKey): Promise<SandboxControl> {
  const [row] = await db.select({ control: agentSandboxes.control }).from(agentSandboxes).where(byKey(key)).limit(1);
  return row?.control ?? "agent";
}

// The desktop stream URL. "view" only watches and never wakes a paused sandbox (null then);
// "control" resumes or creates it.
export async function getStreamUrl(key: SandboxKey, mode: "view" | "control") {
  if (await getCampaignEndedAt(key.campaignId)) return null;
  const row = await getSandboxRow(key);
  if (mode === "view" && (row?.status !== "running" || !row.sandboxId)) return null;

  const desktop = mode === "control" ? await openAgentSandbox(key) : await connectDesktop(row!.sandboxId!);
  const fresh = await getSandboxRow(key);
  let keys = { full: fresh?.streamKey ?? null, view: fresh?.viewKey ?? null };
  if (!keys.full || !keys.view) {
    keys = { full: newStreamKey(), view: newStreamKey() };
    await db.update(agentSandboxes).set({ streamKey: keys.full, viewKey: keys.view }).where(byKey(key));
  }
  await ensureStream(desktop, { full: keys.full!, view: keys.view! });
  return streamUrl(desktop, mode === "view" ? keys.view! : keys.full!, mode === "view");
}

// Running sandboxes nobody has used for SANDBOX_IDLE_MS and no agent is working in. Also brings the
// database up to date when E2B paused or dropped one on its own.
export async function pauseIdleSandboxes() {
  const cutoff = new Date(Date.now() - SANDBOX_IDLE_MS);
  const idle = await db
    .select()
    .from(agentSandboxes)
    .where(
      and(
        eq(agentSandboxes.status, "running"),
        or(isNull(agentSandboxes.activeAt), lt(agentSandboxes.activeAt, cutoff)),
        // No task actively working (a task waiting for the user doesn't keep it awake)
        sql`NOT EXISTS (SELECT 1 FROM public.agent_tasks t WHERE t.id = "agent_sandboxes"."task_id" AND t.status IN ('queued', 'in_progress', 'in_review') AND "agent_sandboxes"."lease_until" > now())`
      )
    );

  let paused = 0;
  for (const row of idle) {
    const key = { campaignId: row.campaignId, agentId: row.agentId };
    try {
      const state = row.sandboxId ? await getDesktopState(row.sandboxId) : null;
      if (state === "running") {
        if (await pauseAgentSandbox(key)) paused++;
      } else {
        await db
          .update(agentSandboxes)
          .set(state === "paused" ? { status: "paused" } : { status: "none", sandboxId: null })
          .where(and(byKey(key), eq(agentSandboxes.status, "running")));
      }
    } catch (error) {
      console.error(`Pausing campaign ${row.campaignId}'s ${row.agentId} sandbox failed`, error);
    }
  }
  return paused;
}

// Every computer agent's desktop as the browser sees it (no keys)
export async function getSandboxViews(campaignId: number): Promise<Partial<Record<WorkerRoleId, SandboxView>>> {
  const [endedAt, rows, previews] = await Promise.all([
    getCampaignEndedAt(campaignId),
    db.select().from(agentSandboxes).where(eq(agentSandboxes.campaignId, campaignId)),
    db.select({ agentId: sandboxPreviews.agentId }).from(sandboxPreviews).where(eq(sandboxPreviews.campaignId, campaignId)),
  ]);
  const holderIds = rows.map((row) => row.taskId).filter((id): id is number => id !== null);
  const holders = holderIds.length
    ? await db
        .select({ id: agentTasks.id })
        .from(agentTasks)
        .where(and(inArray(agentTasks.id, holderIds), inArray(agentTasks.status, LEASE_HOLDING)))
    : [];
  const live = new Set(holders.map((task) => task.id));

  const views: Partial<Record<WorkerRoleId, SandboxView>> = {};
  for (const agentId of SANDBOX_AGENTS) {
    const row = rows.find((candidate) => candidate.agentId === agentId);
    views[agentId] = {
      agentId,
      status: row?.status ?? "none",
      control: row?.control ?? "agent",
      activeTaskId: row?.taskId && live.has(row.taskId) ? row.taskId : null,
      activeAt: row?.activeAt?.toISOString() ?? null,
      hasPreview: previews.some((preview) => preview.agentId === agentId),
      ended: !!endedAt,
    };
  }
  return views;
}
