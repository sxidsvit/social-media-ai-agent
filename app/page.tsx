import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarClock, PenLine, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FEATURES: { title: string; description: string; Icon: LucideIcon }[] = [
  {
    title: "Write on-brand posts",
    description: "Agents draft captions, threads and carousels tuned for every platform.",
    Icon: PenLine,
  },
  {
    title: "Schedule automatically",
    description: "Content goes out at the moments your audience is most active.",
    Icon: CalendarClock,
  },
  {
    title: "Learn and improve",
    description: "Every post feeds back into smarter, better-performing content.",
    Icon: TrendingUp,
  },
];

export default function Home() {
  return (
    <div className="relative min-h-svh overflow-hidden bg-slate-50 dark:bg-background">
      <div className="pointer-events-none absolute -top-48 left-1/2 size-192 -translate-x-1/2 rounded-full bg-blue-400/20 blur-3xl" />
      <div className="bg-dot-grid pointer-events-none absolute inset-x-0 top-0 h-144 text-slate-400 opacity-40 mask-[linear-gradient(to_bottom,black,transparent)]" />

      <header className="relative mx-auto flex h-18 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/sign-in" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-10 px-4")}>
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className={cn(buttonVariants({ size: "lg" }), "h-10 px-4 shadow-md shadow-primary/20")}
          >
            Get started
          </Link>
        </nav>
      </header>

      <main className="relative mx-auto max-w-6xl px-4 pt-14 pb-20 sm:px-6 sm:pt-20">
        <section className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs">
            <Sparkles className="size-3.5 text-primary" />
            Your AI social media team
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Social media that runs{" "}
            <span className="bg-linear-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              on autopilot
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
            Launch a campaign, pick an office for your AI agents, and let them plan, write and publish your content.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className={cn(buttonVariants({ size: "lg" }), "h-12 px-6 text-base shadow-lg shadow-primary/25")}
            >
              Create your campaign
              <ArrowRight data-icon="inline-end" />
            </Link>
            <Link
              href="/sign-in"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12 px-6 text-base")}
            >
              I already have an account
            </Link>
          </div>
        </section>

        <section className="relative mx-auto mt-16 max-w-5xl">
          <div className="rounded-[28px] border bg-background/60 p-2 shadow-2xl shadow-blue-900/10 backdrop-blur">
            <div className="relative aspect-video overflow-hidden rounded-[22px]">
              <Image
                src="/offices/modern-office.png"
                alt="AI agent office"
                fill
                priority
                sizes="(min-width: 1024px) 1024px, 100vw"
                className="object-cover"
              />
            </div>
          </div>
          <div className="absolute top-10 -left-4 hidden items-center gap-3 rounded-2xl border bg-background p-3 pr-5 shadow-xl md:flex">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <PenLine className="size-5" />
            </span>
            <div className="text-sm">
              <p className="font-semibold">12 posts drafted</p>
              <p className="text-xs text-muted-foreground">by your Writer agent</p>
            </div>
          </div>
          <div className="absolute -right-4 bottom-12 hidden items-center gap-3 rounded-2xl border bg-background p-3 pr-5 shadow-xl md:flex">
            <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500 text-white">
              <TrendingUp className="size-5" />
            </span>
            <div className="text-sm">
              <p className="font-semibold">Engagement rising</p>
              <p className="text-xs text-muted-foreground">Insights updated daily</p>
            </div>
          </div>
        </section>

        <section className="mt-20 grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ title, description, Icon }) => (
            <div key={title} className="rounded-2xl border bg-card p-6 shadow-xs transition-shadow hover:shadow-md">
              <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="relative border-t py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Socialix. All rights reserved.
      </footer>
    </div>
  );
}
