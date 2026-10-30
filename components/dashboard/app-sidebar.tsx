"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Flag, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { endCampaign, switchCampaign } from "@/app/dashboard/actions";
import { NAV_ITEMS, getActiveNav, navHref, type NavItem } from "@/lib/dashboard-nav";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { CampaignIcon } from "@/components/campaign/campaign-icon";
import type { CampaignOption } from "@/components/dashboard/dashboard-shell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Geometry: the collapsed panel is 64px wide with 8px padding, leaving a 48px row —
// every row is p-1.5 around a 36px tile so icons line up in both states.

type Props = {
  campaigns: CampaignOption[];
  activeCampaignId: number;
  pathname: string;
  expanded: boolean;
  // Desktop only: collapse/expand button at the bottom
  onToggle?: () => void;
  // Mobile drawer: close after navigating
  onNavigate?: () => void;
};

const MAIN_NAV = NAV_ITEMS.filter((item) => item.slug !== "settings");
const SETTINGS_NAV = NAV_ITEMS.find((item) => item.slug === "settings")!;

export function AppSidebar({ campaigns, activeCampaignId, pathname, expanded, onToggle, onNavigate }: Props) {
  const activeSlug = getActiveNav(pathname).slug;

  return (
    <div className="flex h-full flex-col rounded-[28px] bg-card px-2 py-3 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_16px_40px_-16px_rgb(15_23_42/0.14)] ring-1 ring-border/60">
      <div className="flex h-12 items-center overflow-hidden px-2">
        <Logo href="/dashboard" wordmarkClassName={fade(expanded)} />
      </div>

      <Divider />

      <CampaignSwitcher
        campaigns={campaigns}
        activeCampaignId={activeCampaignId}
        expanded={expanded}
        onNavigate={onNavigate}
      />

      <SectionLabel expanded={expanded}>Menu</SectionLabel>

      <nav aria-label="Main" className="no-scrollbar -mx-2 min-h-0 flex-1 overflow-y-auto px-2">
        <ul className="flex flex-col gap-1">
          {MAIN_NAV.map((item) => (
            <NavLink
              key={item.slug}
              item={item}
              active={item.slug === activeSlug}
              expanded={expanded}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      </nav>

      <Divider />

      <ul className="flex flex-col gap-1">
        <NavLink
          item={SETTINGS_NAV}
          active={SETTINGS_NAV.slug === activeSlug}
          expanded={expanded}
          onNavigate={onNavigate}
        />
        {onToggle && (
          <li>
            <Tooltip disabled={expanded}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={onToggle}
                    aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
                    aria-expanded={expanded}
                    className={cn(rowClass, "w-full text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
                  />
                }
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-transform duration-300 group-hover/row:scale-105">
                  {expanded ? <PanelLeftClose className="size-4.5" /> : <PanelLeftOpen className="size-4.5" />}
                </span>
                <span className={cn("flex min-w-0 flex-1 items-center justify-between gap-2", fade(expanded))}>
                  Collapse
                  <Kbd>⌘B</Kbd>
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={14}>
                Expand <Kbd className="bg-background/15 text-background">⌘B</Kbd>
              </TooltipContent>
            </Tooltip>
          </li>
        )}
      </ul>
    </div>
  );
}

const rowClass =
  "group/row relative flex items-center gap-3 overflow-hidden rounded-2xl p-1.5 text-left text-sm font-medium whitespace-nowrap outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/50";

// Labels slide + fade instead of popping in/out while the panel width animates.
function fade(expanded: boolean) {
  return cn(
    "transition-[opacity,translate] duration-300 ease-out",
    expanded ? "translate-x-0 opacity-100 delay-75" : "pointer-events-none -translate-x-1.5 opacity-0"
  );
}

function Divider() {
  return <div className="mx-2 my-3 h-px shrink-0 bg-border/70" />;
}

function SectionLabel({ expanded, children }: { expanded: boolean; children: React.ReactNode }) {
  return (
    <div className="relative mt-5 mb-2 flex h-4 items-center px-2.5">
      <span className={cn("text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase", fade(expanded))}>
        {children}
      </span>
      {/* Collapsed: a short rule stands in for the label */}
      <span
        className={cn(
          "absolute left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-border transition-opacity duration-300",
          expanded ? "opacity-0" : "opacity-100"
        )}
      />
    </div>
  );
}

function NavLink({
  item,
  active,
  expanded,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  expanded: boolean;
  onNavigate?: () => void;
}) {
  const { Icon } = item;

  return (
    <li className="relative">
      {/* Active marker on the panel edge */}
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 -left-2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-foreground transition-[opacity,scale] duration-300",
          active ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0"
        )}
      />
      <Tooltip disabled={expanded}>
        <TooltipTrigger
          render={
            <Link
              href={navHref(item.slug)}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                rowClass,
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                expanded && (active ? "bg-muted/70" : "hover:bg-muted/50")
              )}
            />
          }
        >
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl transition-all duration-300 group-hover/row:scale-105",
              active ? cn(item.solid, "shadow-lg", item.glow) : item.tint
            )}
          >
            <Icon className="size-4.5" strokeWidth={active ? 2.25 : 2} />
          </span>
          <span className={cn("min-w-0 flex-1 truncate", fade(expanded))}>{item.label}</span>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={14}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

