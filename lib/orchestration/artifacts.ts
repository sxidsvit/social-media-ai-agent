import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { agentArtifacts, db, type AgentArtifact } from "@/db";
import { getAgentRole } from "@/lib/agent-roles";
import type { WorkerContext } from "@/lib/ai/tools/context";
import type { ArtifactType, ArtifactView, TaskResult } from "@/lib/orchestration/types";
import type { Scope } from "@/lib/orchestration/store";

// Files and links the agents produce. Saved as soon as they exist (so a paused or resumed run never
// loses them), linked to the campaign, plan, task and run, and handed to the tasks that depend on
// them.

export type NewArtifact = {
  type: ArtifactType;
  name: string;
  url?: string | null;
  imagekitFileId?: string | null;
  sandboxPath?: string | null;
  mimeType?: string | null;
  metadata?: Record<string, unknown>;
};

// Saves an artifact for the task the agent is working on, unless the task already has it (same URL,
// or same sandbox file without a URL)
export async function saveTaskArtifact(context: Pick<WorkerContext, "scope" | "plan" | "task" | "taskRunId">, artifact: NewArtifact) {
  const { scope, plan, task } = context;
  const same = artifact.url
    ? eq(agentArtifacts.url, artifact.url)
    : artifact.sandboxPath
      ? and(eq(agentArtifacts.sandboxPath, artifact.sandboxPath), isNull(agentArtifacts.url))
      : null;
  if (same) {
    const [existing] = await db.select().from(agentArtifacts).where(and(eq(agentArtifacts.taskId, task.id), same)).limit(1);
    if (existing) {
      // A later report can add what an upload didn't know (a better name, metadata)
      const [updated] = await db
        .update(agentArtifacts)
        .set({ name: artifact.name, metadata: { ...existing.metadata, ...artifact.metadata } })
        .where(eq(agentArtifacts.id, existing.id))
        .returning();
      return updated;
    }
  }
  const [row] = await db
    .insert(agentArtifacts)
    .values({
      ...scope,
      planId: plan.id,
      taskId: task.id,
      taskRunId: context.taskRunId,
      agentId: task.agentId,
      type: artifact.type,
      name: artifact.name,
      url: artifact.url ?? null,
      imagekitFileId: artifact.imagekitFileId ?? null,
      sandboxPath: artifact.sandboxPath ?? null,
      mimeType: artifact.mimeType ?? null,
      metadata: artifact.metadata ?? {},
    })
    .returning();
  return row;
}

// The artifacts listed in a report_result (most were saved already when they were made)
export async function saveReportedArtifacts(context: Pick<WorkerContext, "scope" | "plan" | "task" | "taskRunId">, result: TaskResult) {
  for (const artifact of result.artifacts) {
    if (!artifact.url && !artifact.sandboxPath) continue;
    await saveTaskArtifact(context, {
      type: artifact.type,
      name: artifact.name,
      url: artifact.url,
      sandboxPath: artifact.sandboxPath,
      metadata: artifact.metadata,
    });
  }
}

// Campaign files exported when the campaign ends (no task)
export async function saveCampaignArtifact(scope: Scope, artifact: NewArtifact) {
  await db.insert(agentArtifacts).values({
    ...scope,
    type: artifact.type,
    name: artifact.name,
    url: artifact.url ?? null,
    imagekitFileId: artifact.imagekitFileId ?? null,
    sandboxPath: artifact.sandboxPath ?? null,
    mimeType: artifact.mimeType ?? null,
    metadata: artifact.metadata ?? {},
  });
}

export async function listCampaignSandboxPaths(campaignId: number) {
  const rows = await db
    .select({ sandboxPath: agentArtifacts.sandboxPath })
    .from(agentArtifacts)
    .where(and(eq(agentArtifacts.campaignId, campaignId), sql`${agentArtifacts.url} IS NOT NULL`, sql`${agentArtifacts.sandboxPath} IS NOT NULL`));
  return new Set(rows.map((row) => row.sandboxPath!));
}

// Newest first, up to `perTask` per task
export async function listArtifactsForTasks(taskIds: number[], perTask = 12) {
  const byTask = new Map<number, AgentArtifact[]>();
  if (taskIds.length === 0) return byTask;
  const rows = await db.select().from(agentArtifacts).where(inArray(agentArtifacts.taskId, taskIds)).orderBy(desc(agentArtifacts.id));
  for (const row of rows) {
    const list = byTask.get(row.taskId!) ?? [];
    if (list.length < perTask) list.push(row);
    byTask.set(row.taskId!, list);
  }
  return byTask;
}

export async function countArtifactsForTasks(taskIds: number[]) {
  const counts = new Map<number, number>();
  if (taskIds.length === 0) return counts;
  const rows = await db
    .select({ taskId: agentArtifacts.taskId, count: sql<number>`count(*)::int` })
    .from(agentArtifacts)
    .where(inArray(agentArtifacts.taskId, taskIds))
    .groupBy(agentArtifacts.taskId);
  for (const row of rows) counts.set(row.taskId!, row.count);
  return counts;
}

// The hand-off: what the tasks this one depends on produced, for the next agent's input
export async function describeDependencyArtifacts(taskIds: number[]) {
  const byTask = await listArtifactsForTasks(taskIds, 20);
  const lines: string[] = [];
  for (const artifacts of byTask.values()) {
    for (const artifact of [...artifacts].reverse()) {
      // Each agent has its own computer: a path is on the teammate's, so the URL is what to use
      const where = [artifact.url, artifact.sandboxPath && `on their computer at ${artifact.sandboxPath}`].filter(Boolean).join(" · ");
      const note = typeof artifact.metadata.description === "string" ? ` — ${artifact.metadata.description}` : "";
      lines.push(`- [${artifact.type}] ${artifact.name} (${artifact.agentId ? getAgentRole(artifact.agentId).name : "campaign"}): ${where}${note}`);
    }
  }
  return lines.join("\n");
}

export function toArtifactView(artifact: AgentArtifact): ArtifactView {
  return {
    id: artifact.id,
    taskId: artifact.taskId,
    agentId: artifact.agentId,
    type: artifact.type,
    name: artifact.name,
    url: artifact.url,
    sandboxPath: artifact.sandboxPath,
    mimeType: artifact.mimeType,
    metadata: artifact.metadata,
    createdAt: artifact.createdAt.toISOString(),
  };
}

// Guesses a file's type and MIME type from its name
export function describeFile(path: string): { type: ArtifactType; mimeType: string } {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const images: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };
  const videos: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
  const data: Record<string, string> = { json: "application/json", csv: "text/csv" };
  const docs: Record<string, string> = { md: "text/markdown", txt: "text/plain", pdf: "application/pdf", html: "text/html" };
  if (images[ext]) return { type: "image", mimeType: images[ext] };
  if (videos[ext]) return { type: "video", mimeType: videos[ext] };
  if (data[ext]) return { type: "data", mimeType: data[ext] };
  return { type: "document", mimeType: docs[ext] ?? "application/octet-stream" };
}
