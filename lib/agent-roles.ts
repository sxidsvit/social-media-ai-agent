// The AI team that works on every campaign. Office scenes only carry generic character names, so
// seats are given these roles in order — first seat is the Research Agent, and so on.
export type WorkerRoleId = "research" | "creator" | "scheduler" | "analytics";
export type AgentRoleId = WorkerRoleId | "master";

export type AgentRole = {
  id: AgentRoleId;
  name: string;
  emoji: string;
  description: string;
};

// computer: the agent has its own computer (an E2B desktop) in each campaign
export type WorkerRole = AgentRole & { id: WorkerRoleId; computer: boolean };

// Worker agents only take tasks from the Master Agent; users can still chat with them
export const AGENT_ROLES: WorkerRole[] = [
  { id: "research", name: "Research Agent", emoji: "🔍", description: "Finds trends and topics your audience cares about", computer: true },
  { id: "creator", name: "Creator Agent", emoji: "🎨", description: "Writes captions and designs the posts", computer: true },
  { id: "scheduler", name: "Scheduler Agent", emoji: "🗓️", description: "Plans the best time to post and schedules posts through Blotato", computer: false },
  { id: "analytics", name: "Analytics Agent", emoji: "📊", description: "Reports on post performance, on request or on a schedule you set", computer: false },
];

// The coordinator: takes the user's requests, plans them and hands the work to the team
export const MASTER_AGENT: AgentRole = {
  id: "master",
  name: "Master Agent",
  emoji: "🧠",
  description: "Plans your requests, assigns the team and reports back",
};

export const WORKER_IDS = AGENT_ROLES.map((role) => role.id) as [WorkerRoleId, ...WorkerRoleId[]];

export function agentRoleForSeat(index: number) {
  return AGENT_ROLES[index % AGENT_ROLES.length];
}

export function getAgentRole(id: AgentRoleId): AgentRole {
  return id === "master" ? MASTER_AGENT : (AGENT_ROLES.find((role) => role.id === id) ?? MASTER_AGENT);
}

// Whether the agent has its own computer
export function hasComputer(id: AgentRoleId): id is WorkerRoleId {
  return AGENT_ROLES.some((role) => role.id === id && role.computer);
}

export function isWorkerRole(id: string): id is WorkerRoleId {
  return (WORKER_IDS as string[]).includes(id);
}
