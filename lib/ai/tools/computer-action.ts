import "server-only";
import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import { recordVisit, type WorkerContext } from "@/lib/ai/tools/context";
import { clipText, holdForUserOrCheckpoint, screenshotForModel, setStep, useSandbox } from "@/lib/ai/tools/runtime";
import { checkAddress, describePageProblem, goToUrl, looksLikeLogin, openBrowser } from "@/lib/sandbox/browser";
import { RESOLUTION, type Desktop } from "@/lib/sandbox/e2b";

// Drives the campaign's desktop: look at the screen, open the browser and go to a page, click,
// type, scroll, drag, wait, or run a shell command. Every action except "run" answers with a fresh
// screenshot, so the model sees the result of each action before choosing the next one. While the
// user has taken over the desktop, the next action is held and the run waits until they hand it back.

export const LOGIN_HINT =
  "This looks like a login, verification or captcha page. If the page asks you to sign in or prove you're human, don't try it yourself: call request_user_action (kind \"login\") now so the user can do it on the computer.";
const FIX_PAGE =
  "Fix it before going on: check the address (spelling of the domain, the right path for this site, e.g. instagram.com/explore/tags/<tag>/ for a hashtag) and open the corrected one. If you're not sure of the right address, search for it instead of guessing: open_url https://duckduckgo.com/?q=<what you're looking for>, then click the right result. If it still fails after two different tries, call ask_master and say what you tried. Never report information from a page that didn't open.";
const CHECK_PAGE =
  "Check the screenshot: is this the page you wanted? If it says the page isn't available or shows something else, fix the address and try again. If it shows a login form, a sign-in wall, a captcha or a code prompt, call request_user_action (kind \"login\"). Otherwise carry on.";

const [WIDTH, HEIGHT] = RESOLUTION;
// open_url can take up to ~35 seconds when the browser has to be restarted
const ACTION_TIMEOUT_MS = 75_000;

// Strict tool schemas need every field present, so the per-action fields are nullable
const ComputerAction = z.object({
  action: z.enum(["screenshot", "open_browser", "open_url", "click", "type", "scroll", "drag", "wait", "run"]),
  x: z.number().int().min(0).max(WIDTH).nullable().describe("click / scroll / drag start: x in screen pixels"),
  y: z.number().int().min(0).max(HEIGHT).nullable().describe("click / scroll / drag start: y in screen pixels"),
  to_x: z.number().int().min(0).max(WIDTH).nullable().describe("drag: end x in screen pixels"),
  to_y: z.number().int().min(0).max(HEIGHT).nullable().describe("drag: end y in screen pixels"),
  button: z.enum(["left", "right", "double"]).nullable().describe("click: which click, default left"),
  text: z.string().max(4000).nullable().describe("type: the text to type at the cursor"),
  keys: z
    .array(z.string())
    .nullable()
    .describe('type: a key or key combination to press after the text, e.g. ["enter"] or ["ctrl", "l"]'),
  direction: z.enum(["up", "down"]).nullable().describe("scroll: direction, default down"),
  amount: z.number().int().min(1).max(20).nullable().describe("scroll: how far, default 3"),
  url: z.string().nullable().describe("open_url: an http(s) URL to type into the browser's address bar"),
  seconds: z.number().int().min(1).max(10).nullable().describe("wait: how long to wait for the screen to settle, default 2"),
  command: z.string().max(2000).nullable().describe("run: a shell command to run in the sandbox"),
});

type Input = z.infer<typeof ComputerAction>;

// Title of the window in front (for a browser, the page's title); "" if there's none
async function focusedTitle(desktop: Desktop) {
  const result = await desktop.commands.run("xdotool getwindowfocus getwindowname 2>/dev/null || true").catch(() => null);
  return result?.stdout.trim() ?? "";
}

function describe(input: Input) {
  switch (input.action) {
    case "screenshot":
      return "Looking at the screen";
    case "click":
      return `Clicking at ${input.x}, ${input.y}`;
    case "type":
      return input.text ? "Typing" : `Pressing ${input.keys?.join("+") ?? "a key"}`;
    case "scroll":
      return `Scrolling ${input.direction ?? "down"}`;
    case "drag":
      return "Dragging";
    case "wait":
      return "Waiting for the page";
    case "open_browser":
      return "Opening the browser";
    case "open_url":
      try {
        return `Opening ${new URL(input.url ?? "").hostname}`;
      } catch {
        return "Opening a page";
      }
    case "run":
      return "Running a command";
  }
}

