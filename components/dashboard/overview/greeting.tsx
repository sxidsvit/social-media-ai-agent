"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun, Sunrise, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Period = { text: string; Icon: LucideIcon; tone: string };

const PERIODS: Record<"morning" | "afternoon" | "evening", Period> = {
  morning: { text: "Good morning", Icon: Sunrise, tone: "text-amber-500" },
  afternoon: { text: "Good afternoon", Icon: Sun, tone: "text-orange-500" },
  evening: { text: "Good evening", Icon: Moon, tone: "text-indigo-400" },
};

const subscribe = () => () => {};

// Greeting follows the viewer's local clock; the server renders a neutral fallback.
export function Greeting({ name }: { name?: string }) {
  const hour = useSyncExternalStore(subscribe, () => new Date().getHours(), () => null);
  const period =
    hour === null ? null : hour < 12 ? PERIODS.morning : hour < 18 ? PERIODS.afternoon : PERIODS.evening;
  const Icon = period?.Icon ?? Sun;

  return (
    <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <Icon className={cn("size-4 transition-colors", period?.tone ?? "text-amber-500")} />
      <span>
        {period?.text ?? "Welcome back"}
        {name && (
          <>
            , <span className="font-semibold text-foreground">{name}</span>
          </>
        )}{" "}
        <span aria-hidden>👋</span>
      </span>
    </p>
  );
}
