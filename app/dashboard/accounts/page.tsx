import Link from "next/link";
import { redirect } from "next/navigation";
import { Link2, Settings } from "lucide-react";
import { refreshedLabel } from "@/lib/blotato/shared";
import { getBlotatoIntegration } from "@/lib/blotato/store";
import { getCurrentUser } from "@/lib/insforge/server";
import { OverviewEmptyState, OverviewPanel } from "@/components/dashboard/overview/overview-panel";
import { AccountsList, RefreshAccountsButton } from "@/components/integrations/blotato";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Accounts" };

// Every social account the user connected in Blotato, grouped by platform
export default async function AccountsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const integration = await getBlotatoIntegration(user.id);

  if (!integration.connected) {
    return (
      <OverviewPanel>
        <OverviewEmptyState
          Icon={Link2}
          tone="bg-linear-to-br from-sky-400 to-cyan-600 text-white"
          glow="shadow-sky-500/40"
          title="No accounts connected yet"
          description="Connect your Blotato account to see your Instagram, TikTok and YouTube accounts here and publish to them."
        >
          <Button size="lg" className="rounded-xl" nativeButton={false} render={<Link href="/dashboard/settings/integrations" />}>
            <Settings data-icon="inline-start" />
            Go to Settings → Integrations
          </Button>
        </OverviewEmptyState>
      </OverviewPanel>
    );
  }

  return (
    <OverviewPanel
      title="Connected accounts"
      action={
        <div className="flex items-start gap-2">
          <Button variant="ghost" size="sm" className="rounded-lg" nativeButton={false} render={<Link href="/dashboard/settings/integrations" />}>
            Manage
          </Button>
          <RefreshAccountsButton />
        </div>
      }
    >
      <p className="mb-5 text-sm text-muted-foreground">
        From your Blotato account · {integration.accounts.length} account{integration.accounts.length === 1 ? "" : "s"} · {refreshedLabel(integration.refreshedAt)}
      </p>
      <AccountsList accounts={integration.accounts} />
    </OverviewPanel>
  );
}
