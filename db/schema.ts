import { bigint, bigserial, boolean, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { AgentRoleId, WorkerRoleId } from "@/lib/agent-roles";
import type { BlotatoAccount } from "@/lib/blotato/shared";
import type { BlotatoMetricsSnapshot } from "@/lib/analytics/shared";
import type { PlatformResults, PostMedia, PostPlatform, PostStatus } from "@/lib/posts/shared";
import type {
  AgentOutputKind,
  ArtifactType,
  CommunicationKind,
  DraftKind,
  DraftMedia,
  DraftStatus,
  PlanStatus,
  RepeatRule,
  ResearchInsight,
  ResearchMethod,
  ResearchSource,
  SandboxControl,
  SandboxStatus,
  TaskInterruption,
  TaskResult,
  TaskStatus,
} from "@/lib/orchestration/types";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  // InsForge auth user id (auth.users.id)
  userId: uuid("user_id").notNull().unique(),
  name: text("name"),
  email: text("email").notNull().unique(),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// Created by migrations/20261012200402_create-campaigns.sql (FK + RLS live there)
export const campaigns = pgTable(
  "campaigns",
  {
    id: serial("id").primaryKey(),
    // InsForge auth user id (auth.users.id)
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    // Preset icon id (see lib/campaign-icons.ts); used when iconUrl is null
    icon: text("icon"),
    // Custom icon uploaded to the "campaign-icons" storage bucket
    iconUrl: text("icon_url"),
    iconKey: text("icon_key"),
    // Public path of the selected office image, e.g. /offices/modern-office.png
    officeImage: text("office_image").notNull(),
    // Set when the user ends the campaign: every agent's desktop is exported and shut down
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("campaigns_user_id_idx").on(table.userId)]
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;

// Created by migrations/20261013015309_create-agent-messages.sql (FKs + RLS live there)
export const agentMessages = pgTable(
  "agent_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // InsForge auth user id (auth.users.id)
    userId: uuid("user_id").notNull(),
    campaignId: integer("campaign_id").notNull(),
    // Agent role id (see lib/agent-roles.ts), including "master" for the Master Agent's chat
    agentId: text("agent_id").$type<AgentRoleId>().notNull(),
    sender: text("sender").$type<"user" | "agent">().notNull(),
    text: text("text").notNull(),
    // A cut-off reply: shown in the chat but not sent back to the agent as context
    failed: boolean("failed").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("agent_messages_chat_idx").on(table.userId, table.campaignId, table.agentId, table.id.desc())]
);

export type AgentMessage = typeof agentMessages.$inferSelect;
export type NewAgentMessage = typeof agentMessages.$inferInsert;

// Created by migrations/20261013213225_create-agent-orchestration.sql (FKs, checks + RLS live there)
// One user request, as planned by the Master Agent
export const agentPlans = pgTable(
  "agent_plans",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull(),
    campaignId: integer("campaign_id").notNull(),
    title: text("title").notNull(),
    request: text("request").notNull(),
    status: text("status").$type<PlanStatus>().default("in_progress").notNull(),
    summary: text("summary"),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [index("agent_plans_campaign_idx").on(table.userId, table.campaignId, table.id.desc())]
);

export type AgentPlan = typeof agentPlans.$inferSelect;

// One assignment from the Master Agent to a worker agent
export const agentTasks = pgTable(
  "agent_tasks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    planId: bigint("plan_id", { mode: "number" }).notNull(),
    userId: uuid("user_id").notNull(),
    campaignId: integer("campaign_id").notNull(),
    agentId: text("agent_id").$type<WorkerRoleId>().notNull(),
    position: integer("position").default(0).notNull(),
    title: text("title").notNull(),
    instructions: text("instructions").notNull(),
    // Ids of tasks in the same plan that must be completed first
    dependsOn: bigint("depends_on", { mode: "number" }).array().default([]).notNull(),
    status: text("status").$type<TaskStatus>().default("pending").notNull(),
    // Scheduling (migrations/20261014090000_schedule-agent-tasks.sql): when it runs, and if it repeats
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).defaultNow().notNull(),
    repeat: jsonb("repeat").$type<RepeatRule>(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    runCount: integer("run_count").default(0).notNull(),
    consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
    // Bumped on every pending → queued move; identifies one dispatch to Inngest
    queueSeq: integer("queue_seq").default(0).notNull(),
    // Inngest run id that claimed the current dispatch; only that run may write the result
    runOwner: text("run_owner"),
    output: text("output"),
    // Open question waiting on the user (status = awaiting_input)
    question: text("question"),
    review: text("review"),
    revisions: integer("revisions").default(0).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    error: text("error"),
    // Sandbox runs (migrations/20261015090000_agent-sandboxes.sql): the sandbox used, the saved run
    // while it waits for the user, why it waits, and what the agent is doing right now
    sandboxId: text("sandbox_id"),
    runState: text("run_state"),
    interruption: jsonb("interruption").$type<TaskInterruption>(),
    currentStep: text("current_step"),
    waitingSince: timestamp("waiting_since", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("agent_tasks_plan_idx").on(table.planId, table.position),
    index("agent_tasks_agent_idx").on(table.userId, table.campaignId, table.agentId, table.id.desc()),
  ]
);

export type AgentTask = typeof agentTasks.$inferSelect;

// One execution of a task (one per dispatch), so repeating tasks keep every result
export const agentTaskRuns = pgTable(
  "agent_task_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    taskId: bigint("task_id", { mode: "number" }).notNull(),
    userId: uuid("user_id").notNull(),
    campaignId: integer("campaign_id").notNull(),
    queueSeq: integer("queue_seq").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    inngestRunId: text("inngest_run_id").notNull(),
    status: text("status").$type<"in_progress" | "completed" | "failed" | "cancelled">().default("in_progress").notNull(),
    output: text("output"),
    // What the agent reported with report_result
    result: jsonb("result").$type<TaskResult>(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    unique("agent_task_runs_task_id_queue_seq_key").on(table.taskId, table.queueSeq),
    index("agent_task_runs_task_idx").on(table.taskId, table.id.desc()),
  ]
);

export type AgentTaskRun = typeof agentTaskRuns.$inferSelect;

// Everything the agents say to each other, plus the Master Agent's questions to the user
export const agentCommunications = pgTable(
  "agent_communications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull(),
    campaignId: integer("campaign_id").notNull(),
    planId: bigint("plan_id", { mode: "number" }).notNull(),
    taskId: bigint("task_id", { mode: "number" }),
    // Agent role id, or "user"
    fromAgent: text("from_agent").$type<AgentRoleId | "user">().notNull(),
    toAgent: text("to_agent").$type<AgentRoleId | "user">().notNull(),
    kind: text("kind").$type<CommunicationKind>().notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("agent_communications_plan_idx").on(table.planId, table.id)]
);