function CampaignSwitcher({
  campaigns,
  activeCampaignId,
  expanded,
  onNavigate,
}: {
  campaigns: CampaignOption[];
  activeCampaignId: number;
  expanded: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, startEnding] = useTransition();
  const [endError, setEndError] = useState<string | null>(null);
  const active = campaigns.find((c) => c.id === activeCampaignId) ?? campaigns[0];

  function end() {
    startEnding(async () => {
      const result = await endCampaign(active.id);
      if (result.error) setEndError(result.error);
      else setConfirmEnd(false);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Current campaign: ${active.name}. Switch campaign`}
          className={cn(
            rowClass,
            "w-full data-popup-open:bg-muted",
            expanded ? "bg-muted/50 ring-1 ring-border/70 hover:bg-muted" : "hover:bg-muted/60"
          )}
        >
          <span className="relative shrink-0">
            <CampaignIcon
              icon={active.icon}
              iconUrl={active.iconUrl}
              className={cn(
                "size-9 shadow-sm transition-transform duration-300 group-hover/row:scale-105",
                pending && "animate-pulse"
              )}
            />
            {/* Collapsed: tiny badge hints that the tile opens a menu */}
            <span
              className={cn(
                "absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-card text-muted-foreground shadow-sm ring-1 ring-border transition-[opacity,scale] duration-300",
                expanded ? "scale-50 opacity-0" : "scale-100 opacity-100"
              )}
            >
              <ChevronsUpDown className="size-2.5" />
            </span>
          </span>
          <span className={cn("min-w-0 flex-1", fade(expanded))}>
            <span className="block text-[11px] font-medium tracking-wide text-muted-foreground">Campaign</span>
            <span className="block truncate text-sm font-semibold text-foreground">
              {active.name}
              {active.ended && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(ended)</span>}
            </span>
          </span>
          <ChevronsUpDown className={cn("mr-1 size-4 shrink-0 text-muted-foreground", fade(expanded))} />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side={expanded ? "bottom" : "right"}
          align="start"
          sideOffset={expanded ? 8 : 14}
          className="w-64 rounded-2xl p-1.5 shadow-xl"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 pt-1.5 pb-2">Your campaigns</DropdownMenuLabel>
            {campaigns.map((campaign) => {
              const isActive = campaign.id === active.id;
              return (
                <DropdownMenuItem
                  key={campaign.id}
                  onClick={() => {
                    if (!isActive) startTransition(() => switchCampaign(campaign.id));
                  }}
                  className="gap-2.5 rounded-xl p-2"
                >
                  <CampaignIcon icon={campaign.icon} iconUrl={campaign.iconUrl} className="size-8 rounded-lg" />
                  <span className={cn("min-w-0 flex-1 truncate", isActive && "font-semibold")}>{campaign.name}</span>
                  {isActive && <Check className="size-4 text-primary" strokeWidth={2.5} />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator className="my-1.5" />
          <DropdownMenuItem
            onClick={() => {
              onNavigate?.();
              router.push("/create-campaign");
            }}
            className="gap-2.5 rounded-xl p-2 font-medium"
          >
            <span className="flex size-8 items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 text-muted-foreground">
              <Plus className="size-4" />
            </span>
            Create new campaign
          </DropdownMenuItem>
          {!active.ended && (
            <DropdownMenuItem
              onClick={() => {
                setEndError(null);
                setConfirmEnd(true);
              }}
              className="gap-2.5 rounded-xl p-2 text-muted-foreground"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
                <Flag className="size-4" />
              </span>
              End &ldquo;{active.name}&rdquo;
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              Running plans stop and no new work can be planned. The files on the campaign&apos;s computer are saved to your results, then
              the computer is shut down for good (with any logins on it).
            </AlertDialogDescription>
          </AlertDialogHeader>
          {endError && <p className="text-sm text-destructive">{endError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it running</AlertDialogCancel>
            <Button variant="destructive" disabled={ending} onClick={end}>
              {ending ? "Ending…" : "End campaign"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
