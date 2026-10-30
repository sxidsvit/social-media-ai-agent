"use client";

import { ArrowRight, BrainCircuit, History, ListChecks, MessageSquare, Monitor, MoreVertical, Pause, Play, RotateCcw, Settings, X } from "lucide-react";
import { hasComputer } from "@/lib/agent-roles";
import type { ActivityItem } from "@/lib/overview";
import { ACTIVE_PLAN_STATUSES, type AgentStatusView, type PlanView } from "@/lib/orchestration/types";
import { cn } from "@/lib/utils";
import { AgentAvatar, AgentStatus } from "@/components/agents/agent-avatar";
import { AgentChat } from "@/components/agents/agent-chat";
import { AgentHistory } from "@/components/agents/agent-history";
import { MasterTasks, type PlanAction } from "@/components/agents/master-tasks";
import { AgentSettingsForm, DEFAULT_AGENT_SETTINGS, type AgentSettings } from "@/components/agents/agent-settings";
import { ComputerPanel, TeamComputers } from "@/components/sandbox/computer-panel";
import type { ChatState, WorkspaceAgent } from "@/components/agents/agent-workspace";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type AgentTab = "chat" | "history" | "tasks" | "computer" | "settings";

// The Master Agent's middle tab tracks the team's plans; a worker's shows its own history.
// Agents with a computer have a Computer tab showing it; the Master Agent's shows all of them.
const WORKER_TABS = [
  { value: "chat", label: "Chat", Icon: MessageSquare },
  { value: "history", label: "History", Icon: History },
  { value: "computer", label: "Computer", Icon: Monitor },
  { value: "settings", label: "Settings", Icon: Settings },
] as const;

const MASTER_TABS = [
  { value: "chat", label: "Chat", Icon: MessageSquare },
  { value: "tasks", label: "Tasks", Icon: ListChecks },
  { value: "computer", label: "Computers", Icon: Monitor },
  { value: "settings", label: "Settings", Icon: Settings },
] as const;

