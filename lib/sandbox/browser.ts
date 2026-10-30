import "server-only";
import type { Desktop } from "@/lib/sandbox/e2b";

// The web browser on the campaign's desktop, used the way a person would: open the browser (or
// bring its window to the front), click into it, then type the address in its address bar. Logins
// live in the browser's profile on the sandbox's disk, so they're shared by every agent.

// First one installed wins; logins live in one browser's profile, so it's always the same one.
// Firefox ESR is the desktop's default browser (the one the user gets from the menu too). Chrome's
// basic password store avoids the keyring prompt on Linux.
const CHROME_ARGS = "--no-first-run --no-default-browser-check --password-store=basic --start-maximized";
const BROWSERS = [
  { bin: "firefox-esr", args: "" },
  { bin: "firefox", args: "" },
  { bin: "google-chrome", args: CHROME_ARGS },
  { bin: "google-chrome-stable", args: CHROME_ARGS },
  { bin: "chromium", args: CHROME_ARGS },
  { bin: "chromium-browser", args: CHROME_ARGS },
];
// Window classes of those browsers (xdotool matches case-insensitively)
const BROWSER_CLASS = "chrome|chromium|firefox|navigator";
const LAUNCH_TIMEOUT_MS = 15_000;
const PAGE_LOAD_MS = 8_000;

// Pages that most likely want the user to sign in or prove they're human
const LOGIN_PAGE = /log ?in|sign ?in|sign ?up|signin|auth|verify|verification|captcha|checkpoint|two-factor|2fa|security check|are you a robot/i;

async function findBrowserWindow(desktop: Desktop) {
  const result = await desktop.commands.run(`xdotool search --onlyvisible --class '${BROWSER_CLASS}' 2>/dev/null | tail -n 1`);
  return result.stdout.trim() || null;
}

async function windowTitle(desktop: Desktop, windowId: string) {
  const result = await desktop.commands.run(`xdotool getwindowname ${windowId} 2>/dev/null || true`);
  return result.stdout.trim();
}

// A working browser window always has a title ("Mozilla Firefox", "New Tab - Google Chrome"). One
// without a title has stopped responding: typing and clicking in it do nothing. That happens when a
// browser was started by a command that E2B later killed (the SDK's open() uses xdg-open with the
// default 60 second command timeout), which leaves the window up but its page processes dead.
async function isResponsive(desktop: Desktop, windowId: string) {
  for (let check = 0; check < 3; check++) {
    if (await windowTitle(desktop, windowId)) return true;
    await desktop.wait(700);
  }
  return false;
}

async function closeBrowsers(desktop: Desktop) {
  // The brackets stop the patterns matching this command's own shell
  const browsers = "'[f]irefox|[c]hrome|[c]hromium'";
  await desktop.commands.run(`pkill -f ${browsers}; sleep 1; pkill -9 -f ${browsers}; true`);
}

// Started with no command timeout, so E2B never kills it
async function launchBrowser(desktop: Desktop) {
  const list = BROWSERS.map((browser) => browser.bin).join(" ");
  const found = await desktop.commands.run(`for b in ${list}; do if command -v $b >/dev/null 2>&1; then echo $b; break; fi; done`);
  const browser = BROWSERS.find((candidate) => candidate.bin === found.stdout.trim());
  if (!browser) throw new Error("No web browser is installed on the computer.");

  await desktop.commands.run(`${browser.bin} ${browser.args} >/tmp/browser.log 2>&1`, { background: true, timeoutMs: 0 });
  for (const start = Date.now(); Date.now() - start < LAUNCH_TIMEOUT_MS; ) {
    await desktop.wait(500);
    const windowId = await findBrowserWindow(desktop);
    if (windowId) {
      // Let it finish drawing before anyone clicks on it
      await desktop.wait(1500);
      return windowId;
    }
  }
  throw new Error("The browser didn't open. Take a screenshot and try open_browser again.");
}

