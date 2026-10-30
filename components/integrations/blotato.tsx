"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, KeyRound, Link2, RefreshCw, Unplug, UserRound } from "lucide-react";
import { refreshBlotato, removeBlotato, saveBlotatoKey } from "@/app/dashboard/settings/actions";
import { accountLabel, accountsByPlatform, BLOTATO_SETTINGS_URL, refreshedLabel, type BlotatoAccount, type IntegrationView } from "@/lib/blotato/shared";
import { POST_PLATFORMS } from "@/lib/posts/shared";
import { platformName } from "@/lib/social-platforms";
import { cn } from "@/lib/utils";
import { PLATFORM_STYLES, PlatformIcon } from "@/components/posts/platform-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

// Blotato: the user's own account, which holds their Instagram, TikTok and YouTube connections. The
// key is pasted here once, checked and stored encrypted by the server; the browser never sees it again.

export function BlotatoIntegration({ integration }: { integration: IntegrationView }) {
  const [replacing, setReplacing] = useState(false);
  const connected = integration.connected && !replacing;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-violet-500/30">
          <Link2 className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            Blotato
            {integration.connected && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-3" />
                Connected
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Publishes and schedules your posts on Instagram, TikTok and YouTube, and lets the Scheduler Agent post for you. Each person uses their own Blotato account.
          </p>
        </div>
      </div>

      {connected ? (
        <ConnectedState integration={integration} onReplace={() => setReplacing(true)} />
      ) : (
        <ConnectForm replacing={replacing} onCancel={integration.connected ? () => setReplacing(false) : undefined} onDone={() => setReplacing(false)} />
      )}
    </div>
  );
}

function ConnectForm({ replacing, onCancel, onDone }: { replacing: boolean; onCancel?: () => void; onDone: () => void }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveBlotatoKey(key);
      if (result.error) {
        setError(result.error);
        return;
      }
      setKey("");
      onDone();
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl bg-muted/40 p-4 ring-1 ring-border/60">
      {!replacing && (
        <ol className="space-y-1.5 text-sm text-muted-foreground">
          <li>
            1. In Blotato, connect your Instagram, TikTok and YouTube accounts.{" "}
            <a href={BLOTATO_SETTINGS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
              Open Blotato <ExternalLink className="size-3" />
            </a>
          </li>
          <li>2. Under Settings → API, generate an API key and copy it.</li>
          <li>3. Paste it below. We check it, then store it encrypted.</li>
        </ol>
      )}
      <Field>
        <FieldLabel htmlFor="blotato-key" className="font-semibold">
          {replacing ? "New API key" : "Blotato API key"}
        </FieldLabel>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="blotato-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your full key (it may end in =)"
            className="h-11 rounded-xl bg-card pl-10 font-mono text-sm"
          />
        </div>
      </Field>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="lg" className="h-10 rounded-xl px-4" disabled={pending || key.trim().length < 10}>
          {pending && <Spinner />}
          {pending ? "Checking key…" : replacing ? "Save new key" : "Connect Blotato"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="lg" className="h-10 rounded-xl" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function ConnectedState({ integration, onReplace }: { integration: IntegrationView; onReplace: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-muted/40 p-3 pl-4 text-sm ring-1 ring-border/60">
        <KeyRound className="size-4 text-muted-foreground" />
        <span className="font-mono text-muted-foreground">••••••••{integration.keyHint}</span>
        <span className="flex-1" />
        <Button variant="outline" size="sm" className="rounded-lg" onClick={onReplace}>
          Replace key
        </Button>
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="ghost" size="sm" className="rounded-lg text-destructive hover:text-destructive" disabled={removing} />}>
            {removing ? <Spinner /> : <Unplug data-icon="inline-start" />}
            Disconnect
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect Blotato?</AlertDialogTitle>
              <AlertDialogDescription>
                Your key is deleted from this app. Scheduled posts will fail to publish until you connect again, and the Scheduler Agent can no longer post for you.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep connected</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() =>
                  startRemoving(async () => {
                    const result = await removeBlotato();
                    if (result.error) setError(result.error);
                    else router.refresh();
                  })
                }
              >
                Disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">Connected accounts</h4>
          <p className="text-xs text-muted-foreground">{refreshedLabel(integration.refreshedAt)}</p>
        </div>
        <RefreshAccountsButton />
      </div>
      <AccountsList accounts={integration.accounts} />
    </div>
  );
}

// Fetches the accounts from Blotato again, after the user connects or removes one there
export function RefreshAccountsButton({ className }: { className?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <Button
        variant="outline"
        size="sm"
        className="rounded-lg"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await refreshBlotato();
            if (result.error) setError(result.error);
            else router.refresh();
          })
        }
      >
        <RefreshCw data-icon="inline-start" className={cn(pending && "animate-spin")} />
        {pending ? "Refreshing…" : "Refresh accounts"}
      </Button>
      {error && <p className="max-w-xs text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}

// The user's Blotato accounts: the platforms posts can go to first, then any others
export function AccountsList({ accounts }: { accounts: BlotatoAccount[] }) {
  const byPlatform = accountsByPlatform(accounts);
  const others = accounts.filter((account) => !(POST_PLATFORMS as readonly string[]).includes(account.platform));

  return (
    <div className="space-y-3">
      <ul className="grid gap-3 md:grid-cols-3">
        {POST_PLATFORMS.map((platform) => {
          const list = byPlatform[platform] ?? [];
          return (
            <li key={platform} className={cn("rounded-2xl p-3.5", list.length ? "bg-card ring-1 ring-border/60" : "border border-dashed border-border bg-muted/30")}>
              <div className="flex items-center gap-2.5">
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl shadow-md", PLATFORM_STYLES[platform].tile)}>
                  <PlatformIcon platform={platform} className="size-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{PLATFORM_STYLES[platform].name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {list.length ? `${list.length} account${list.length === 1 ? "" : "s"}` : "Not connected"}
                    {platform === "youtube" && " · videos & Shorts"}
                  </p>
                </div>
              </div>
              {list.length > 0 ? (
                <ul className="mt-3 space-y-1.5">
                  {list.map((account) => (
                    <AccountRow key={account.id} account={account} />
                  ))}
                </ul>
              ) : (
                <a
                  href={BLOTATO_SETTINGS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Connect in Blotato <ExternalLink className="size-3" />
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {others.length > 0 && (
        <div className="rounded-2xl bg-muted/30 p-3.5 ring-1 ring-border/60">
          <p className="text-xs font-medium text-muted-foreground">Also in your Blotato account (posting here supports Instagram, TikTok and YouTube for now)</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {others.map((account) => (
              <li key={account.id} className="rounded-lg bg-card px-2 py-1 text-xs ring-1 ring-border/60">
                <span className="font-medium">{platformName(account.platform === "twitter" ? "x" : account.platform)}</span> · {accountLabel(account)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AccountRow({ account }: { account: BlotatoAccount }) {
  return (
    <li className="flex items-center gap-2 rounded-xl bg-muted/50 px-2.5 py-1.5">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border">
        <UserRound className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{account.name}</span>
        {account.username && <span className="block truncate text-[11px] text-muted-foreground">{accountLabel(account)}</span>}
      </span>
    </li>
  );
}