export function AgentPanel({
  agent,
  tab,
  onTabChange,
  paused,
  status,
  onTogglePaused,
  chat,
  typing,
  onSend,
  onLoadOlder,
  activity,
  plans,
  plansLoaded,
  agents,
  onPlanAction,
  onOpenMaster,
  settings,
  onSettingsChange,
  userInitials,
  onClose,
}: {
  agent: WorkspaceAgent;
  tab: AgentTab;
  onTabChange: (tab: AgentTab) => void;
  paused: boolean;
  // Live status from the server; undefined until it has loaded
  status: AgentStatusView | undefined;
  onTogglePaused: () => void;
  chat: ChatState;
  typing: boolean;
  onSend: (text: string) => void;
  onLoadOlder: () => void;
  activity: ActivityItem[];
  // The team's plans: the Master Agent's Tasks tab, and each worker's assignments in its history
  plans: PlanView[];
  plansLoaded: boolean;
  agents: WorkspaceAgent[];
  onPlanAction: (planId: number, action: PlanAction) => Promise<string | null>;
  onOpenMaster: () => void;
  settings: AgentSettings;
  onSettingsChange: (settings: AgentSettings) => void;
  userInitials: string;
  // Compact mode for when the panel opens in place of other content (Overview): just the agent's
  // avatar and name plus a close button, no description or agent actions
  onClose?: () => void;
}) {
  const { role } = agent;
  const master = role.id === "master";
  const computer = hasComputer(role.id);
  const tabs = master ? MASTER_TABS : WORKER_TABS.filter((item) => item.value !== "computer" || computer);
  const historyTab: AgentTab = master ? "tasks" : "history";
  const notice = master ? (
    <ActivePlans plans={plans} onOpen={() => onTabChange("tasks")} />
  ) : (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-violet-500/8 px-3 py-2 text-xs text-muted-foreground dark:bg-violet-500/15">
      <BrainCircuit className="size-3.5 shrink-0 text-violet-600 dark:text-violet-300" aria-hidden />
      <span className="min-w-0 flex-1">The {role.name} takes tasks from the Master Agent. Ask it questions here.</span>
      <button
        type="button"
        onClick={onOpenMaster}
        className="inline-flex items-center gap-1 font-medium text-violet-700 underline-offset-2 hover:underline dark:text-violet-300"
      >
        Request work
        <ArrowRight className="size-3" aria-hidden />
      </button>
    </div>
  );

  return (
    <section
      aria-label={role.name}
      className={cn(
        "flex min-h-0 flex-1 animate-in flex-col rounded-3xl bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_32px_-16px_rgb(15_23_42/0.12)] ring-1 duration-300 fade-in-0 slide-in-from-bottom-1 sm:p-5",
        master ? "ring-violet-500/30" : "ring-border/60"
      )}
    >
      <header className="flex flex-wrap items-center gap-3">
        <AgentAvatar role={role} sprite={agent.sprite} className="size-11" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg leading-tight font-semibold tracking-tight">{role.name}</h3>
            <AgentStatus paused={paused} status={status?.status ?? null} />
          </div>
          {!onClose && <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{role.description}</p>}
        </div>
        {onClose ? (
          <Button variant="ghost" size="icon" className="size-8 rounded-lg text-muted-foreground" onClick={onClose} aria-label="Close chat">
            <X />
          </Button>
        ) : (
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-8 rounded-lg bg-card px-2.5" onClick={onTogglePaused}>
            {paused ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button variant="outline" className="h-8 rounded-lg bg-card px-2.5" onClick={() => onTabChange("settings")}>
            <Settings data-icon="inline-start" />
            Settings
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" className="size-8 rounded-lg text-muted-foreground" aria-label="More actions" />}
            >
              <MoreVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-48 rounded-2xl p-1.5 shadow-xl">
              <DropdownMenuItem className="gap-2.5 rounded-xl p-2" onClick={() => onTabChange(historyTab)}>
                {master ? <ListChecks /> : <History />}
                {master ? "View tasks" : "View history"}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2.5 rounded-xl p-2"
                onClick={() => onSettingsChange(DEFAULT_AGENT_SETTINGS)}
              >
                <RotateCcw />
                Reset settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        )}
      </header>

      <Tabs value={tab} onValueChange={(value) => onTabChange(value as AgentTab)} className="mt-3 min-h-0 flex-1 gap-0">
        <TabsList variant="line" className="h-10! w-full justify-start gap-1 overflow-x-auto border-b border-border/70 p-0 sm:gap-2">
          {tabs.map(({ value, label, Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className={cn(
                "flex-none rounded-none px-3 text-[15px] data-active:text-primary dark:data-active:text-primary",
                "after:bg-primary group-data-horizontal/tabs:after:bottom-[-1px]"
              )}
            >
              <Icon />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="chat" className="flex min-h-0 flex-col">
          <AgentChat
            agent={agent}
            chat={chat}
            typing={typing}
            paused={paused}
            onSend={onSend}
            onLoadOlder={onLoadOlder}
            userInitials={userInitials}
            notice={notice}
          />
        </TabsContent>
        {master ? (
          <TabsContent value="tasks" className="min-h-0 overflow-y-auto pt-4">
            <MasterTasks plans={plans} loaded={plansLoaded} agents={agents} onAction={onPlanAction} />
          </TabsContent>
        ) : (
          <TabsContent value="history" className="min-h-0 overflow-y-auto pt-4">
            <AgentHistory
              agent={agent}
              messages={chat.messages}
              activity={activity}
              tasks={plans.flatMap((plan) => plan.tasks).filter((task) => task.agentId === role.id)}
            />
          </TabsContent>
        )}
        {(master || computer) && (
          <TabsContent value="computer" className="min-h-0 overflow-y-auto pt-4">
            {hasComputer(role.id) ? <ComputerPanel agentId={role.id} status={status} /> : <TeamComputers />}
          </TabsContent>
        )}
        <TabsContent value="settings" className="min-h-0 overflow-y-auto pt-4">
          <AgentSettingsForm agent={agent} settings={settings} onChange={onSettingsChange} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

// Plans the team is working on, above the Master Agent's message box; opens the Tasks tab
function ActivePlans({ plans, onOpen }: { plans: PlanView[]; onOpen: () => void }) {
  const active = plans.filter((plan) => ACTIVE_PLAN_STATUSES.includes(plan.status)).slice(0, 2);
  if (active.length === 0) return null;
  return (
    <div className="mb-2 flex flex-col gap-1.5">
      {active.map((plan) => {
        const done = plan.tasks.filter((task) => task.status === "completed").length;
        const waiting = plan.status === "awaiting_user";
        return (
          <button
            key={plan.id}
            type="button"
            onClick={onOpen}
            className={cn(
              "flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition-colors",
              waiting
                ? "bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-200"
                : "bg-violet-500/8 text-muted-foreground hover:bg-violet-500/12 dark:bg-violet-500/15"
            )}
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", waiting ? "bg-amber-500" : "animate-pulse bg-sky-500")} aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {waiting ? "Waiting for your answer" : "Team is working on"}: <span className="font-medium text-foreground">{plan.title}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              {done}/{plan.tasks.length} done
            </span>
            <ArrowRight className="size-3 shrink-0" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
