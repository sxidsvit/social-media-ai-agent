"use client";

import type { AgentLiveStatus } from "@/lib/orchestration/types";
import { AGENT_STATUS_LABELS } from "@/lib/orchestration/types";
import { cn } from "@/lib/utils";
import { AgentAvatar, STATUS_TONES } from "@/components/agents/agent-avatar";
import type { WorkspaceAgent } from "@/components/agents/agent-workspace";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// The agent rail: a slim vertical column of avatars beside the open agent's panel. The Master Agent
// sits on top, set apart from the team. Hovering shows the agent's name and status; the selected
// agent is ringed.
export function AgentPicker({
  agents,
  selectedId,
  pausedIds,
  statuses,
  onSelect,
}: {
  agents: WorkspaceAgent[];
  selectedId: string;
  pausedIds: Set<string>;
  // Live status per agent id, from the server; missing until it has loaded
  statuses: Record<string, AgentLiveStatus>;
  onSelect: (id: string) => void;
}) {
  const master = agents.find((agent) => agent.role.id === "master");
  const team = agents.filter((agent) => agent !== master);

  const item = (agent: WorkspaceAgent) => (
    <RailItem
      key={agent.id}
      agent={agent}
      selected={agent.id === selectedId}
      paused={pausedIds.has(agent.id)}
      status={statuses[agent.id] ?? null}
      onSelect={() => onSelect(agent.id)}
    />
  );

  return (
    <nav
      role="tablist"
      aria-label="AI agents"
      aria-orientation="vertical"
      className="flex shrink-0 flex-col items-center gap-2 self-start rounded-3xl bg-card p-2 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_32px_-16px_rgb(15_23_42/0.12)] ring-1 ring-border/60"
    >
      {master && item(master)}
      {master && team.length > 0 && <span aria-hidden className="my-0.5 h-px w-6 bg-border" />}
      {team.map(item)}
    </nav>
  );
}

function RailItem({
  agent,
  selected,
  paused,
  status,
  onSelect,
}: {
  agent: WorkspaceAgent;
  selected: boolean;
  paused: boolean;
  status: AgentLiveStatus | null;
  onSelect: () => void;
}) {
  const master = agent.role.id === "master";
  const tone = STATUS_TONES[paused ? "paused" : (status ?? "loading")];
  const label = paused ? "Paused" : status ? AGENT_STATUS_LABELS[status] : null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={agent.role.name}
            onClick={onSelect}
            className={cn(
              "group/agent relative flex size-12 items-center justify-center rounded-2xl transition-[background-color,box-shadow] duration-300 outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              selected
                ? master
                  ? "bg-violet-500/12 ring-2 ring-violet-500/70 dark:bg-violet-500/20"
                  : "bg-primary/10 ring-2 ring-primary/60 dark:bg-primary/20"
                : "hover:bg-muted"
            )}
          />
        }
      >
        <AgentAvatar
          role={agent.role}
          sprite={agent.sprite}
          className={cn(
            "size-9 transition-transform duration-300",
            master && "shadow-md shadow-violet-500/30",
            selected ? "scale-105" : "group-hover/agent:scale-105"
          )}
        />
        {/* Live status dot on the avatar's corner */}
        <span
          aria-hidden
          className={cn("absolute right-1.5 bottom-1.5 size-2.5 rounded-full ring-2 ring-card", tone.dot, tone.pulse && "animate-pulse")}
        />
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="flex-col items-start gap-0.5">
        <span className="font-semibold">{agent.role.name}</span>
        {label && <span className="opacity-70">{label}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