// Opens the browser if it isn't open, brings its window to the front and clicks into it so it has
// the keyboard. The click lands on the empty part of the tab strip, never on the page.
// A browser that stopped responding is closed and opened again.
export async function openBrowser(desktop: Desktop, restart = false) {
  let windowId = restart ? null : await findBrowserWindow(desktop);
  if (windowId && !(await isResponsive(desktop, windowId))) windowId = null;
  const launched = !windowId;
  if (!windowId) {
    await closeBrowsers(desktop);
    windowId = await launchBrowser(desktop);
  }

  await desktop.commands.run(`xdotool windowactivate --sync ${windowId} 2>/dev/null; xdotool windowraise ${windowId} 2>/dev/null; true`);
  const geometry = await desktop.commands.run(`xdotool getwindowgeometry --shell ${windowId} 2>/dev/null || true`);
  const value = (name: string) => Number(geometry.stdout.match(new RegExp(`^${name}=(\\d+)`, "m"))?.[1] ?? NaN);
  const [x, y, width] = [value("X"), value("Y"), value("WIDTH")];
  if ([x, y, width].every(Number.isFinite)) await desktop.leftClick(Math.round(x + width * 0.6), y + 10);

  return { launched, windowId, title: await windowTitle(desktop, windowId) };
}

// Types the address into the address bar and waits for the page. Returns the page's title ("" if
// the browser stopped responding) and whether it changed, which is how a new page shows it loaded.
async function navigate(desktop: Desktop, windowId: string, url: string) {
  const before = await windowTitle(desktop, windowId);
  await desktop.press(["ctrl", "l"]);
  await desktop.wait(300);
  await desktop.write(url);
  await desktop.press("enter");

  // The window title changes once the new page has a title; stop waiting then (plus a moment to render)
  let title = before;
  const start = Date.now();
  while (Date.now() - start < PAGE_LOAD_MS) {
    await desktop.wait(500);
    title = await windowTitle(desktop, windowId);
    if (title && title !== before && Date.now() - start >= 1500) break;
  }
  await desktop.wait(1000);
  return { title, changed: title !== before };
}

// Goes to a URL in the browser's address bar, the way a person types it, and waits for the page.
// If the browser stops responding, it's opened again and the address typed once more.
export async function goToUrl(desktop: Desktop, url: string) {
  let { launched, windowId } = await openBrowser(desktop);
  let page = await navigate(desktop, windowId, url);
  if (!page.title) {
    ({ windowId } = await openBrowser(desktop, true));
    launched = true;
    page = await navigate(desktop, windowId, url);
  }
  return { launched, ...page };
}

// True when the page's title or address looks like a login, verification or captcha page
export function looksLikeLogin(title: string, url?: URL) {
  return LOGIN_PAGE.test(title) || (!!url && LOGIN_PAGE.test(`${url.hostname}${url.pathname}`));
}

// Error pages from the browser itself or from the site
const ERROR_PAGE =
  /page not found|not found|404|problem loading page|server not found|unable to connect|isn.t available|page unavailable|secure connection failed|connection timed out|access denied|this site can.t be reached/i;
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";

// Asks for the address from the sandbox (not the browser) to see whether it exists: the HTTP
// status after redirects, 0 when the site can't be reached at all (for example a misspelled domain)
export async function checkAddress(desktop: Desktop, url: string) {
  try {
    const result = await desktop.commands.run(
      `curl -s -o /dev/null -L --max-time 10 -A '${USER_AGENT}' -w '%{http_code} %{url_effective}' '${url.replace(/'/g, "%27")}' || true`,
      { timeoutMs: 15_000 }
    );
    const [status, finalUrl] = result.stdout.trim().split(" ");
    return { status: Number(status) || 0, finalUrl: finalUrl || url };
  } catch {
    return null;
  }
}

// What's wrong with the page that was opened, in words the agent can act on, or null if nothing
// seems wrong. Sites that block scripts (403, 429) aren't counted: the browser may still get in.
export function describePageProblem(title: string, check: Awaited<ReturnType<typeof checkAddress>>) {
  if (check?.status === 0) return "The site couldn't be reached: the domain is probably misspelled or doesn't exist.";
  if (check?.status === 404 || check?.status === 410) return `The site says this page doesn't exist (HTTP ${check.status}): the path is probably wrong.`;
  if (check && check.status >= 500) return `The site had a server error (HTTP ${check.status}); it may work if you try again shortly.`;
  if (ERROR_PAGE.test(title)) return `The page looks like an error page ("${title}").`;
  return null;
}
