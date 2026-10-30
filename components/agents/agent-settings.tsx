"use client";

import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { WorkspaceAgent } from "@/components/agents/agent-workspace";

export type AgentSettings = {
  autonomous: boolean;
  approval: boolean;
  notify: boolean;
  instructions: string;
};

export const DEFAULT_AGENT_SETTINGS: AgentSettings = { autonomous: true, approval: true, notify: true, instructions: "" };

const TOGGLES: { key: "autonomous" | "approval" | "notify"; label: string; description: string }[] = [
  { key: "autonomous", label: "Work autonomously", description: "Pick up new work for the campaign without waiting for a task" },
  { key: "approval", label: "Ask before acting", description: "Check with you before anything goes out to your accounts" },
  { key: "notify", label: "Notify me", description: "Send a notification when a task is finished" },
];

export function AgentSettingsForm({
  agent,
  settings,
  onChange,
}: {
  agent: WorkspaceAgent;
  settings: AgentSettings;
  onChange: (settings: AgentSettings) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {TOGGLES.map(({ key, label, description }) => (
        <label key={key} className="flex cursor-pointer items-center gap-4 rounded-2xl p-3 transition-colors hover:bg-muted/60">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{label}</span>
            <span className="block text-xs text-muted-foreground">{description}</span>
          </span>
          <Switch checked={settings[key]} onCheckedChange={(checked) => onChange({ ...settings, [key]: checked })} />
        </label>
      ))}

      <div className="mt-2 space-y-2 px-3">
        <label htmlFor="agent-instructions" className="block text-sm font-medium">
          Instructions
        </label>
        <Textarea
          id="agent-instructions"
          value={settings.instructions}
          onChange={(event) => onChange({ ...settings, instructions: event.target.value })}
          placeholder={`Anything the ${agent.role.name} should always keep in mind — tone, topics to avoid, sources to trust…`}
          className="min-h-28 rounded-xl"
        />
      </div>
    </div>
  );
}
