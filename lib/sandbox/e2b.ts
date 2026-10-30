import "server-only";
import { randomBytes } from "node:crypto";
import { Sandbox } from "@e2b/desktop";

// The E2B desktop itself. Only lib/sandbox/agent-sandbox.ts uses this; everything else goes
// through it, which tracks each agent sandbox's state in the database. The API key stays here.

export type Desktop = Sandbox;

// E2B pauses (not kills) a sandbox once this long passes without activity; every agent action and
// user heartbeat pushes it back. The idle-pause cron pauses after 3 minutes, so this is the backstop.
const E2B_TIMEOUT_MS = 5 * 60 * 1000;
export const RESOLUTION: [number, number] = [1280, 800];
const VNC_PORT = 5900;
const STREAM_PORT = 6080;

// Folders every agent shares
export const SANDBOX_ROOT = "/campaign";
export const SANDBOX_FOLDERS = ["/campaign/research", "/campaign/assets", "/campaign/output"];

function apiKey() {
  const key = process.env.E2B_API_KEY;
  if (!key) throw new Error("E2B_API_KEY is not set");
  return key;
}

export async function createDesktop(metadata: Record<string, string>) {
  const desktop = await Sandbox.create({
    apiKey: apiKey(),
    resolution: RESOLUTION,
    timeoutMs: E2B_TIMEOUT_MS,
    lifecycle: { onTimeout: "pause" },
    metadata,
  });
  await desktop.commands.run(`sudo mkdir -p ${SANDBOX_FOLDERS.join(" ")} && sudo chown -R $(whoami) ${SANDBOX_ROOT}`);
  return desktop;
}

// Connects to a running sandbox, resuming it first if it's paused
export async function connectDesktop(sandboxId: string) {
  const desktop = await Sandbox.connect(sandboxId, { apiKey: apiKey(), timeoutMs: E2B_TIMEOUT_MS });
  await keepAlive(desktop);
  return desktop;
}

// Pushes back E2B's own auto-pause
export async function keepAlive(desktop: Desktop) {
  await desktop.setTimeout(E2B_TIMEOUT_MS);
}

// Pushes back E2B's auto-pause without connecting (for the viewer's heartbeat)
export async function extendDesktop(sandboxId: string) {
  await Sandbox.setTimeout(sandboxId, E2B_TIMEOUT_MS, { apiKey: apiKey() });
}

export async function pauseDesktop(sandboxId: string) {
  await Sandbox.pause(sandboxId, { apiKey: apiKey() });
}

export async function killDesktop(sandboxId: string) {
  await Sandbox.kill(sandboxId, { apiKey: apiKey() });
}

// "running", "paused", or null when E2B no longer has the sandbox
export async function getDesktopState(sandboxId: string): Promise<"running" | "paused" | null> {
  try {
    const info = await Sandbox.getInfo(sandboxId, { apiKey: apiKey() });
    return info.state === "paused" ? "paused" : "running";
  } catch {
    return null;
  }
}

export function newStreamKey() {
  return randomBytes(12).toString("base64url");
}

// Starts the desktop stream (x11vnc + noVNC) if it isn't running. Two passwords: the full one
// controls the desktop, the view one only watches it. Started here rather than with the SDK's
// stream.start() so any server process can rebuild the URL from the saved passwords; the stream
// keeps running across a pause and resume.
export async function ensureStream(desktop: Desktop, keys: { full: string; view: string }) {
  const running = await desktop.commands.run(`netstat -tuln | grep ":${STREAM_PORT} " || true`);
  if (running.stdout.trim()) return;

  await desktop.commands.run("pkill x11vnc || true");
  await desktop.commands.run(
    `x11vnc -bg -display ${desktop.display} -forever -wait 50 -shared -rfbport ${VNC_PORT} -passwd ${keys.full} -viewpasswd ${keys.view} 2>/tmp/x11vnc_stderr.log`
  );
  await desktop.commands.run(
    `cd /opt/noVNC/utils && ./novnc_proxy --vnc localhost:${VNC_PORT} --listen ${STREAM_PORT} --web /opt/noVNC > /tmp/novnc.log 2>&1`,
    { background: true, timeoutMs: 0 }
  );
  const ready = await desktop.waitAndVerify(`netstat -tuln | grep ":${STREAM_PORT} "`, (result) => result.stdout.trim() !== "");
  if (!ready) throw new Error("The desktop stream didn't start.");
}

export function streamUrl(desktop: Desktop, key: string, viewOnly: boolean) {
  const url = new URL(`https://${desktop.getHost(STREAM_PORT)}/vnc.html`);
  url.searchParams.set("autoconnect", "true");
  url.searchParams.set("resize", "scale");
  if (viewOnly) url.searchParams.set("view_only", "true");
  url.searchParams.set("password", key);
  return url.toString();
}
