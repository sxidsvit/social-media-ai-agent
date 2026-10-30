"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveStatus } from "@/lib/orchestration/types";

// Polls /api/agents/status for as long as the workspace is open: quickly while anything is going on,
// slowly otherwise, and not at all while the tab is hidden (it catches up as soon as it's visible).
// It never stops, so work that starts later (a scheduled or repeating task) always shows up.
const ACTIVE_MS = 3000;
const IDLE_MS = 15000;

export function isBusy(status: LiveStatus | null) {
  if (!status) return true;
  return (
    Object.values(status.sandboxes).some((sandbox) => sandbox?.status === "running" || sandbox?.status === "starting") ||
    status.agents.some((agent) => ["queued", "running", "waiting_for_user", "needs_input"].includes(agent.status))
  );
}

export function useLiveStatus() {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [error, setError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busyRef = useRef(true);
  const inFlightRef = useRef<Promise<void> | null>(null);
  // Asked for again while a request was in flight: that response may predate the change, so fetch once more
  const againRef = useRef(false);
  const stoppedRef = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) {
      againRef.current = true;
      return inFlightRef.current;
    }
    const run = (async () => {
      try {
        const response = await fetch("/api/agents/status", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const next = (await response.json()) as LiveStatus;
        busyRef.current = isBusy(next);
        setStatus(next);
        setError(false);
      } catch {
        setError(true);
      }
    })();
    inFlightRef.current = run;
    await run;
    inFlightRef.current = null;
    if (againRef.current) {
      againRef.current = false;
      await load();
    }
  }, []);

  const schedule = useCallback(() => {
    clearTimeout(timerRef.current);
    if (stoppedRef.current || document.hidden) return;
    timerRef.current = setTimeout(async () => {
      await load();
      schedule();
    }, busyRef.current ? ACTIVE_MS : IDLE_MS);
  }, [load]);

  // Fetch now (something just changed, e.g. the Master Agent assigned work) and restart the timer,
  // so a team that just got busy is polled at the fast pace straight away
  const refresh = useCallback(async () => {
    await load();
    schedule();
  }, [load, schedule]);

  useEffect(() => {
    stoppedRef.current = false;
    const onVisible = () => {
      if (document.hidden) return clearTimeout(timerRef.current);
      refresh();
    };
    refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stoppedRef.current = true;
      clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { status, error, refresh };
}
