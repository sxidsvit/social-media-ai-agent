"use client";

/* eslint-disable @next/next/no-img-element -- fallback office image */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AGENT_ROLES, MASTER_AGENT, type AgentRole, type AgentRoleId } from "@/lib/agent-roles";
import type { OfficeScene } from "@/lib/office-studio";
import type { ActivityItem } from "@/lib/overview";
import { ACTIVE_PLAN_STATUSES, type AgentLiveStatus, type AgentStatusView, type PlanView } from "@/lib/orchestration/types";
import { AgentOffice } from "@/components/office/agent-office";
import { AgentPreviewCard } from "@/components/office/agent-preview-popover";
import { SandboxProvider } from "@/components/sandbox/sandbox-controller";
import { useLiveStatus } from "@/components/agents/use-live-status";
import { AgentPicker } from "@/components/agents/agent-picker";
import { AgentPanel, type AgentTab } from "@/components/agents/agent-panel";
import type { ChatMessage } from "@/components/agents/agent-chat";
import type { PlanAction } from "@/components/agents/master-tasks";
import type { StoredChatMessage } from "@/lib/agent-chats";
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from "@/components/agents/agent-settings";

// An agent as the workspace sees it: its office seat id (or role id without a scene) and its look
export type WorkspaceAgent = { id: string; role: AgentRole; sprite?: string };

type RoleId = AgentRoleId;

// The Master Agent has no desk in the office; its workspace id is its role id
export const MASTER_ID = "master";

// Lets content inside the workspace (such as the overview's Master Agent card) open an agent's chat
const WorkspaceContext = createContext<{ openAgent: (id: string) => void; activePlans: PlanView[] } | null>(null);

export function useAgentWorkspace() {
  return useContext(WorkspaceContext);
}

// How often plans are checked while the team is working, and how many quiet checks to make after
// the last plan finishes (the Master Agent's report can land a moment later)
const POLL_MS = 4000;
const QUIET_POLLS = 3;

// A chat as loaded so far: saved messages arrive a page at a time, newest page first.
// nextCursor is the id of the oldest loaded message while older ones remain, otherwise null.
export type ChatState = {
  messages: ChatMessage[];
  loaded: boolean;
  loading: boolean;
  nextCursor: number | null;
  error?: string;
};

const EMPTY_CHAT: ChatState = { messages: [], loaded: false, loading: false, nextCursor: null };

