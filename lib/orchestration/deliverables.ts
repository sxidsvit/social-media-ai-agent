import "server-only";
import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  agentArtifacts,
  agentOutputs,
  agentTaskRuns,
  contentDrafts,
  db,
  researchFindings,
  type AgentTask,
  type ContentDraft,
  type ResearchFinding,
} from "@/db";
import { getAgentRole, type WorkerRoleId } from "@/lib/agent-roles";
import type { WorkerContext } from "@/lib/ai/tools/context";
import { platformName, postText } from "@/lib/social-platforms";
import type { Scope } from "@/lib/orchestration/store";
import type {
  AgentOutputKind,
  ContentDraftView,
  DraftKind,
  DraftMedia,
  ResearchInsight,
  ResearchMethod,
  ResearchSource,
  ResearchView,
} from "@/lib/orchestration/types";

// What the agents deliver, as data: the Research Agent's findings, the Creator Agent's drafts, and
// the final output of every task run. Saved from the agents' tools as they work (so a paused or
// resumed run never loses them), linked to the campaign, plan, task and run, handed to the tasks
// that depend on them, and searchable by the Master Agent later.

type WorkRef = Pick<WorkerContext, "scope" | "plan" | "task" | "taskRunId">;

function links({ scope, plan, task, taskRunId }: WorkRef) {
  return { ...scope, planId: plan.id, taskId: task.id, taskRunId, agentId: task.agentId };
}

// Work saved in this run (or, before the run row exists, on this task)
function sameRun(table: typeof researchFindings | typeof contentDrafts, ref: WorkRef) {
  return ref.taskRunId ? eq(table.taskRunId, ref.taskRunId) : eq(table.taskId, ref.task.id);
}

// Research

export type NewResearch = {
  topic: string;
  summary: string;
  method: ResearchMethod;
  platforms: string[];
  hashtags: string[];
  findings: ResearchInsight[];
  sources: ResearchSource[];
};

// Research this task saved, for an update
export async function getTaskResearch(researchId: number, taskId: number) {
  const [row] = await db.select().from(researchFindings).where(and(eq(researchFindings.id, researchId), eq(researchFindings.taskId, taskId))).limit(1);
  return row ?? null;
}

// Saves new research, or updates the run's earlier save (researchId). Null when there's no such save.
export async function saveResearch(ref: WorkRef, research: NewResearch, researchId: number | null) {
  if (researchId) {
    const [row] = await db
      .update(researchFindings)
      .set({ ...research, updatedAt: new Date() })
      .where(and(eq(researchFindings.id, researchId), eq(researchFindings.taskId, ref.task.id)))
      .returning();
    return row ?? null;
  }
  const [row] = await db.insert(researchFindings).values({ ...links(ref), ...research }).returning();
  return row;
}

// Drafts

export type NewDraft = {
  kind: DraftKind;
  platform: string;
  title: string;
  hook: string | null;
  body: string;
  cta: string | null;
  hashtags: string[];
  media: DraftMedia[];
  notes: string | null;
  metadata: Record<string, unknown>;
};

// Saves a new draft, or updates one this task saved before (draftId). Null when there's no such draft.
export async function saveDraft(ref: WorkRef, draft: NewDraft, draftId: number | null) {
  if (draftId) {
    const [row] = await db
      .update(contentDrafts)
      .set({ ...draft, updatedAt: new Date() })
      .where(and(eq(contentDrafts.id, draftId), eq(contentDrafts.taskId, ref.task.id)))
      .returning();
    return row ?? null;
  }
  const [row] = await db.insert(contentDrafts).values({ ...links(ref), ...draft }).returning();
  return row;
}

// The campaign's images and videos with these URLs, so a draft only links media that really exists
export async function findCampaignMedia(campaignId: number, urls: string[]) {
  if (urls.length === 0) return [];
  return db
    .select({ id: agentArtifacts.id, url: agentArtifacts.url, name: agentArtifacts.name, mimeType: agentArtifacts.mimeType, type: agentArtifacts.type })
    .from(agentArtifacts)
    .where(and(eq(agentArtifacts.campaignId, campaignId), inArray(agentArtifacts.url, urls)));
}

// How much the agent has saved in this run, for the check before it reports
export async function countSavedWork(ref: WorkRef) {
  const [[research], [drafts]] = await Promise.all([
    db.select({ n: count() }).from(researchFindings).where(sameRun(researchFindings, ref)),
    db.select({ n: count() }).from(contentDrafts).where(sameRun(contentDrafts, ref)),
  ]);
  return { research: research.n, drafts: drafts.n };
}

