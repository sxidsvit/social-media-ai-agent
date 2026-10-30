"use client";

/* eslint-disable @next/next/no-img-element -- the paused preview comes from our own API */
import { useEffect, useState } from "react";
import { Check, Hand, KeyRound, LoaderCircle, Monitor, Pause, Play, Undo2 } from "lucide-react";
import { getAgentRole } from "@/lib/agent-roles";
import { SANDBOX_STATUS_LABELS } from "@/lib/orchestration/types";
import { cn } from "@/lib/utils";
import { useSandboxController, type ViewerMode } from "@/components/sandbox/sandbox-controller";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// An agent's computer, large. Watching is view only; "Take over" and "Login now" give the user
// the keyboard and mouse. While the user has control the viewer sends a heartbeat, so the computer
// isn't paused under them. Passwords are typed straight into the computer: they never pass through
// this app or reach an agent.

const HEARTBEAT_MS = 60_000;

export function SandboxViewer({ mode, onModeChange, onClose }: { mode: ViewerMode; onModeChange: (mode: ViewerMode) => void; onClose: () => void }) {
  const { live, act, resumeTask } = useSandboxController();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { agentId } = mode;
  const agentName = getAgentRole(agentId).name;
  const sandbox = live?.sandboxes[agentId];
  const sandboxStatus = sandbox?.status ?? "none";
  const interactive = mode.kind !== "watch";
  const waiting = mode.kind === "login" ? live?.agents.find((agent) => agent.task?.id === mode.taskId) : undefined;
  const modeKey = `${agentId}-${mode.kind === "login" ? `login-${mode.taskId}` : mode.kind}`;
  // Watching reconnects when the computer starts or stops
  const watchKey = mode.kind === "watch" ? sandboxStatus : "";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        let response: Response;
        if (mode.kind === "watch") response = await fetch(`/api/sandbox?mode=view&agent=${agentId}`, { cache: "no-store" });
        else {
          const body = mode.kind === "login" ? { action: "login-now", taskId: mode.taskId } : { action: "take-over", agent: agentId };
          response = await fetch("/api/sandbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        }
        const data = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) throw new Error(data?.error ?? "The computer couldn't be reached.");
        setUrl(data?.url ?? null);
      } catch (loadError) {
        if (!cancelled) {
          setUrl(null);
          setError((loadError as Error).message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // modeKey and watchKey capture everything load() depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeKey, watchKey]);

  // Keep the computer awake while the user is using it
  useEffect(() => {
    if (!interactive) return;
    const timer = setInterval(() => {
      fetch("/api/sandbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "heartbeat", agent: agentId }) }).catch(
        () => undefined
      );
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [interactive, agentId]);

  async function run(label: string, work: () => Promise<string | null>) {
    setBusy(label);
    const failure = await work();
    setBusy(null);
    if (failure) setError(failure);
    return !failure;
  }

  // Closing while in control hands the computer back, so no agent is left waiting on it
  function close() {
    if (mode.kind === "takeover") act("hand-back", agentId);
    onClose();
  }

  const subtitle =
    mode.kind === "login"
      ? "Do what the agent asked, right here in the computer. Your password goes straight into the site, never to the agent."
      : mode.kind === "takeover"
        ? `You're in control. The ${agentName} waits until you hand the computer back.`
        : sandbox?.activeTaskId
          ? `The ${agentName} is using it. You're watching.`
          : `The ${agentName}'s own computer. You're watching.`;

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col gap-3 p-3 sm:p-4" style={{ maxWidth: "min(72rem, calc(100vw - 2rem))" }}>
        <DialogHeader className="pr-8">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Monitor className="size-4" aria-hidden />
            {agentName}&apos;s computer
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                sandboxStatus === "running" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"
              )}
            >
              {SANDBOX_STATUS_LABELS[sandboxStatus]}
            </span>
            {interactive && <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">You have control</span>}
          </DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        {mode.kind === "login" && waiting?.task?.waitingReason && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <span className="font-medium">{getAgentRole(waiting.agentId).name}:</span> {waiting.task.waitingReason}
            </span>
          </p>
        )}

        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-muted ring-1 ring-border/60">
          {url ? (
            <iframe src={url} title={`${agentName}'s computer`} className="absolute inset-0 size-full border-0" allow="clipboard-read; clipboard-write" />
          ) : loading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-5 animate-spin" aria-hidden />
              {interactive ? "Waking up the computer…" : "Connecting…"}
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              {sandbox?.hasPreview && <img src={`/api/sandbox/preview?agent=${agentId}&at=${encodeURIComponent(sandbox.activeAt ?? "")}`} alt="" className="absolute inset-0 size-full object-cover opacity-40 blur-[1px]" />}
              <p className="relative text-sm font-medium">
                {error ?? (sandboxStatus === "paused" ? "The computer is paused." : sandboxStatus === "killed" ? "This computer was shut down." : "The computer isn't running.")}
              </p>
              {!sandbox?.ended && mode.kind === "watch" && sandboxStatus !== "running" && (
                <Button className="relative h-8 rounded-lg" disabled={busy !== null} onClick={() => run("start", async () => (await act("start", agentId)).error)}>
                  {busy === "start" ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Play data-icon="inline-start" />}
                  Start it
                </Button>
              )}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2">
          {error && url && <span className="mr-auto text-xs text-destructive">{error}</span>}
          {mode.kind === "watch" && !sandbox?.ended && (
            <>
              {sandboxStatus === "running" && (
                <Button variant="outline" className="h-8 rounded-lg" disabled={busy !== null} onClick={() => run("pause", async () => (await act("pause", agentId)).error)}>
                  {busy === "pause" ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Pause data-icon="inline-start" />}
                  Pause
                </Button>
              )}
              <Button className="h-8 rounded-lg" onClick={() => onModeChange({ kind: "takeover", agentId })}>
                <Hand data-icon="inline-start" />
                Take over
              </Button>
            </>
          )}
          {mode.kind === "takeover" && (
            <Button
              className="h-8 rounded-lg"
              disabled={busy !== null}
              onClick={() =>
                run("hand-back", async () => (await act("hand-back", agentId)).error).then((ok) => ok && onModeChange({ kind: "watch", agentId }))
              }
            >
              {busy === "hand-back" ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Undo2 data-icon="inline-start" />}
              Hand back to the agent
            </Button>
          )}
          {mode.kind === "login" && (
            <Button
              className="h-8 rounded-lg"
              disabled={busy !== null || !waiting}
              onClick={() => run("done", () => resumeTask(mode.taskId)).then((ok) => ok && onClose())}
            >
              {busy === "done" ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Check data-icon="inline-start" />}
              Done, carry on
            </Button>
          )}
          <Button variant="ghost" className="h-8 rounded-lg" onClick={close}>
            Close
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
