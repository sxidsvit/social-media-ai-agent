"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { WorkerRoleId } from "@/lib/agent-roles";
import type { LiveStatus } from "@/lib/orchestration/types";
import { SandboxViewer } from "@/components/sandbox/sandbox-viewer";

// Everything the UI can do with the agents' computers and with tasks waiting on the user, shared by
// the office popover, the Computer tab and the viewer. Each computer agent has its own computer.
// The live status comes from the server.

// watch: view only. login: a task waits for the user to do something (usually log in), "Done"
// continues it. takeover: the user drives; the agent waits until it's handed back.
export type ViewerMode =
  | { kind: "watch"; agentId: WorkerRoleId }
  | { kind: "login"; agentId: WorkerRoleId; taskId: number }
  | { kind: "takeover"; agentId: WorkerRoleId };

export type SandboxAction = "take-over" | "hand-back" | "pause" | "start";

type Controller = {
  live: LiveStatus | null;
  openViewer: (mode: ViewerMode) => void;
  // Each returns an error message, or null when it worked
  act: (action: SandboxAction, agentId: WorkerRoleId) => Promise<{ error: string | null; url?: string | null }>;
  resumeTask: (taskId: number) => Promise<string | null>;
  retryTask: (taskId: number) => Promise<string | null>;
  refresh: () => void;
};

const SandboxContext = createContext<Controller | null>(null);

export function useSandboxController() {
  const controller = useContext(SandboxContext);
  if (!controller) throw new Error("useSandboxController must be used inside SandboxProvider");
  return controller;
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = await response?.json().catch(() => null);
  return { ok: !!response?.ok, data, error: response?.ok ? null : (data?.error ?? "That didn't work. Please try again.") };
}

export function SandboxProvider({
  live,
  refresh,
  onTasksChanged,
  children,
}: {
  live: LiveStatus | null;
  refresh: () => void;
  // A task was resumed or retried: reload the plans too
  onTasksChanged: () => void;
  children: React.ReactNode;
}) {
  const [viewer, setViewer] = useState<ViewerMode | null>(null);

  const act = useCallback(
    async (action: SandboxAction, agentId: WorkerRoleId) => {
      const result = await post("/api/sandbox", { action, agent: agentId });
      refresh();
      if (action === "hand-back") onTasksChanged();
      return { error: result.error, url: result.data?.url ?? null };
    },
    [refresh, onTasksChanged]
  );

  const taskAction = useCallback(
    async (action: "resume" | "retry-task", taskId: number) => {
      const result = await post("/api/agents/tasks", { action, taskId });
      refresh();
      onTasksChanged();
      return result.error;
    },
    [refresh, onTasksChanged]
  );

  const controller = useMemo<Controller>(
    () => ({
      live,
      openViewer: setViewer,
      act,
      resumeTask: (taskId) => taskAction("resume", taskId),
      retryTask: (taskId) => taskAction("retry-task", taskId),
      refresh,
    }),
    [live, act, taskAction, refresh]
  );

  return (
    <SandboxContext.Provider value={controller}>
      {children}
      {viewer && <SandboxViewer mode={viewer} onModeChange={setViewer} onClose={() => setViewer(null)} />}
    </SandboxContext.Provider>
  );
}
