import type { AgentRoleId, WorkerRoleId } from "@/lib/agent-roles";

// Shared by the server and the browser: what plans, tasks and agent messages look like.

export type PlanStatus = "in_progress" | "awaiting_user" | "completed" | "failed" | "cancelled";

// pending (waiting for its scheduled time) → queued (handed to Inngest) → in_progress → in_review →
// completed. A repeating task goes back to pending after each run until its rule runs out.
// awaiting_input: the worker asked a question only the user can answer (the task restarts with it).
// waiting_for_user: the run was saved mid-way because the user has to do something in the sandbox
// (log in, take over); it continues from where it stopped, or expires if nobody resumes it.
export type TaskStatus =
  | "pending"
  | "queued"
  | "in_progress"
  | "in_review"
  | "awaiting_input"
  | "waiting_for_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

// The campaign's sandbox (one E2B desktop per campaign)
export type SandboxStatus = "none" | "starting" | "running" | "paused" | "killed";
// "user" while the user has taken over the sandbox
export type SandboxControl = "agent" | "user";

// Why a task is waiting_for_user
export type TaskInterruption = {
  kind: "login" | "action" | "takeover";
  reason: string;
  url?: string | null;
  platform?: string | null;
};

export type ArtifactType = "image" | "video" | "document" | "data" | "link";

// What an agent hands back with report_result
export type TaskResult = {
  summary: string;
  details: string;
  artifacts: { type: ArtifactType; name: string; url: string | null; sandboxPath: string | null; metadata: Record<string, unknown> }[];
};

// The Research Agent's saved findings (save_research). Each insight points at its sources by their
// 1-based position in `sources`.
export type ResearchMethod = "knowledge" | "live" | "mixed";
export type ResearchInsight = { insight: string; details: string | null; sources: number[] };
// checkedLive is what the agent says; visited is whether its browser actually opened that site
export type ResearchSource = { title: string; url: string | null; platform: string | null; checkedLive: boolean; visited: boolean; note: string | null };

// The Creator Agent's saved content (save_draft)
export type DraftKind = "post" | "caption" | "thread" | "script" | "carousel" | "hashtags" | "idea";
export type DraftStatus = "draft" | "approved" | "archived";
export type DraftMedia = { artifactId: number | null; url: string; name: string; mimeType: string | null };

// agent_outputs.kind, from the agent that did the work
export type AgentOutputKind = "research" | "content" | "schedule" | "report";

export type RepeatFrequency = "daily" | "weekly" | "monthly";
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

// When a task runs again. Times repeat at the same local clock time in timeZone.
export type RepeatRule = {
  frequency: RepeatFrequency;
  // Every n days / weeks / months
  interval: number;
  // Weekly only: the days to run on (defaults to the weekday of the first run)
  weekdays?: Weekday[];
  // Monthly only: day of the month to run on (set from the first run, so the 31st doesn't drift)
  monthDay?: number;
  // IANA time zone, e.g. "Asia/Kolkata"
  timeZone: string;
  // Stop after this time (ISO) or this many runs, whichever comes first
  until?: string | null;
  count?: number | null;
};

export type CommunicationKind = "assignment" | "question" | "answer" | "update" | "result" | "review" | "clarification" | "error";

// Plans that still have work going on (and are worth polling)
export const ACTIVE_PLAN_STATUSES: PlanStatus[] = ["in_progress", "awaiting_user"];
// Tasks that are finished one way or another
export const SETTLED_TASK_STATUSES: TaskStatus[] = ["completed", "failed", "cancelled", "expired"];

export type CommunicationView = {
  id: number;
  taskId: number | null;
  from: AgentRoleId | "user";
  to: AgentRoleId | "user";
  kind: CommunicationKind;
  text: string;
  createdAt: string;
};

export type ArtifactView = {
  id: number;
  taskId: number | null;
  agentId: WorkerRoleId | null;
  type: ArtifactType;
  name: string;
  url: string | null;
  sandboxPath: string | null;
  mimeType: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type TaskView = {
  id: number;
  planId: number;
  agentId: WorkerRoleId;
  title: string;
  instructions: string;
  dependsOn: number[];
  status: TaskStatus;
  scheduledAt: string;
  repeat: RepeatRule | null;
  nextRunAt: string | null;
  runCount: number;
  output: string | null;
  question: string | null;
  review: string | null;
  revisions: number;
  attempts: number;
  error: string | null;
  currentStep: string | null;
  interruption: TaskInterruption | null;
  waitingSince: string | null;
  expiresAt: string | null;
  artifacts: ArtifactView[];
  drafts: ContentDraftView[];
  research: ResearchView[];
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type ContentDraftView = {
  id: number;
  taskId: number | null;
  kind: DraftKind;
  platform: string;
  title: string;
  hook: string | null;
  body: string;
  cta: string | null;
  hashtags: string[];
  media: DraftMedia[];
  notes: string | null;
  status: DraftStatus;
  warnings: string[];
  createdAt: string;
};

export type ResearchView = {
  id: number;
  taskId: number | null;
  topic: string;
  summary: string;
  method: ResearchMethod;
  platforms: string[];
  hashtags: string[];
  findings: ResearchInsight[];
  sources: ResearchSource[];
  createdAt: string;
};

export type PlanView = {
  id: number;
  title: string;
  request: string;
  status: PlanStatus;
  summary: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  tasks: TaskView[];
  communications: CommunicationView[];
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Scheduled",
  queued: "Queued",
  in_progress: "Running",
  in_review: "In review",
  awaiting_input: "Needs your input",
  waiting_for_user: "Waiting for you",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Expired",
};

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  in_progress: "In progress",
  awaiting_user: "Needs your input",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

// What each agent is doing right now, computed on the server from the database (never in the browser)
export type AgentLiveStatus = "idle" | "scheduled" | "queued" | "running" | "needs_input" | "waiting_for_user" | "done" | "failed" | "expired";

export type AgentStatusView = {
  agentId: AgentRoleId;
  status: AgentLiveStatus;
  // The task behind the status: the one needing the user, else running, queued, scheduled, or the latest finished
  task: {
    id: number;
    planId: number;
    title: string;
    status: TaskStatus;
    currentStep: string | null;
    // Why it waits (waiting_for_user) or the question asked (needs_input)
    waitingReason: string | null;
    interruption: TaskInterruption | null;
    error: string | null;
    summary: string | null;
    scheduledAt: string;
    startedAt: string | null;
    waitingSince: string | null;
    expiresAt: string | null;
    completedAt: string | null;
    artifactCount: number;
    artifacts: ArtifactView[];
  } | null;
};

// One agent's computer
export type SandboxView = {
  agentId: WorkerRoleId;
  status: SandboxStatus;
  control: SandboxControl;
  // The agent's task using it right now, if any
  activeTaskId: number | null;
  activeAt: string | null;
  hasPreview: boolean;
  ended: boolean;
};

// sandboxes: one per agent that has a computer
export type LiveStatus = { agents: AgentStatusView[]; sandboxes: Partial<Record<WorkerRoleId, SandboxView>>; serverTime: string };

export const AGENT_STATUS_LABELS: Record<AgentLiveStatus, string> = {
  idle: "Idle",
  scheduled: "Scheduled",
  queued: "Queued",
  running: "Running",
  needs_input: "Needs your input",
  waiting_for_user: "Waiting for you",
  done: "Done",
  failed: "Failed",
  expired: "Expired",
};

export const SANDBOX_STATUS_LABELS: Record<SandboxStatus, string> = {
  none: "Not started",
  starting: "Starting",
  running: "Running",
  paused: "Paused",
  killed: "Shut down",
};
