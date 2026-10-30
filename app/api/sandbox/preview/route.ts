import { WORKER_IDS, type WorkerRoleId } from "@/lib/agent-roles";
import { getRequestScope } from "@/lib/request-scope";
import { getPreview } from "@/lib/sandbox/agent-sandbox";

export const runtime = "nodejs";

// The last screenshot of an agent's computer (taken when it was paused), only for the campaign's
// owner: ?agent=research
export async function GET(request: Request) {
  const scope = await getRequestScope();
  if (!scope) return new Response("Not signed in", { status: 401 });
  const agent = new URL(request.url).searchParams.get("agent");
  if (!agent || !WORKER_IDS.includes(agent as WorkerRoleId)) return new Response("Unknown agent", { status: 400 });
  const preview = await getPreview({ campaignId: scope.campaignId, agentId: agent as WorkerRoleId });
  if (!preview) return new Response("No preview yet", { status: 404 });
  return new Response(Buffer.from(preview.image, "base64"), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
  });
}
