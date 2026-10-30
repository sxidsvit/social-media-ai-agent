import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Floating card used by every overview section — matches the sidebar panel's elevation.
export function OverviewPanel({
  title,
  action,
  className,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-3xl bg-card p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_32px_-16px_rgb(15_23_42/0.12)] ring-1 ring-border/60 sm:p-6",
        className
      )}
    >
      {title && (
        <header className="mb-1 flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold tracking-tight">{title}</h3>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

// Illustrated empty state: a tilted gradient tile with little burst marks around it.
export function OverviewEmptyState({
  Icon,
  tone,
  glow,
  title,
  description,
  children,
}: {
  Icon: LucideIcon;
  // Gradient + foreground classes for the tile, and a coloured shadow under it
  tone: string;
  glow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-6 text-center">
      <div className="relative mb-5 flex size-20 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-muted/70" />
        {BURSTS.map((burst) => (
          <span key={burst} aria-hidden className={cn("absolute h-0.5 w-2.5 rounded-full bg-amber-400", burst)} />
        ))}
        <span
          className={cn(
            "relative flex size-12 -rotate-6 items-center justify-center rounded-2xl shadow-lg ring-4 ring-card transition-transform duration-500 hover:rotate-0",
            tone,
            glow
          )}
        >
          <Icon className="size-6" />
        </span>
      </div>
      <p className="font-semibold tracking-tight">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{description}</p>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

const BURSTS = [
  "top-2 -left-1 rotate-30",
  "top-1/2 -left-3 -translate-y-1/2",
  "top-2 -right-1 -rotate-30",
  "top-1/2 -right-3 -translate-y-1/2",
  "bottom-2 -left-1 -rotate-30 opacity-60",
  "bottom-2 -right-1 rotate-30 opacity-60",
];
