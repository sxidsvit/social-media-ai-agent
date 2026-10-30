import {
  BarChart3,
  Bot,
  CalendarDays,
  LayoutGrid,
  Link2,
  Newspaper,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  // Route segment under /dashboard ("" is the overview)
  slug: string;
  label: string;
  description: string;
  Icon: LucideIcon;
  // Soft tile shown when idle, solid gradient tile when active
  tint: string;
  solid: string;
  // Coloured glow under the active tile
  glow: string;
};

export const NAV_ITEMS: NavItem[] = [
  {
    slug: "",
    label: "Overview",
    description: "A snapshot of your campaign at a glance",
    Icon: LayoutGrid,
    tint: "bg-blue-500/10 text-blue-600 dark:text-blue-300",
    solid: "bg-linear-to-br from-blue-500 to-indigo-600 text-white",
    glow: "shadow-blue-500/40",
  },
  {
    slug: "ai-agent",
    label: "AI Agent",
    description: "Brief your AI team and review what they're working on",
    Icon: Bot,
    tint: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
    solid: "bg-linear-to-br from-violet-500 to-fuchsia-600 text-white",
    glow: "shadow-violet-500/40",
  },
  {
    slug: "posts",
    label: "Posts",
    description: "Drafts, scheduled and published content",
    Icon: Newspaper,
    tint: "bg-pink-500/10 text-pink-600 dark:text-pink-300",
    solid: "bg-linear-to-br from-pink-500 to-rose-600 text-white",
    glow: "shadow-pink-500/40",
  },
  {
    slug: "calendar",
    label: "Calendar",
    description: "Plan when your content goes live",
    Icon: CalendarDays,
    tint: "bg-orange-500/10 text-orange-600 dark:text-orange-300",
    solid: "bg-linear-to-br from-amber-400 to-orange-500 text-white",
    glow: "shadow-orange-500/40",
  },
  {
    slug: "analytics",
    label: "Analytics",
    description: "Reach, engagement and growth across channels",
    Icon: BarChart3,
    tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    solid: "bg-linear-to-br from-emerald-400 to-teal-600 text-white",
    glow: "shadow-emerald-500/40",
  },
  {
    slug: "accounts",
    label: "Accounts",
    description: "Connect and manage your social channels",
    Icon: Link2,
    tint: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
    solid: "bg-linear-to-br from-sky-400 to-cyan-600 text-white",
    glow: "shadow-sky-500/40",
  },
  {
    slug: "settings",
    label: "Settings",
    description: "Campaign, team and workspace preferences",
    Icon: Settings,
    tint: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
    solid: "bg-linear-to-br from-slate-500 to-slate-700 text-white",
    glow: "shadow-slate-500/40",
  },
];

export function navHref(slug: string) {
  return slug ? `/dashboard/${slug}` : "/dashboard";
}

// Nav item matching the current pathname (falls back to Overview).
export function getActiveNav(pathname: string) {
  const slug = pathname.replace(/^\/dashboard\/?/, "").split("/")[0] ?? "";
  return NAV_ITEMS.find((item) => item.slug === slug) ?? NAV_ITEMS[0];
}

export const SIDEBAR_COOKIE = "sidebar_expanded";