export type AgentCommunication = typeof agentCommunications.$inferSelect;

// Files and links the agents produced (migrations/20261015090000_agent-sandboxes.sql). Rows without a
// task are files exported from the sandbox when the campaign ended.
export const agentArtifacts = pgTable(
  "agent_artifacts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull(),
    campaignId: integer("campaign_id").notNull(),
    planId: bigint("plan_id", { mode: "number" }),
    taskId: bigint("task_id", { mode: "number" }),
    taskRunId: bigint("task_run_id", { mode: "number" }),
    agentId: text("agent_id").$type<WorkerRoleId>(),
    type: text("type").$type<ArtifactType>().notNull(),
    name: text("name").notNull(),
    // Permanent ImageKit URL (or an external link); null for a file only in the sandbox
    url: text("url"),
    imagekitFileId: text("imagekit_file_id"),
    sandboxPath: text("sandbox_path"),
    mimeType: text("mime_type"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("agent_artifacts_task_idx").on(table.taskId, table.id.desc()), index("agent_artifacts_campaign_idx").on(table.campaignId, table.id.desc())]
);

export type AgentArtifact = typeof agentArtifacts.$inferSelect;
export type NewAgentArtifact = typeof agentArtifacts.$inferInsert;

// Each agent's E2B desktop in a campaign (migrations/20261016090000_sandbox-per-agent.sql), so agents
// with a computer can work at the same time
export const agentSandboxes = pgTable(
  "agent_sandboxes",
  {
    campaignId: integer("campaign_id").notNull(),
    agentId: text("agent_id").$type<WorkerRoleId>().notNull(),
    userId: uuid("user_id").notNull(),
    sandboxId: text("sandbox_id"),
    status: text("status").$type<SandboxStatus>().default("none").notNull(),
    activeAt: timestamp("active_at", { withTimezone: true }),
    // The agent's task using the sandbox (one of its tasks at a time) and until when
    taskId: bigint("task_id", { mode: "number" }),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    control: text("control").$type<SandboxControl>().default("agent").notNull(),
    // Desktop stream passwords: full control and view only. Never sent to the browser on their own.
    streamKey: text("stream_key"),
    viewKey: text("view_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.campaignId, table.agentId] })]
);

export type AgentSandbox = typeof agentSandboxes.$inferSelect;

// Each agent desktop's last screenshot (base64 PNG), shown while it's paused
export const sandboxPreviews = pgTable(
  "sandbox_previews",
  {
    campaignId: integer("campaign_id").notNull(),
    agentId: text("agent_id").$type<WorkerRoleId>().notNull(),
    userId: uuid("user_id").notNull(),
    image: text("image").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.campaignId, table.agentId] })]
);

