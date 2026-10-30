/* eslint-disable @next/next/no-img-element -- avatars are crops of the office sprites served from our own API */
import { BrainCircuit } from "lucide-react";
import type { AgentRole, AgentRoleId } from "@/lib/agent-roles";
import { AGENT_STATUS_LABELS, type AgentLiveStatus } from "@/lib/orchestration/types";
import { cn } from "@/lib/utils";

// Per-role colours, matching the activity tones used on the overview
export const ROLE_TONES: Record<AgentRoleId, { soft: string; ring: string }> = {
  master: { soft: "bg-linear-to-br from-indigo-500 to-fuchsia-600", ring: "ring-fuchsia-500/40" },
  research: { soft: "bg-violet-500/12 dark:bg-violet-500/20", ring: "ring-violet-500/25" },
  creator: { soft: "bg-pink-500/12 dark:bg-pink-500/20", ring: "ring-pink-500/25" },
  scheduler: { soft: "bg-orange-500/12 dark:bg-orange-500/20", ring: "ring-orange-500/25" },
  analytics: { soft: "bg-emerald-500/12 dark:bg-emerald-500/20", ring: "ring-emerald-500/25" },
};

// Round avatar cropped to the head of the agent's office sprite; falls back to the role emoji.
// The Master Agent has no desk in the office, so it gets its own gradient badge.
export function AgentAvatar({ role, sprite, className }: { role: AgentRole; sprite?: string; className?: string }) {
  const tone = ROLE_TONES[role.id];
  return (
    <span
      aria-hidden
      className={cn("relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1", tone.soft, tone.ring, className)}
    >
      {role.id === "master" ? (
        <BrainCircuit className="size-[55%] text-white" />
      ) : sprite ? (
        <img
          src={sprite}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full origin-[45%_4%] scale-[1.9] object-cover object-top"
        />
      ) : (
        <span className="text-[1.1em] leading-none">{role.emoji}</span>
      )}
    </span>
  );
}

// Colour of each live status: dot and pill
export const STATUS_TONES: Record<AgentLiveStatus | "paused" | "loading", { pill: string; dot: string; pulse?: boolean }> = {
  loading: { pill: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/40" },
  idle: { pill: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/60" },
  scheduled: { pill: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/60" },
  queued: { pill: "bg-sky-500/8 text-sky-700 dark:text-sky-300", dot: "bg-sky-400" },
  running: { pill: "bg-sky-500/12 text-sky-700 dark:text-sky-300", dot: "bg-sky-500", pulse: true },
  needs_input: { pill: "bg-amber-500/12 text-amber-700 dark:text-amber-300", dot: "bg-amber-500", pulse: true },
  waiting_for_user: { pill: "bg-amber-500/12 text-amber-700 dark:text-amber-300", dot: "bg-amber-500", pulse: true },
  done: { pill: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  failed: { pill: "bg-destructive/10 text-destructive", dot: "bg-destructive" },
  expired: { pill: "bg-destructive/10 text-destructive", dot: "bg-destructive/70" },
  paused: { pill: "bg-amber-500/12 text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
};

// "● Running" / "● Waiting for you" / … pill. The status comes from the server (/api/agents/status);
// null means it hasn't loaded yet, which shows a neutral placeholder rather than a made-up state.
// "Paused" is the chat's local pause switch.
export function AgentStatus({ status, paused = false, className }: { status: AgentLiveStatus | null; paused?: boolean; className?: string }) {
  const key = paused ? "paused" : (status ?? "loading");
  const tone = STATUS_TONES[key];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", tone.pill, className)}>
      <span className={cn("size-1.5 rounded-full", tone.dot, tone.pulse && "animate-pulse")} />
      {paused ? "Paused" : status ? AGENT_STATUS_LABELS[status] : "…"}
    </span>
  );
}
