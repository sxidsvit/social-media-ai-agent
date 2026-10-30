import { getRequestScope } from "@/lib/request-scope";
import { getLiveStatus } from "@/lib/orchestration/status";

export const runtime = "nodejs";

// What every agent (and the campaign's sandbox) is doing right now, from the database
export async function GET() {
  const scope = await getRequestScope();
  if (!scope) return Response.json({ error: "Not signed in" }, { status: 401 });
  return Response.json(await getLiveStatus(scope), { headers: { "Cache-Control": "no-store" } });
}
