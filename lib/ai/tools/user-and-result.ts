import "server-only";
import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import { getAgentDefinition } from "@/lib/ai/agent-definitions";
import type { WorkerContext } from "@/lib/ai/tools/context";

// request_user_action stops the run until the user has done something only they can do in the
// sandbox (usually logging in). It always needs approval: the run is saved, the task waits for the
// user, and clicking "Done" approves the call and continues the run from here.
export const REQUEST_USER_ACTION = "request_user_action";

export const requestUserAction = tool({
  name: REQUEST_USER_ACTION,
  description:
    "Ask the user to do something themselves on the computer, then wait until they're done. Use it when a site needs them to log in (or solve a captcha, or confirm a code). Open the login page first so it's ready for them. Never ask for passwords or codes in text: the user types them into the computer directly.",
  parameters: z.object({
    kind: z.enum(["login", "action"]).describe("login for signing in to a site; action for anything else"),
    reason: z.string().max(300).describe('One short sentence for the user, e.g. "Log in to Instagram so I can look at trending reels."'),
    url: z.string().nullable().describe("The page that's open for them, if any"),
    platform: z.string().nullable().describe('The site or app, e.g. "Instagram"'),
  }),
  needsApproval: true,
  execute: async () => "The user says they're done. Take a screenshot to check, then continue the task.",
});

// report_result ends the run with a structured result for the Master Agent: a summary, the details,
// and every file or link made. Artifacts already uploaded are matched by URL.
export const REPORT_RESULT = "report_result";

export const reportResult = tool({
  name: REPORT_RESULT,
  description:
    "Finish the task: hand your result to the Master Agent. Call it once, as your last step, with a summary, the full details, and every file or link you produced (with its URL and/or sandbox path).",
  parameters: z.object({
    summary: z.string().max(1000).describe("Two or three sentences on what you did and found"),
    details: z.string().max(20_000).describe("The full deliverable, ready to use: plain text, short paragraphs and \"- \" lists"),
    artifacts: z
      .array(
        z.object({
          type: z.enum(["image", "video", "document", "data", "link"]),
          name: z.string().max(120),
          url: z.string().nullable(),
          sandbox_path: z.string().nullable(),
          description: z.string().max(500).nullable(),
        })
      )
      .max(30),
  }),
  execute: async ({ summary, details, artifacts }, runContext?: RunContext<WorkerContext>) => {
    const context = runContext!.context;
    // Once per run, and never after the time is up (the last pass may only report)
    const check = getAgentDefinition(context.task.agentId).beforeReport;
    if (check && !context.reportChecked && Date.now() < context.deadlineAt) {
      context.reportChecked = true;
      const missing = await check(context).catch((error) => {
        console.warn("Checking the saved work failed", error);
        return null;
      });
      if (missing) return missing;
    }
    context.report = {
      summary: summary.trim(),
      details: details.trim(),
      artifacts: artifacts.map((artifact) => ({
        type: artifact.type,
        name: artifact.name.trim(),
        url: artifact.url?.trim() || null,
        sandboxPath: artifact.sandbox_path?.trim() || null,
        metadata: artifact.description ? { description: artifact.description } : {},
      })),
    };
    return "Result reported.";
  },
});
