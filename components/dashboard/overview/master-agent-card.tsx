"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { MASTER_AGENT } from "@/lib/agent-roles";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { MASTER_ID, useAgentWorkspace } from "@/components/agents/agent-workspace";
import { Button } from "@/components/ui/button";

// Overview entry point to the Master Agent: opens its chat in place of the overview cards
export function MasterAgentCard() {
  const workspace = useAgentWorkspace();
  if (!workspace) return null;
  const { openAgent, activePlans } = workspace;
  const waiting = activePlans.some((plan) => plan.status === "awaiting_user");

  return (
    <section className="relative overflow-hidden rounded-3xl bg-linear-to-br from-indigo-500/12 via-violet-500/10 to-fuchsia-500/12 p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_32px_-16px_rgb(15_23_42/0.12)] ring-1 ring-violet-500/30 sm:p-6 dark:from-indigo-500/25 dark:via-violet-500/20 dark:to-fuchsia-500/25">
      <span aria-hidden className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-fuchsia-500/20 blur-3xl" />
      <div className="relative flex flex-wrap items-center gap-4">
        <AgentAvatar role={MASTER_AGENT} className="size-12 shadow-lg shadow-violet-500/30" />
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
            {MASTER_AGENT.name}
            <Sparkles className="size-3.5 text-fuchsia-500" aria-hidden />
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {waiting
              ? "Your team has a question for you."
              : activePlans.length
                ? `Your team is working on ${activePlans.length === 1 ? `"${activePlans[0].title}"` : `${activePlans.length} plans`}.`
                : "Tell it what you need. It plans the work, assigns your agents and reports back."}
          </p>
        </div>
        <Button className="h-9 rounded-xl px-3.5 shadow-lg shadow-primary/25" onClick={() => openAgent(MASTER_ID)}>
          {waiting ? "Answer now" : "Chat with Master Agent"}
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    </section>
  );
}
