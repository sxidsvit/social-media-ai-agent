"use client";

import { useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { POST_PLATFORMS, type PostPlatform } from "@/lib/posts/shared";
import { platformName } from "@/lib/social-platforms";
import { cn } from "@/lib/utils";
import { PlatformTile } from "@/components/posts/platform-icon";

// Pieces shared by the Analytics page's charts

export const PANEL = "rounded-3xl bg-card shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_32px_-16px_rgb(15_23_42/0.12)] ring-1 ring-border/60";

// A chart in a card, with a switch to see the same numbers as a table
export function ChartCard({
  title,
  subtitle,
  controls,
  table,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  controls?: React.ReactNode;
  table: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section className={cn(PANEL, "flex min-w-0 flex-col p-5 sm:p-6", className)}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {controls}
          <div className="inline-flex rounded-xl bg-muted/60 p-0.5" role="group" aria-label={`${title}: chart or table`}>
            {(
              [
                { id: "chart", label: "Chart", Icon: BarChart3 },
                { id: "table", label: "Table", Icon: Table2 },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={view === id}
                title={`Show as ${label.toLowerCase()}`}
                onClick={() => setView(id)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-[10px] transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  view === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-3.5" />
                <span className="sr-only">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">{view === "chart" ? children : <div className="max-h-80 overflow-auto rounded-xl ring-1 ring-border/60">{table}</div>}</div>
    </section>
  );
}

// A small segmented switch (metric pickers)
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-muted/60 p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "rounded-[10px] px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            value === option.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// A plain table for a chart's numbers
export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-left text-xs">
      <thead className="sticky top-0 bg-card text-muted-foreground">
        <tr>
          {head.map((cell, index) => (
            <th key={cell} scope="col" className={cn("px-3 py-2 font-medium", index > 0 && "text-right")}>
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border/60">
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, index) => (
              <td key={index} className={cn("px-3 py-1.5", index > 0 ? "text-right tabular-nums" : "font-medium")}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// A platform's colour key and name, for legends
export function PlatformKey({ platform, color, children }: { platform: string; color: string; children?: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground">{platformName(platform)}</span>
      {children}
    </span>
  );
}

export function PlatformMark({ platform, color, className }: { platform: string; color: string; className?: string }) {
  if ((POST_PLATFORMS as readonly string[]).includes(platform)) return <PlatformTile platform={platform as PostPlatform} className={className} />;
  return (
    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] font-semibold uppercase", className)} title={platformName(platform)}>
      <span className="sr-only">{platformName(platform)}</span>
      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}

// Shown over a chart with nothing to plot
export function ChartEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
