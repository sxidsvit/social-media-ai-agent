"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { Campaign } from "@/db/schema";
import { SIDEBAR_COOKIE } from "@/lib/dashboard-nav";
import { cn } from "@/lib/utils";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";

export type CampaignOption = Pick<Campaign, "id" | "name" | "icon" | "iconUrl"> & { ended: boolean };
export type DashboardUser = { name: string; email: string; initials: string; avatarUrl?: string };

type ShellContext = {
  expanded: boolean;
  toggleSidebar: () => void;
  openMobile: () => void;
};

const ShellContext = createContext<ShellContext | null>(null);

export function useDashboardShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useDashboardShell must be used inside <DashboardShell>");
  return ctx;
}

type Props = {
  campaigns: CampaignOption[];
  activeCampaignId: number;
  user: DashboardUser;
  defaultExpanded: boolean;
  children: React.ReactNode;
};

export function DashboardShell({ campaigns, activeCampaignId, user, defaultExpanded, children }: Props) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleSidebar = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      document.cookie = `${SIDEBAR_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}`;
      return next;
    });
  }, []);

  // ⌘B / Ctrl+B toggles the sidebar
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (window.matchMedia("(min-width: 768px)").matches) toggleSidebar();
        else setMobileOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

  const sidebarProps = { campaigns, activeCampaignId, pathname };

  return (
    <ShellContext.Provider value={{ expanded, toggleSidebar, openMobile: () => setMobileOpen(true) }}>
      <TooltipProvider delay={150}>
        <div className="flex min-h-svh bg-canvas">
          {/* Desktop: floating panel that animates between icon rail and full width */}
          <aside
            data-expanded={expanded}
            className={cn(
              "sticky top-0 z-30 hidden h-svh shrink-0 p-3 transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] md:block",
              expanded ? "w-66" : "w-22"
            )}
          >
            <AppSidebar {...sidebarProps} expanded={expanded} onToggle={toggleSidebar} />
          </aside>

          {/* Mobile: same panel in a drawer, always expanded */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="w-72 border-0 bg-transparent p-3 shadow-none data-[side=left]:w-72 md:hidden"
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <AppSidebar {...sidebarProps} expanded onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 flex-1 flex-col">
            <DashboardHeader user={user} />
            <main className="flex-1 px-4 pb-10 sm:px-6 md:pl-3">
              <div className="mx-auto w-full max-w-7xl">{children}</div>
            </main>
          </div>
        </div>
      </TooltipProvider>
    </ShellContext.Provider>
  );
}
