import { formatDistanceToNow } from "date-fns";
import { History, MessageSquare } from "lucide-react";
import { MASTER_AGENT, type WorkerRoleId } from "@/lib/agent-roles";
import type { ActivityItem, ActivityKind } from "@/lib/overview";
import type { TaskView } from "@/lib/orchestration/types";
import { OverviewEmptyState } from "@/components/dashboard/overview/overview-panel";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import type { ChatMessage } from "@/components/agents/agent-chat";
import type { WorkspaceAgent } from "@/components/agents/agent-workspace";
import { TaskStatusBadge } from "@/components/agents/master-tasks";

// Which campaign activity belongs to which agent
const ROLE_ACTIVITY: Record<WorkerRoleId, ActivityKind> = {
  research: "research",
  creator: "content",
  scheduler: "schedule",
  analytics: "analytics",
};

type Entry =
  | { type: "activity" | "question"; id: string; text: string; createdAt: Date }
  | { type: "task"; id: string; task: TaskView; createdAt: Date };

// The agent's campaign activity, the tasks the Master Agent gave it and the questions asked in
// chat, newest first
export function AgentHistory({
  agent,
  messages,
  activity,
  tasks,
}: {
  agent: WorkspaceAgent;
  messages: ChatMessage[];
  activity: ActivityItem[];
  tasks: TaskView[];
}) {
  const roleId = agent.role.id as WorkerRoleId;
  const entries: Entry[] = [
    ...activity
      .filter((item) => item.kind === ROLE_ACTIVITY[roleId])
      .map((item): Entry => ({ type: "activity", id: `activity-${item.id}`, text: item.message, createdAt: item.createdAt })),
    ...tasks.map((task): Entry => ({ type: "task", id: `task-${task.id}`, task, createdAt: new Date(task.startedAt ?? task.updatedAt) })),
    ...messages
      .filter((message) => message.from === "user")
      .map((message): Entry => ({ type: "question", id: message.id, text: message.text, createdAt: message.createdAt })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  if (entries.length === 0) {
    return (
      <OverviewEmptyState
        Icon={History}
        tone="bg-linear-to-br from-violet-500 to-fuchsia-600 text-white"
        glow="shadow-violet-500/30"
        title="No history yet"
        description={`Tasks the Master Agent gives the ${agent.role.name}, and the questions you ask it, will show up here.`}
      />
    );
  }

  return (
    <ol className="relative flex flex-col gap-4">
      {/* Timeline rail behind the icons */}
      <span aria-hidden className="absolute top-4 bottom-4 left-4 w-px bg-border" />
      {entries.map((entry) => (
        <li key={entry.id} className="relative flex items-start gap-3">
          {entry.type === "question" ? (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-4 ring-card">
              <MessageSquare className="size-4" />
            </span>
          ) : entry.type === "task" ? (
            <AgentAvatar role={MASTER_AGENT} className="size-8 ring-4 ring-card" />
          ) : (
            <AgentAvatar role={agent.role} sprite={agent.sprite} className="size-8 ring-4 ring-card" />
          )}
          <div className="min-w-0 flex-1 pt-1">
            {entry.type === "task" ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm">
                    <span className="font-medium">Master Agent assigned: </span>
                    {entry.task.title}
                  </p>
                  <TaskStatusBadge status={entry.task.status} />
                </div>
                {entry.task.output && <p className="mt-1 line-clamp-3 text-xs whitespace-pre-wrap text-muted-foreground">{entry.task.output}</p>}
              </>
            ) : (
              <p className="text-sm">
                {entry.type === "question" && <span className="font-medium">You asked: </span>}
                {entry.text}
              </p>
            )}
            <time dateTime={entry.createdAt.toISOString()} className="mt-0.5 block text-xs text-muted-foreground">
              {formatDistanceToNow(entry.createdAt, { addSuffix: true })}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}