// What the agents deliver, as data (migrations/20261017090000_agent-deliverables.sql)
// The Research Agent's findings and their sources (save_research)
export const researchFindings = pgTable(
  "research_findings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull(),
    campaignId: integer("campaign_id").notNull(),
    planId: bigint("plan_id", { mode: "number" }),
    taskId: bigint("task_id", { mode: "number" }),
    taskRunId: bigint("task_run_id", { mode: "number" }),
    agentId: text("agent_id").$type<WorkerRoleId>().notNull(),
    topic: text("topic").notNull(),
    summary: text("summary").notNull(),
    method: text("method").$type<ResearchMethod>().notNull(),
    platforms: text("platforms").array().default([]).notNull(),
    hashtags: text("hashtags").array().default([]).notNull(),
    findings: jsonb("findings").$type<ResearchInsight[]>().default([]).notNull(),
    sources: jsonb("sources").$type<ResearchSource[]>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("research_findings_task_idx").on(table.taskId, table.id.desc()), index("research_findings_campaign_idx").on(table.campaignId, table.id.desc())]
);

export type ResearchFinding = typeof researchFindings.$inferSelect;

// The Creator Agent's posts, captions, hashtag sets and ideas, with their images (save_draft)
export const contentDrafts = pgTable(
  "content_drafts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull(),
    campaignId: integer("campaign_id").notNull(),
    planId: bigint("plan_id", { mode: "number" }),
    taskId: bigint("task_id", { mode: "number" }),
    taskRunId: bigint("task_run_id", { mode: "number" }),
    agentId: text("agent_id").$type<WorkerRoleId>().notNull(),
    kind: text("kind").$type<DraftKind>().notNull(),
    platform: text("platform").notNull(),
    title: text("title").notNull(),
    hook: text("hook"),
    body: text("body").notNull(),
    cta: text("cta"),
    hashtags: text("hashtags").array().default([]).notNull(),
    media: jsonb("media").$type<DraftMedia[]>().default([]).notNull(),
    notes: text("notes"),
    status: text("status").$type<DraftStatus>().default("draft").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("content_drafts_task_idx").on(table.taskId, table.id.desc()), index("content_drafts_campaign_idx").on(table.campaignId, table.platform, table.id.desc())]
);

export type ContentDraft = typeof contentDrafts.$inferSelect;

// The final, reviewed output of every task run of every agent. The SQL also adds a generated
// full-text `search` column (title, summary, details) used by searchSavedWork.
export const agentOutputs = pgTable(
  "agent_outputs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull(),
    campaignId: integer("campaign_id").notNull(),
    planId: bigint("plan_id", { mode: "number" }).notNull(),
    taskId: bigint("task_id", { mode: "number" }).notNull(),
    taskRunId: bigint("task_run_id", { mode: "number" }),
    runNumber: integer("run_number").notNull(),
    agentId: text("agent_id").$type<WorkerRoleId>().notNull(),
    kind: text("kind").$type<AgentOutputKind>().notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    details: text("details"),
    output: text("output").notNull(),
    review: text("review"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("agent_outputs_task_id_run_number_key").on(table.taskId, table.runNumber),
    index("agent_outputs_campaign_idx").on(table.campaignId, table.agentId, table.id.desc()),
  ]
);