export function AgentWorkspace({
  office,
  officeImage,
  activity,
  userInitials,
  children,
}: {
  office: OfficeScene | null;
  officeImage: string;
  activity: ActivityItem[];
  userInitials: string;
  // Overview mode: this content fills the left column until an agent is clicked in the office, then
  // the agent's panel opens in its place (and closes back to it). Without it, this is the AI Agent
  // page: the agent row plus the first agent's panel.
  children?: React.ReactNode;
}) {
  const overview = children !== undefined;
  const agents: WorkspaceAgent[] = [
    { id: MASTER_ID, role: MASTER_AGENT },
    ...(office
      ? office.agents.map((agent) => ({ id: agent.id, role: agent.role, sprite: agent.frames[0] }))
      : AGENT_ROLES.map((role) => ({ id: role.id, role }))),
  ];

  const [selectedId, setSelectedId] = useState<string | null>(overview ? null : (agents[0]?.id ?? null));
  const [tab, setTab] = useState<AgentTab>("chat");
  const [paused, setPaused] = useState<Set<string>>(() => new Set());
  // Chats and in-flight replies are per agent role, matching how they're saved
  const [chats, setChats] = useState<Partial<Record<RoleId, ChatState>>>({});
  const [typing, setTyping] = useState<Set<RoleId>>(() => new Set());
  const [settings, setSettings] = useState<Record<string, AgentSettings>>({});
  const columnRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef(false);
  // In-flight replies per agent, cancelled when the workspace unmounts
  const requestsRef = useRef(new Map<RoleId, AbortController>());
  // Page fetches in flight, so a chat never loads the same page twice
  const pageRequestsRef = useRef(new Map<RoleId, AbortController>());
  // The team's plans, polled while any is running
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [plansLoaded, setPlansLoaded] = useState(false);
  // Bumped to (re)start polling, e.g. after the Master Agent replies
  const [pollKey, setPollKey] = useState(0);
  // What every agent is doing, from the server; polled for as long as the workspace is open
  const { status: live, refresh: refreshLive } = useLiveStatus();
  // The plans as last loaded, to tell when they change
  const planSignatureRef = useRef<string | null>(null);
  // Latest chats and typing state for the poller, which runs outside React's render cycle
  const chatsRef = useRef(chats);
  const typingRef = useRef(typing);
  useEffect(() => {
    chatsRef.current = chats;
    typingRef.current = typing;
  });

  useEffect(() => {
    const requests = requestsRef.current;
    const pageRequests = pageRequestsRef.current;
    return () => {
      requests.forEach((controller) => controller.abort());
      pageRequests.forEach((controller) => controller.abort());
      // Forget them too: in Strict Mode the workspace remounts right away, and a stale entry would
      // block the first page from being fetched again, leaving the chat loading forever
      requests.clear();
      pageRequests.clear();
    };
  }, []);

  const selected = agents.find((agent) => agent.id === selectedId) ?? (overview ? null : agents[0]);
  const selectedRole = selected?.role.id;

  function patchChat(roleId: RoleId, update: (chat: ChatState) => Partial<ChatState>) {
    setChats((current) => {
      const chat = current[roleId] ?? EMPTY_CHAT;
      return { ...current, [roleId]: { ...chat, ...update(chat) } };
    });
  }

  // Loads the newest page of a chat, or with a cursor the page before it, and prepends it
  const loadPage = useCallback(async (roleId: RoleId, before: number | null) => {
    if (pageRequestsRef.current.has(roleId)) return;
    const controller = new AbortController();
    pageRequestsRef.current.set(roleId, controller);
    patchChat(roleId, () => ({ loading: true, error: undefined }));

    try {
      const params = new URLSearchParams({ agentId: roleId });
      if (before) params.set("before", String(before));
      const response = await fetch(`/api/agents/chat?${params}`, { signal: controller.signal });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) throw new Error(body?.error ?? "Couldn't load messages.");

      const { messages, nextCursor } = body as { messages: StoredChatMessage[]; nextCursor: number | null };
      const page = messages.map((message): ChatMessage => ({ ...message, createdAt: new Date(message.createdAt) }));
      patchChat(roleId, (chat) => ({ messages: [...page, ...chat.messages], nextCursor, loaded: true, loading: false }));
    } catch (error) {
      if (controller.signal.aborted) {
        // A newer request took over and will finish the load; otherwise don't leave it spinning
        if (!pageRequestsRef.current.has(roleId)) patchChat(roleId, () => ({ loading: false }));
        return;
      }
      patchChat(roleId, () => ({ loading: false, error: (error as Error).message }));
    } finally {
      if (pageRequestsRef.current.get(roleId) === controller) pageRequestsRef.current.delete(roleId);
    }
  }, []);

  // Adds messages the Master Agent posted in the background (questions from the team, reports).
  // A fetched message that matches one already shown from this session's stream takes its saved id
  // instead of being added twice.
  const syncMasterChat = useCallback(async (lastMessageId: number) => {
    const chat = chatsRef.current.master;
    if (!chat?.loaded || typingRef.current.has("master") || pageRequestsRef.current.has("master")) return;
    const known = Math.max(0, ...chat.messages.filter((m) => /^\d+$/.test(m.id)).map((m) => Number(m.id)));
    if (lastMessageId <= known) return;

    const response = await fetch(`/api/agents/chat?${new URLSearchParams({ agentId: "master", after: String(known) })}`);
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) return;
    const incoming = (body.messages as StoredChatMessage[]).map((m): ChatMessage => ({ ...m, createdAt: new Date(m.createdAt) }));

    patchChat("master", ({ messages }) => {
      const next = [...messages];
      for (const message of incoming) {
        if (next.some((m) => m.id === message.id)) continue;
        const local = next.findIndex((m) => !/^\d+$/.test(m.id) && m.from === message.from && m.text === message.text);
        if (local >= 0) next[local] = { ...next[local], id: message.id };
        else next.push(message);
      }
      return { messages: next };
    });
  }, []);

  // Loads the plans; returns whether any is still running
  const loadPlans = useCallback(
    async (resume = false) => {
      const params = new URLSearchParams({ limit: "10" });
      if (resume) params.set("resume", "1");
      const response = await fetch(`/api/agents/tasks?${params}`);
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) throw new Error(body?.error ?? "Couldn't load tasks.");
      const next = body.plans as PlanView[];
      setPlans(next);
      setPlansLoaded(true);
      // A new plan or a task that moved on (the Master Agent just assigned work, say): update the
      // office and its popovers now instead of waiting for the next status poll
      const signature = next.map((plan) => `${plan.id}:${plan.status}:${plan.tasks.map((task) => `${task.id}.${task.status}`).join(",")}`).join("|");
      if (planSignatureRef.current !== null && planSignatureRef.current !== signature) refreshLive();
      planSignatureRef.current = signature;
      await syncMasterChat(body.lastMasterMessageId ?? 0).catch(() => undefined);
      return next.some((plan) => ACTIVE_PLAN_STATUSES.includes(plan.status));
    },
    [syncMasterChat, refreshLive]
  );

  // Poll while the team is working, then a few more times so the final report shows up
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let quiet = 0;
    const tick = async (resume: boolean) => {
      let active = false;
      try {
        active = await loadPlans(resume);
      } catch {
        // Keep polling through a failed request
        active = true;
      }
      if (stopped) return;
      quiet = active ? 0 : quiet + 1;
      if (quiet <= QUIET_POLLS) timer = setTimeout(() => tick(false), POLL_MS);
    };
    // The first load also resumes plans a restart left behind
    tick(pollKey === 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pollKey, loadPlans]);

  async function planAction(planId: number, action: PlanAction) {
    const response = await fetch("/api/agents/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId, action }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setPollKey((key) => key + 1);
    return response?.ok ? null : (body?.error ?? "That didn't work. Please try again.");
  }

  // Each agent's live status, by role and by workspace id (office seat)
  const statusByRole = new Map<string, AgentStatusView>(live?.agents.map((agent) => [agent.agentId, agent]) ?? []);
  const statuses: Record<string, AgentLiveStatus> = {};
  for (const agent of agents) {
    const status = statusByRole.get(agent.role.id)?.status;
    if (status) statuses[agent.id] = status;
  }

  // When a task changes state on the server (one that started on its own schedule, say), reload the
  // plans too, so the Tasks tab and the Master Agent's chat catch up even after their polling stopped
  const taskSignature = live?.agents.map((agent) => `${agent.task?.id}:${agent.task?.status}`).join("|") ?? "";
  const signatureRef = useRef(taskSignature);
  useEffect(() => {
    if (signatureRef.current === taskSignature) return;
    signatureRef.current = taskSignature;
    setPollKey((key) => key + 1);
  }, [taskSignature]);
  const reloadPlans = useCallback(() => setPollKey((key) => key + 1), []);

  // Open an agent: load its latest messages the first time
  const selectedChat = selectedRole ? (chats[selectedRole] ?? EMPTY_CHAT) : null;
  const needsFirstPage = selectedChat !== null && !selectedChat.loaded && !selectedChat.loading && !selectedChat.error;
  useEffect(() => {
    if (selectedRole && needsFirstPage) loadPage(selectedRole, null);
  }, [selectedRole, needsFirstPage, loadPage]);

  function loadOlder(roleId: RoleId) {
    const chat = chats[roleId] ?? EMPTY_CHAT;
    if (chat.loading) return;
    // Retry the first page if that's what failed; otherwise fetch the page before the oldest loaded
    if (!chat.loaded) loadPage(roleId, null);
    else if (chat.nextCursor) loadPage(roleId, chat.nextCursor);
  }

  // After picking from the office, scroll the left column back into view if it's above the fold
  // (on small screens the office sits below it; on the overview the cards may be scrolled past)
  useEffect(() => {
    if (!revealRef.current) return;
    revealRef.current = false;
    const column = columnRef.current;
    if (column && column.getBoundingClientRect().top < 0) column.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedId]);

  // Shared by the picker row and the office scene, so both always show the same agent
  function selectAgent(id: string, { reveal = false } = {}) {
    if (id !== selectedId) setTab("chat");
    revealRef.current = reveal;
    setSelectedId(id);
  }
  function togglePaused(id: string) {
    setPaused((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function updateChat(roleId: RoleId, update: (messages: ChatMessage[]) => ChatMessage[]) {
    patchChat(roleId, (chat) => ({ messages: update(chat.messages) }));
  }
  function stopTyping(roleId: RoleId) {
    setTyping((current) => {
      const next = new Set(current);
      next.delete(roleId);
      return next;
    });
  }

  // Sends the task (the server saves it and adds the saved conversation as context) and streams
  // the agent's reply into the chat
  async function sendTask(agent: WorkspaceAgent, text: string) {
    const roleId = agent.role.id;
    // Wait for the saved chat first, or the new message would show up twice once it loads
    if (typing.has(roleId) || !chats[roleId]?.loaded) return;
    const userMessage: ChatMessage = { id: crypto.randomUUID(), from: "user", text, createdAt: new Date() };

    updateChat(roleId, (messages) => [...messages, userMessage]);
    setTyping((current) => new Set(current).add(roleId));

    const controller = new AbortController();
    requestsRef.current.get(roleId)?.abort();
    requestsRef.current.set(roleId, controller);
    const replyId = crypto.randomUUID();
    let reply = "";

    try {
      const response = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: roleId,
          text,
          instructions: settings[agent.id]?.instructions,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "The agent couldn't reply right now. Please try again.");
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!reply) {
          // First words arrived: swap the typing dots for the reply bubble
          stopTyping(roleId);
          updateChat(roleId, (messages) => [...messages, { id: replyId, from: "agent", text: "", createdAt: new Date() }]);
        }
        reply += value;
        const current = reply;
        updateChat(roleId, (messages) => messages.map((message) => (message.id === replyId ? { ...message, text: current } : message)));
      }
      if (!reply) throw new Error("The agent didn't reply. Please try again.");
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure: ChatMessage = {
        id: replyId,
        from: "agent",
        text: reply ? `${reply}\n\n(The reply was cut off. Please try again.)` : (error as Error).message,
        createdAt: new Date(),
        failed: true,
      };
      updateChat(roleId, (messages) =>
        messages.some((message) => message.id === replyId)
          ? messages.map((message) => (message.id === replyId ? failure : message))
          : [...messages, failure]
      );
    } finally {
      if (requestsRef.current.get(roleId) === controller) requestsRef.current.delete(roleId);
      stopTyping(roleId);
      // The Master Agent may have started or changed a plan: catch up and keep watching it
      if (roleId === "master") {
        setPollKey((key) => key + 1);
        refreshLive();
      }
    }
  }

  const panel = selected && (
    <AgentPanel
      key={selected.id}
      agent={selected}
      tab={tab}
      onTabChange={setTab}
      paused={paused.has(selected.id)}
      status={statusByRole.get(selected.role.id)}
      onTogglePaused={() => togglePaused(selected.id)}
      chat={selectedChat ?? EMPTY_CHAT}
      typing={typing.has(selected.role.id)}
      onSend={(text) => sendTask(selected, text)}
      onLoadOlder={() => loadOlder(selected.role.id)}
      activity={activity}
      plans={plans}
      plansLoaded={plansLoaded}
      agents={agents}
      onPlanAction={planAction}
      onOpenMaster={() => selectAgent(MASTER_ID)}
      settings={settings[selected.id] ?? DEFAULT_AGENT_SETTINGS}
      onSettingsChange={(next) => setSettings((current) => ({ ...current, [selected.id]: next }))}
      userInitials={userInitials}
      onClose={overview ? () => setSelectedId(null) : undefined}
    />
  );

  return (
    <SandboxProvider live={live} refresh={refreshLive} onTasksChanged={reloadPlans}>
      <div className="grid gap-6 lg:grid-cols-2">
        {overview && !panel ? (
          <div ref={columnRef} className="flex min-w-0 scroll-mt-24 flex-col gap-5">
            <WorkspaceContext.Provider
              value={{
                openAgent: (id) => selectAgent(id, { reveal: true }),
                activePlans: plans.filter((plan) => ACTIVE_PLAN_STATUSES.includes(plan.status)),
              }}
            >
              {children}
            </WorkspaceContext.Provider>
          </div>
        ) : (
          <div ref={columnRef} className="flex min-w-0 scroll-mt-24 flex-col gap-2 lg:h-[calc(100svh-6.5rem)] lg:min-h-[36rem]">
            {overview ? (
              panel
            ) : (
              // The agent rail on the left, the open agent's panel filling the rest at full height
              <div className="flex min-h-0 flex-1 gap-3">
                <AgentPicker
                  agents={agents}
                  selectedId={selected?.id ?? ""}
                  pausedIds={paused}
                  statuses={statuses}
                  onSelect={(id) => selectAgent(id)}
                />
                <div className="flex min-w-0 flex-1 flex-col">{panel}</div>
              </div>
            )}
          </div>
        )}

        {/* The campaign's office, with its agents at their desks — click a character to open that agent */}
        <div className="min-w-0 lg:sticky lg:top-20 lg:h-[calc(100svh-6.5rem)] lg:min-h-[28rem] lg:self-start">
          <div className="overflow-hidden rounded-3xl shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_32px_-16px_rgb(15_23_42/0.12)] ring-1 ring-border/60 lg:h-full">
            {office ? (
              <AgentOffice
                scene={office}
                fit="cover"
                selectedAgentId={selected?.id ?? null}
                onAgentSelect={(id) => selectAgent(id, { reveal: true })}
                statuses={statuses}
                renderPreview={(seat, close) => (
                  <AgentPreviewCard
                    role={seat.role}
                    sprite={seat.frames[0]}
                    status={live ? statusByRole.get(seat.role.id) : undefined}
                    onOpen={() => {
                      close();
                      selectAgent(seat.id, { reveal: true });
                    }}
                  />
                )}
                className="aspect-[3/2] lg:aspect-auto lg:h-full"
              />
            ) : (
              // No scene bundle for this office yet: show the plain office image
              <img src={officeImage} alt="AI agent office" className="block aspect-[3/2] w-full object-cover lg:h-full" />
            )}
          </div>
        </div>
      </div>
    </SandboxProvider>
  );
}
