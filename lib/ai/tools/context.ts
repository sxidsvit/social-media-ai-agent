import "server-only";
import type { AgentPlan, AgentTask } from "@/db";
import type { WorkerRoleId } from "@/lib/agent-roles";
import { openAgentSandbox } from "@/lib/sandbox/agent-sandbox";
import type { Desktop } from "@/lib/sandbox/e2b";
import type { Scope } from "@/lib/orchestration/store";
import type { TaskResult } from "@/lib/orchestration/types";

// What a worker agent's tools see while it runs one task. The run is saved (RunState.toString)
// when it pauses, which serializes this context too, so everything here is plain data except the
// sandbox handle, which serializes to just its campaign id (never a connection or a key).
export type WorkerContext = {
  scope: Scope;
  campaignName: string;
  plan: AgentPlan;
  task: AgentTask;
  // The agent_task_runs row of this dispatch, for linking artifacts
  taskRunId: number | null;
  // Outputs and artifacts of the tasks this one depends on, already formatted
  inputs: string;
  questionsAsked: number;
  // Set when a question went to the user: the run should stop and the task waits for the answer
  waitingForUser: boolean;
  // The agent's own sandbox in this campaign, for agents that use one
  sandbox: SandboxHandle | null;
  // After this time (ms since epoch) the next tool call saves the run so this step can end
  checkpointAt: number;
  // The task's time limit (ms since epoch): from wrapUpAt the agent is told to finish, and at
  // deadlineAt its tools stop and it reports what it has
  wrapUpAt: number;
  deadlineAt: number;
  // Set when an action was held back because the user took over the sandbox
  takeover: boolean;
  // Pages the agent's browser opened in this task (open_url, web_search, read_page), so saved
  // research can tell sources it really visited from ones it only cites. Optional: runs saved
  // before it existed don't have it.
  visitedUrls?: string[];
  // Set once report_result has checked the agent saved its work (see AgentDefinition.beforeReport)
  reportChecked?: boolean;
  // What the agent handed back with report_result
  report: TaskResult | null;
};

const MAX_VISITED = 100;

export function recordVisit(context: WorkerContext, url: string) {
  const visited = (context.visitedUrls ??= []);
  if (!visited.includes(url)) visited.push(url);
  if (visited.length > MAX_VISITED) visited.splice(0, visited.length - MAX_VISITED);
}

// Whether the browser opened a page on this URL's site during the task
export function wasVisited(context: WorkerContext, url: string) {
  const host = (value: string) => {
    try {
      return new URL(value).hostname.replace(/^(www|m)\./, "");
    } catch {
      return null;
    }
  };
  const target = host(url);
  return !!target && (context.visitedUrls ?? []).some((visited) => host(visited) === target);
}

// Opens the agent's sandbox on first use (resuming or creating it) and keeps the connection
export class SandboxHandle {
  private desktop: Desktop | null = null;

  constructor(
    readonly campaignId: number,
    readonly agentId: WorkerRoleId
  ) {}

  get key() {
    return { campaignId: this.campaignId, agentId: this.agentId };
  }

  async open() {
    if (!this.desktop) this.desktop = await openAgentSandbox(this.key);
    return this.desktop;
  }

  // The open connection, if the run used the sandbox
  get current() {
    return this.desktop;
  }

  toJSON() {
    return { campaignId: this.campaignId, agentId: this.agentId };
  }
}