// Types the address into the browser, checks the page loaded (and isn't an error or login page) and
// says what to do next. Shared with web_search.
export async function openPage(context: WorkerContext, desktop: Desktop, url: URL) {
  // The address is checked from the sandbox while the browser loads it
  const [page, check] = await Promise.all([goToUrl(desktop, url.toString()), checkAddress(desktop, url.toString())]);
  const problem = describePageProblem(page.title, check);
  if (!problem) recordVisit(context, url.toString());
  const note = [
    `${page.launched ? "Opened the browser and went" : "Went"} to ${url.toString()}${page.title ? ` ("${page.title}")` : ""}.`,
    problem ? `PROBLEM: ${problem} ${FIX_PAGE}` : "",
    !problem && !page.changed ? "The page title didn't change, so it may not have loaded: check the screenshot, then use wait or open_url again." : "",
    problem ? "" : looksLikeLogin(page.title, url) ? LOGIN_HINT : CHECK_PAGE,
  ]
    .filter(Boolean)
    .join(" ");
  return { title: page.title, problem, note };
}

export const computerAction = tool({
  name: "computer_action",
  description: `Use your computer (a ${WIDTH}x${HEIGHT} Linux desktop with a web browser), your own in this campaign. One action per call; every action except run returns a new screenshot, so look at it before deciding the next action. Actions: screenshot; open_browser (opens the browser, or brings it to the front, and clicks into it); open_url (url: opens the browser if needed and types the address into its address bar); click (x, y, button); type (text and/or keys); scroll (direction, amount, optional x/y); drag (x, y to to_x, to_y); wait (seconds, for a page to load); run (a shell command). Coordinates are screen pixels from the top-left.`,
  parameters: ComputerAction,
  needsApproval: holdForUserOrCheckpoint,
  // An action that hangs (a slow page, a stuck command) comes back as a message, not a stuck task
  timeoutMs: ACTION_TIMEOUT_MS,
  timeoutBehavior: "error_as_result",
  timeoutErrorFunction: () =>
    `That action took longer than ${ACTION_TIMEOUT_MS / 1000} seconds and was stopped. Take a screenshot to see where things are, then try another way.`,
  execute: async (input, runContext?: RunContext<WorkerContext>) => {
    const context = runContext!.context;
    const desktop = await useSandbox(context);
    await setStep(context, describe(input));

    let note = "";
    switch (input.action) {
      case "screenshot":
        break;
      case "open_browser": {
        const browser = await openBrowser(desktop);
        note = `${browser.launched ? "Opened the browser" : "The browser was already open; brought it to the front"} and clicked into it${browser.title ? ` ("${browser.title}")` : ""}.`;
        break;
      }
      case "click": {
        if (input.x === null || input.y === null) return "click needs x and y.";
        const click = input.button === "right" ? desktop.rightClick : input.button === "double" ? desktop.doubleClick : desktop.leftClick;
        await click.call(desktop, input.x, input.y);
        note = `Clicked at ${input.x}, ${input.y}.`;
        break;
      }
      case "type":
        if (!input.text && !input.keys?.length) return "type needs text or keys.";
        if (input.text) await desktop.write(input.text);
        if (input.keys?.length) await desktop.press(input.keys.length === 1 ? input.keys[0] : input.keys);
        note = "Typed.";
        break;
      case "scroll":
        if (input.x !== null && input.y !== null) await desktop.moveMouse(input.x, input.y);
        await desktop.scroll(input.direction ?? "down", input.amount ?? 3);
        note = "Scrolled.";
        break;
      case "open_url": {
        let url: URL;
        try {
          url = new URL(input.url ?? "");
        } catch {
          return "open_url needs a full URL, e.g. https://www.instagram.com";
        }
        if (url.protocol !== "https:" && url.protocol !== "http:") return "Only http and https URLs can be opened.";
        note = (await openPage(context, desktop, url)).note;
        break;
      }
      case "drag":
        if (input.x === null || input.y === null || input.to_x === null || input.to_y === null) return "drag needs x, y, to_x and to_y.";
        await desktop.drag([input.x, input.y], [input.to_x, input.to_y]);
        note = `Dragged from ${input.x}, ${input.y} to ${input.to_x}, ${input.to_y}.`;
        break;
      case "wait":
        await desktop.wait((input.seconds ?? 2) * 1000);
        note = "Waited.";
        break;
      case "run": {
        if (!input.command) return "run needs a command.";
        try {
          const result = await desktop.commands.run(input.command, { timeoutMs: 60_000 });
          return clipText(`Exit code ${result.exitCode}\n${result.stdout}${result.stderr ? `\nstderr:\n${result.stderr}` : ""}`);
        } catch (error) {
          // A non-zero exit throws, with the output attached
          const failed = error as { exitCode?: number; stdout?: string; stderr?: string; message?: string };
          return clipText(`Exit code ${failed.exitCode ?? "?"}\n${failed.stdout ?? ""}\nstderr:\n${failed.stderr ?? failed.message ?? ""}`);
        }
      }
    }

    if (input.action !== "screenshot") await desktop.wait(800);
    // A click or keypress can land on a sign-in wall too
    if (input.action !== "open_url" && looksLikeLogin(await focusedTitle(desktop))) note = `${note} ${LOGIN_HINT}`.trim();
    return [{ type: "text" as const, text: note || "Here is the screen." }, await screenshotForModel(desktop)];
  },
});
