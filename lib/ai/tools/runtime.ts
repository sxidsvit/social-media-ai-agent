import "server-only";
import { toFile } from "openai";
import type { RunContext } from "@openai/agents";
import { eq } from "drizzle-orm";
import { agentTasks, db } from "@/db";
import { getOpenAIClient } from "@/lib/ai/openai";
import type { WorkerContext } from "@/lib/ai/tools/context";
import { getSandboxControl, markSandboxActive, renewSandboxLease } from "@/lib/sandbox/agent-sandbox";
import type { Desktop } from "@/lib/sandbox/e2b";

// Helpers shared by the agents' tools: pausing a run between steps, the user taking over, the
// "current step" shown in the UI, and screenshots for the model.

// Approval policy for tools that can run long or touch the sandbox. A held call becomes an
// interruption: the run is saved and continues in the next Inngest step (checkpoint), or once the
// user hands the sandbox back (takeover).
export function checkpointDue(runContext: RunContext) {
  const context = runContext.context as WorkerContext;
  return Promise.resolve(Date.now() >= context.checkpointAt);
}

export async function holdForUserOrCheckpoint(runContext: RunContext) {
  const context = runContext.context as WorkerContext;
  if (context.sandbox && (await getSandboxControl(context.sandbox.key)) === "user") {
    context.takeover = true;
    return true;
  }
  return Date.now() >= context.checkpointAt;
}

// What the agent is doing, for the task status. Best effort: a failed write never fails the action.
export async function setStep(context: WorkerContext, step: string | null) {
  const text = step && step.length > 140 ? `${step.slice(0, 140)}…` : step;
  await db
    .update(agentTasks)
    .set({ currentStep: text, updatedAt: new Date() })
    .where(eq(agentTasks.id, context.task.id))
    .catch((error) => console.warn("Saving the current step failed", error));
}

// The sandbox for this run, with its lease renewed and its idle pause pushed back
export async function useSandbox(context: WorkerContext): Promise<Desktop> {
  if (!context.sandbox) throw new Error("This agent doesn't have a computer.");
  const desktop = await context.sandbox.open();
  await Promise.all([renewSandboxLease(context.sandbox.key, context.task.id), markSandboxActive(context.sandbox.key, desktop)]);
  return desktop;
}

// Screenshots go to the OpenAI Files API and reach the model by file id, so a saved run stays small
// and screens (which can show logged-in accounts) never get a public URL. Files expire on their own.
const SCREENSHOT_TTL_SECONDS = 3 * 24 * 60 * 60;

export async function screenshotForModel(desktop: Desktop) {
  const png = await desktop.screenshot();
  try {
    const file = await getOpenAIClient().files.create({
      file: await toFile(png, "screen.png", { type: "image/png" }),
      purpose: "vision",
      expires_after: { anchor: "created_at", seconds: SCREENSHOT_TTL_SECONDS },
    }, { timeout: 20_000, maxRetries: 1 });
    return { type: "image" as const, image: { fileId: file.id }, detail: "auto" as const };
  } catch (error) {
    console.warn("Uploading a screenshot failed; sending it inline", error);
    return { type: "image" as const, image: `data:image/png;base64,${Buffer.from(png).toString("base64")}`, detail: "auto" as const };
  }
}

// Sandbox paths the agents may touch
export function checkSandboxPath(path: string) {
  const normalized = path.trim();
  if (!normalized.startsWith("/campaign/") && normalized !== "/campaign") throw new Error("Only paths under /campaign can be used.");
  if (normalized.split("/").includes("..")) throw new Error("Paths can't contain \"..\".");
  return normalized;
}

export function clipText(text: string, max = 8000) {
  return text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text;
}
