"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Hourglass, KeyRound, ListChecks, LoaderCircle, Monitor, Paperclip, RotateCcw, Timer } from "lucide-react";
import { hasComputer, type AgentRole } from "@/lib/agent-roles";
import { SANDBOX_STATUS_LABELS, type AgentStatusView } from "@/lib/orchestration/types";
import { AgentAvatar, AgentStatus } from "@/components/agents/agent-avatar";
import { ArtifactGrid, formatElapsed, useNow } from "@/components/agents/task-results";
import { useSandboxController } from "@/components/sandbox/sandbox-controller";
import { Button } from "@/components/ui/button";

// What an office agent is doing, shown when you hover (or focus) it. Everything here is the live
// status from the database (/api/agents/status), polled by the workspace; nothing is assumed.
export function AgentPreviewCard({
  role,
  sprite,
  status,
  onOpen,
}: {
  role: AgentRole;
  sprite?: string;
  // Undefined until the first status has loaded
  status: AgentStatusView | undefined;
  onOpen: () => void;
}) {
  const { live, openViewer, retryTask, refresh } = useSandboxController();
  // Opening the popover fetches the latest status rather than showing what the last poll saw
  useEffect(() => {
    refresh();
  }, [refresh]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const task = status?.task ?? null;
  const current = status?.status;
  const ticking = current === "running" || current === "waiting_for_user" || current === "needs_input" || current === "queued";
  const now = useNow(ticking);

  // Running: since it started. Waiting: since it stopped. Finished: how long it took.
  const since = current === "waiting_for_user" ? task?.waitingSince : task?.startedAt;
  const elapsed =
    task && since
      ? current === "done" || current === "failed" || current === "expired"
        ? task.completedAt
          ? formatElapsed(new Date(task.completedAt).getTime() - new Date(since).getTime())
          : null
        : formatElapsed(now - new Date(since).getTime())
      : null;

  // Agents with a computer have their own
  const sandbox = hasComputer(role.id) ? live?.sandboxes[role.id] : undefined;
  const usesComputer = !!sandbox?.activeTaskId;

  async function retry() {
    if (!task) return;
    setBusy(true);
    setError(await retryTask(task.id));
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <header className="flex items-center gap-2.5">
        <AgentAvatar role={role} sprite={sprite} className="size-9" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight font-semibold">{role.name}</p>
          <AgentStatus status={status?.status ?? null} className="mt-0.5 px-1.5 py-0 text-[11px]" />
        </div>
      </header>

      {!status ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LoaderCircle className="size-3 animate-spin" aria-hidden />
          Checking what it&apos;s doing…
        </p>
      ) : !task ? (
        <p className="text-xs text-muted-foreground">No tasks yet. Ask the Master Agent for work and it will assign some.</p>
      ) : (
        <>
          <div className="space-y-1 text-xs">
            <p className="flex items-start gap-1.5">
              <ListChecks className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 font-medium">{task.title}</span>
            </p>
            {task.currentStep && current === "running" && (
              <p className="flex items-start gap-1.5 text-muted-foreground">
                <ArrowRight className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0">{task.currentStep}</span>
              </p>
            )}
            <dl className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5 text-muted-foreground">
              {elapsed && (
                <div className="flex items-center gap-1">
                  <Timer className="size-3" aria-hidden />
                  <dt className="sr-only">Elapsed</dt>
                  <dd className="tabular-nums">{elapsed}</dd>
                </div>
              )}
              {sandbox && (
                <div className="flex items-center gap-1">
                  <Monitor className="size-3" aria-hidden />
                  <dt className="sr-only">Computer</dt>
                  <dd>
                    {SANDBOX_STATUS_LABELS[sandbox.status]}
                    {usesComputer ? " · in use" : ""}
                  </dd>
                </div>
              )}
              <div className="flex items-center gap-1">
                <Paperclip className="size-3" aria-hidden />
                <dt className="sr-only">Results</dt>
                <dd className="tabular-nums">
                  {task.artifactCount} {task.artifactCount === 1 ? "file" : "files"}
                </dd>
              </div>
            </dl>
          </div>

          {(current === "waiting_for_user" || current === "needs_input") && (
            <div className="rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-200">
              <p className="flex items-start gap-1.5">
                {current === "waiting_for_user" ? <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <Hourglass className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
                <span>{task.waitingReason ?? "It's waiting for you."}</span>
              </p>
              {current === "waiting_for_user" && task.interruption?.kind !== "takeover" && (
                <Button className="mt-2 h-7 w-full rounded-lg text-xs" onClick={() => hasComputer(role.id) && openViewer({ kind: "login", agentId: role.id, taskId: task.id })}>
                  <KeyRound data-icon="inline-start" />
                  Login now
                </Button>
              )}
              {current === "waiting_for_user" && task.interruption?.kind === "takeover" && (
                <Button className="mt-2 h-7 w-full rounded-lg text-xs" onClick={() => hasComputer(role.id) && openViewer({ kind: "takeover", agentId: role.id })}>
                  <Monitor data-icon="inline-start" />
                  Open the computer
                </Button>
              )}
              {current === "needs_input" && <p className="mt-1 text-[11px] opacity-80">Answer it in the Master Agent&apos;s chat.</p>}
            </div>
          )}

          {current === "done" && (
            <>
              {task.summary && <p className="line-clamp-4 text-xs whitespace-pre-wrap text-muted-foreground">{task.summary}</p>}
              <ArtifactGrid artifacts={task.artifacts} total={task.artifactCount} compact />
            </>
          )}

          {(current === "failed" || current === "expired") && (
            <div className="rounded-lg bg-destructive/8 px-2.5 py-2 text-xs text-destructive">
              <p>{task.error ?? (current === "expired" ? "Nobody picked this up in time." : "It couldn't finish this task.")}</p>
              <Button variant="outline" className="mt-2 h-7 w-full rounded-lg bg-card text-xs text-foreground" disabled={busy} onClick={retry}>
                {busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <RotateCcw data-icon="inline-start" />}
                Retry
              </Button>
              {error && <p className="mt-1">{error}</p>}
            </div>
          )}
        </>
      )}

      <Button variant="ghost" className="h-7 justify-between rounded-lg px-2 text-xs" onClick={onOpen}>
        Open {role.name}
        <ArrowRight data-icon="inline-end" />
      </Button>
    </div>
  );
}