export type AgentOutput = typeof agentOutputs.$inferSelect;

// Posts the user schedules (migrations/20261018090000_create-posts.sql): written in the post editor
// or started from an agent's draft
export const posts = pgTable(
  "posts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull(),
    campaignId: integer("campaign_id").notNull(),
    source: text("source").$type<"manual" | "ai">().default("manual").notNull(),
    draftId: bigint("draft_id", { mode: "number" }),
    title: text("title").notNull(),
    caption: text("caption").default("").notNull(),
    hashtags: text("hashtags").array().default([]).notNull(),
    platforms: text("platforms").array().notNull(),
    media: jsonb("media").$type<PostMedia[]>().default([]).notNull(),
    status: text("status").$type<PostStatus>().default("scheduled").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    timeZone: text("time_zone").default("UTC").notNull(),
    // Which Blotato account each platform publishes to (migrations/20261019090000_blotato-integration.sql)
    accountIds: jsonb("account_ids").$type<Partial<Record<PostPlatform, string>>>().default({}).notNull(),
    platformResults: jsonb("platform_results").$type<PlatformResults>().default({}).notNull(),
    error: text("error"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("posts_campaign_idx").on(table.campaignId, table.id.desc()), index("posts_due_idx").on(table.status, table.scheduledAt)]
);

export type Post = typeof posts.$inferSelect;

// A user's connection to Blotato (migrations/20261019090000_blotato-integration.sql). Server-only: the
// key is encrypted (lib/crypto/secrets.ts) and the table has no grants for the browser.
export const userIntegrations = pgTable(
  "user_integrations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull(),
    provider: text("provider").$type<"blotato">().notNull(),
    apiKeyEncrypted: text("api_key_encrypted").notNull(),
    keyHint: text("key_hint").notNull(),
    accounts: jsonb("accounts").$type<BlotatoAccount[]>().default([]).notNull(),
    accountsRefreshedAt: timestamp("accounts_refreshed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("user_integrations_user_id_provider_key").on(table.userId, table.provider)]
);

export type UserIntegration = typeof userIntegrations.$inferSelect;

// Published and failed posts as Blotato reports them, with their latest metrics
// (migrations/20261020090000_post-analytics.sql). Linked to the app's post and campaign when the post
// came from the Posts page. A metric Blotato hasn't reported is null, never 0.
export const postAnalytics = pgTable(
  "post_analytics",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull(),
    blotatoPostId: text("blotato_post_id").notNull(),
    campaignId: integer("campaign_id"),
    postId: bigint("post_id", { mode: "number" }),
    accountId: text("account_id"),
    platform: text("platform").notNull(),
    state: text("state").$type<"published" | "failed">().notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    text: text("text"),
    postUrl: text("post_url"),
    error: text("error"),
    views: bigint("views", { mode: "number" }),
    likes: bigint("likes", { mode: "number" }),
    comments: bigint("comments", { mode: "number" }),
    shares: bigint("shares", { mode: "number" }),
    saves: bigint("saves", { mode: "number" }),
    reach: bigint("reach", { mode: "number" }),
    impressions: bigint("impressions", { mode: "number" }),
    rawMetrics: jsonb("raw_metrics").$type<Record<string, unknown>>(),
    metricsHistory: jsonb("metrics_history").$type<BlotatoMetricsSnapshot[]>().default([]).notNull(),
    metricsFetchedAt: timestamp("metrics_fetched_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("post_analytics_user_id_blotato_post_id_key").on(table.userId, table.blotatoPostId),
    index("post_analytics_user_time_idx").on(table.userId, table.postedAt.desc()),
    index("post_analytics_campaign_idx").on(table.campaignId, table.postedAt.desc()),
  ]
);

export type PostAnalytics = typeof postAnalytics.$inferSelect;

// Each user's last analytics sync
export const analyticsSyncs = pgTable("analytics_syncs", {
  userId: uuid("user_id").primaryKey(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).defaultNow().notNull(),
  lastError: text("last_error"),
  postsSynced: integer("posts_synced").default(0).notNull(),
});
