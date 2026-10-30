import { redirect } from "next/navigation";
import { Plug } from "lucide-react";
import { getBlotatoIntegration } from "@/lib/blotato/store";
import { getCurrentUser } from "@/lib/insforge/server";
import { OverviewPanel } from "@/components/dashboard/overview/overview-panel";
import { BlotatoIntegration } from "@/components/integrations/blotato";

export const metadata = { title: "Integrations" };

// Settings → Integrations: connect the user's own Blotato account with an API key
export default async function IntegrationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const integration = await getBlotatoIntegration(user.id);

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-slate-500/10 text-slate-600 dark:text-slate-300">
          <Plug className="size-5" />
        </span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Integrations</h2>
          <p className="text-sm text-muted-foreground">Services this app uses on your behalf. Keys are stored encrypted and never leave the server.</p>
        </div>
      </header>
      <OverviewPanel>
        <BlotatoIntegration integration={integration} />
      </OverviewPanel>
    </div>
  );
}
