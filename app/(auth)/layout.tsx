import Image from "next/image";
import { CalendarClock, PenLine, TrendingUp } from "lucide-react";
import { Logo } from "@/components/brand/logo";

const FEATURES = [
  { Icon: PenLine, text: "On-brand posts written for every platform" },
  { Icon: CalendarClock, text: "Scheduled and published at the best time" },
  { Icon: TrendingUp, text: "Performance insights that keep improving" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-svh bg-background lg:h-svh lg:grid-cols-[1fr_1.05fr] lg:overflow-hidden">
      <section className="flex flex-col px-6 py-6 sm:px-10">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <p className="text-center text-xs text-muted-foreground lg:text-left">
          © {new Date().getFullYear()} Socialix. All rights reserved.
        </p>
      </section>

      <aside className="relative m-3 hidden flex-col justify-between overflow-hidden rounded-3xl bg-linear-to-br from-blue-600 via-blue-700 to-indigo-800 p-10 text-white lg:flex">
        <div className="bg-dot-grid pointer-events-none absolute inset-0 text-white opacity-60" />
        <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-sky-400/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-indigo-400/30 blur-3xl" />

        <div className="relative max-w-md space-y-4">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/20 backdrop-blur">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Your AI social team is ready
          </span>
          <h2 className="text-3xl leading-tight font-semibold tracking-tight xl:text-4xl">
            Grow your audience on autopilot with AI agents.
          </h2>
          <ul className="space-y-2.5 pt-1">
            {FEATURES.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-blue-50/90">
                <span className="flex size-7 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <Icon className="size-3.5" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mt-8 min-h-0 flex-1">
          <div className="absolute inset-x-0 bottom-0 top-4 overflow-hidden rounded-2xl shadow-2xl shadow-blue-950/40 ring-1 ring-white/20">
            <Image
              src="/offices/modern-office.png"
              alt="AI agent office"
              fill
              priority
              sizes="50vw"
              className="object-cover"
            />
            <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-xl bg-white/90 p-3 text-slate-900 shadow-lg backdrop-blur">
              <span className="flex size-9 items-center justify-center rounded-lg bg-blue-600 text-white">
                <TrendingUp className="size-4" />
              </span>
              <div className="min-w-0 text-sm">
                <p className="font-semibold">Agents are working</p>
                <p className="truncate text-xs text-slate-500">Drafting this week&apos;s content calendar…</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </main>
  );
}