function describeResearchLine(row: ResearchFinding) {
  const live = row.sources.filter((source) => source.url && source.visited).map((source) => source.url);
  return [
    `- Research #${row.id} "${row.topic}" (${row.method === "knowledge" ? "from knowledge" : row.method === "live" ? "checked live" : "knowledge + live"}): ${row.summary}`,
    row.hashtags.length ? `  Hashtags: ${row.hashtags.join(" ")}` : "",
    row.findings.length ? `  Findings: ${row.findings.slice(0, 6).map((finding) => finding.insight).join(" | ")}` : "",
    live.length ? `  Live sources: ${live.slice(0, 6).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function describeDraftLine(row: ContentDraft) {
  const media = row.media.length ? ` — images: ${row.media.map((item) => item.url).join(", ")}` : "";
  return `- Draft #${row.id} [${platformName(row.platform)} ${row.kind}] "${row.title}"${media}`;
}

// What the agent already saved in this run, for a revision or a run that continues: it updates
// these instead of saving them again
export async function describeSavedWork(ref: WorkRef) {
  const [research, drafts] = await Promise.all([
    db.select().from(researchFindings).where(sameRun(researchFindings, ref)).orderBy(researchFindings.id),
    db.select().from(contentDrafts).where(sameRun(contentDrafts, ref)).orderBy(contentDrafts.id),
  ]);
  return [...research.map(describeResearchLine), ...drafts.map(describeDraftLine)].join("\n");
}

// The hand-off: research and drafts saved by the tasks this one depends on
export async function describeDependencyWork(taskIds: number[]) {
  if (taskIds.length === 0) return "";
  const [research, drafts] = await Promise.all([
    db.select().from(researchFindings).where(inArray(researchFindings.taskId, taskIds)).orderBy(desc(researchFindings.id)).limit(10),
    db.select().from(contentDrafts).where(inArray(contentDrafts.taskId, taskIds)).orderBy(desc(contentDrafts.id)).limit(20),
  ]);
  return [...research.reverse().map(describeResearchLine), ...drafts.reverse().map(describeDraftLine)].join("\n");
}

// For the Tasks tab, newest first, up to `perTask` each
export async function listDeliverablesForTasks(taskIds: number[], perTask = 12) {
  const research = new Map<number, ResearchView[]>();
  const drafts = new Map<number, ContentDraftView[]>();
  if (taskIds.length === 0) return { research, drafts };
  const [researchRows, draftRows] = await Promise.all([
    db.select().from(researchFindings).where(inArray(researchFindings.taskId, taskIds)).orderBy(desc(researchFindings.id)),
    db.select().from(contentDrafts).where(inArray(contentDrafts.taskId, taskIds)).orderBy(desc(contentDrafts.id)),
  ]);
  for (const row of researchRows) push(research, row.taskId!, toResearchView(row), perTask);
  for (const row of draftRows) push(drafts, row.taskId!, toDraftView(row), perTask);
  return { research, drafts };
}

function push<T>(map: Map<number, T[]>, key: number, value: T, max: number) {
  const list = map.get(key) ?? [];
  if (list.length < max) list.push(value);
  map.set(key, list);
}

export function toResearchView(row: ResearchFinding): ResearchView {
  return {
    id: row.id,
    taskId: row.taskId,
    topic: row.topic,
    summary: row.summary,
    method: row.method,
    platforms: row.platforms,
    hashtags: row.hashtags,
    findings: row.findings,
    sources: row.sources,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toDraftView(row: ContentDraft): ContentDraftView {
  return {
    id: row.id,
    taskId: row.taskId,
    kind: row.kind,
    platform: row.platform,
    title: row.title,
    hook: row.hook,
    body: row.body,
    cta: row.cta,
    hashtags: row.hashtags,
    media: row.media,
    notes: row.notes,
    status: row.status,
    warnings: Array.isArray(row.metadata.warnings) ? (row.metadata.warnings as string[]) : [],
    createdAt: row.createdAt.toISOString(),
  };
}

// Final outputs

const OUTPUT_KINDS: Record<WorkerRoleId, AgentOutputKind> = { research: "research", creator: "content", scheduler: "schedule", analytics: "report" };

// Saves the reviewed output of the task's current run. Safe to call again for the same run: it
// updates the row (so a retried step never saves it twice).
export async function saveAgentOutput(task: AgentTask) {
  if (!task.output) return;
  const [run] = await db
    .select({ id: agentTaskRuns.id, result: agentTaskRuns.result })
    .from(agentTaskRuns)
    .where(and(eq(agentTaskRuns.taskId, task.id), eq(agentTaskRuns.queueSeq, task.queueSeq)))
    .limit(1);
  const ref = { taskId: task.id, taskRunId: run?.id ?? null };
  const byRun = (table: typeof researchFindings | typeof contentDrafts | typeof agentArtifacts) =>
    ref.taskRunId ? eq(table.taskRunId, ref.taskRunId) : eq(table.taskId, ref.taskId);
  const [[artifacts], [drafts], [research]] = await Promise.all([
    db.select({ n: count() }).from(agentArtifacts).where(byRun(agentArtifacts)),
    db.select({ n: count() }).from(contentDrafts).where(byRun(contentDrafts)),
    db.select({ n: count() }).from(researchFindings).where(byRun(researchFindings)),
  ]);

  const values = {
    taskRunId: ref.taskRunId,
    title: task.title,
    summary: run?.result?.summary ?? null,
    details: run?.result?.details ?? null,
    output: task.output,
    review: task.review,
    metadata: { artifacts: artifacts.n, drafts: drafts.n, research: research.n, revisions: task.revisions, repeating: !!task.repeat },
  };
  await db
    .insert(agentOutputs)
    .values({
      userId: task.userId,
      campaignId: task.campaignId,
      planId: task.planId,
      taskId: task.id,
      runNumber: task.runCount + 1,
      agentId: task.agentId,
      kind: OUTPUT_KINDS[task.agentId],
      ...values,
    })
    .onConflictDoUpdate({ target: [agentOutputs.taskId, agentOutputs.runNumber], set: values });
}

// Search, for the Master Agent (find_saved_work)

export type SavedWorkQuery = { what: "outputs" | "drafts" | "research"; agentId: WorkerRoleId | null; platform: string | null; query: string | null; limit: number };

function clipText(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function words(query: string | null) {
  return (query ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
}

// Every word must appear in one of the columns
function matchAll(query: string | null, columns: AnyPgColumn[]) {
  const terms = words(query);
  if (!terms.length) return undefined;
  return and(...terms.map((term) => or(...columns.map((column) => ilike(column, `%${escapeLike(term)}%`)))));
}

const escapeLike = (text: string) => text.replace(/[%_\\]/g, "\\$&");

const formatDate = (date: Date) => date.toISOString().slice(0, 10);

export async function searchSavedWork(scope: Scope, search: SavedWorkQuery) {
  const limit = Math.min(Math.max(search.limit, 1), 20);

  if (search.what === "drafts") {
    const rows = await db
      .select()
      .from(contentDrafts)
      .where(
        and(
          eq(contentDrafts.userId, scope.userId),
          eq(contentDrafts.campaignId, scope.campaignId),
          search.platform ? eq(contentDrafts.platform, search.platform) : undefined,
          matchAll(search.query, [contentDrafts.title, contentDrafts.body, contentDrafts.hook])
        )
      )
      .orderBy(desc(contentDrafts.id))
      .limit(limit);
    return rows.map((row) =>
      [
        `Draft #${row.id} [${platformName(row.platform)} ${row.kind}, ${row.status}] "${row.title}" (task #${row.taskId}, ${formatDate(row.createdAt)})`,
        clipText(postText(row), 1200),
        row.media.length ? `Images: ${row.media.map((item) => item.url).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  if (search.what === "research") {
    const rows = await db
      .select()
      .from(researchFindings)
      .where(
        and(
          eq(researchFindings.userId, scope.userId),
          eq(researchFindings.campaignId, scope.campaignId),
          search.platform ? sql`${search.platform} = ANY(${researchFindings.platforms})` : undefined,
          matchAll(search.query, [researchFindings.topic, researchFindings.summary])
        )
      )
      .orderBy(desc(researchFindings.id))
      .limit(limit);
    return rows.map((row) => `${describeResearchLine(row).replace(/^- /, "")}\n  (task #${row.taskId}, ${formatDate(row.createdAt)})`);
  }

  const terms = words(search.query).join(" ");
  const rows = await db
    .select()
    .from(agentOutputs)
    .where(
      and(
        eq(agentOutputs.userId, scope.userId),
        eq(agentOutputs.campaignId, scope.campaignId),
        search.agentId ? eq(agentOutputs.agentId, search.agentId) : undefined,
        terms ? or(sql`search @@ websearch_to_tsquery('english', ${terms})`, ilike(agentOutputs.title, `%${escapeLike(terms)}%`)) : undefined
      )
    )
    .orderBy(desc(agentOutputs.id))
    .limit(limit);
  return rows.map((row) =>
    [
      `Output #${row.id}: ${getAgentRole(row.agentId).name}, "${row.title}" (plan #${row.planId}, task #${row.taskId}, run ${row.runNumber}, ${formatDate(row.createdAt)})`,
      clipText(row.summary ? `${row.summary}\n${row.details ?? ""}` : row.output, 1500),
    ].join("\n")
  );
}
