"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, LogOut, Menu, PanelLeft, Search, Settings } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { getActiveNav } from "@/lib/dashboard-nav";
import { cn } from "@/lib/utils";
import { useDashboardShell, type DashboardUser } from "@/components/dashboard/dashboard-shell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { CreatePostMenu } from "@/components/posts/create-post-menu";

export function DashboardHeader({ user }: { user: DashboardUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const { toggleSidebar, openMobile } = useDashboardShell();
  const page = getActiveNav(pathname);
  const [scrolled, setScrolled] = useState(false);

  // Lift the header off the page once content scrolls under it
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-20 px-4 pt-3 pb-3 transition-[background-color,box-shadow,backdrop-filter] duration-300 sm:px-6 md:pl-3",
        scrolled ? "bg-canvas/80 shadow-[0_1px_0_var(--border)] backdrop-blur-xl" : "bg-transparent"
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3">
        <Button
          variant="outline"
          size="icon-lg"
          className="rounded-xl bg-card md:hidden"
          onClick={openMobile}
          aria-label="Open navigation"
        >
          <Menu />
        </Button>
        <Button
          variant="ghost"
          size="icon-lg"
          className="hidden rounded-xl text-muted-foreground md:inline-flex"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
          title="Toggle sidebar (⌘B)"
        >
          <PanelLeft />
        </Button>

        {/* Keyed so the title re-animates on navigation */}
        <div key={page.slug} className="min-w-0 animate-in duration-300 fade-in-0 slide-in-from-left-1">
          <h1 className="truncate text-lg leading-tight font-semibold tracking-tight sm:text-xl">{page.label}</h1>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">{page.description}</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="group/search relative hidden h-10 w-64 items-center rounded-xl bg-card ring-1 ring-border/70 transition-all duration-300 focus-within:w-80 focus-within:ring-2 focus-within:ring-ring/40 lg:flex">
            <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
            <span className="sr-only">Search</span>
            <input
              type="search"
              placeholder="Search posts, campaigns…"
              className="h-full w-full bg-transparent pr-12 pl-9 text-sm outline-none placeholder:text-muted-foreground/80"
            />
            <Kbd className="pointer-events-none absolute right-2.5 transition-opacity group-focus-within/search:opacity-0">
              ⌘K
            </Kbd>
          </label>

          <Button
            variant="outline"
            size="icon-lg"
            className="size-10 rounded-xl bg-card text-muted-foreground lg:hidden"
            aria-label="Search"
          >
            <Search />
          </Button>

          <Button
            variant="outline"
            size="icon-lg"
            className="size-10 rounded-xl bg-card text-muted-foreground"
            aria-label="Notifications"
          >
            <Bell />
          </Button>

          <CreatePostMenu className="hidden sm:inline-flex" />

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Account menu"
              className="rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-canvas transition-shadow outline-none hover:ring-border focus-visible:ring-ring/50 data-popup-open:ring-primary/40"
            >
              <Avatar className="size-10">
                {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                <AvatarFallback className="bg-linear-to-br from-indigo-500 to-violet-600 text-sm font-semibold text-white">
                  {user.initials}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-60 rounded-2xl p-1.5 shadow-xl">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-2 py-2">
                  <span className="block truncate text-sm font-semibold text-foreground">{user.name}</span>
                  <span className="block truncate text-xs font-normal">{user.email}</span>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator className="my-1.5" />
              <DropdownMenuItem className="gap-2.5 rounded-xl p-2" onClick={() => router.push("/dashboard/settings")}>
                <Settings />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" className="gap-2.5 rounded-xl p-2" onClick={() => signOut()}>
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
