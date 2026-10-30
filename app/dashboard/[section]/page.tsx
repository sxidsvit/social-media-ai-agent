import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NAV_ITEMS } from "@/lib/dashboard-nav";
import { cn } from "@/lib/utils";

// Placeholder for sections that don't have their own page yet.
type Props = { params: Promise<{ section: string }> };

function findSection(slug: string) {
  return NAV_ITEMS.find((item) => item.slug && item.slug === slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = findSection((await params).section);
  return { title: item?.label ?? "Not found" };
}

export default async function SectionPage({ params }: Props) {
  const item = findSection((await params).section);
  if (!item) notFound();

  const { Icon } = item;
  return (
    <section className="relative flex min-h-[60svh] flex-col items-center justify-center overflow-hidden rounded-3xl bg-card px-6 py-16 text-center ring-1 ring-border/60">
      <div className="bg-dot-grid pointer-events-none absolute inset-0 text-muted-foreground opacity-50 mask-[radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <span className={cn("relative flex size-16 items-center justify-center rounded-2xl shadow-xl", item.solid, item.glow)}>
        <Icon className="size-7" />
      </span>
      <h2 className="relative mt-6 text-xl font-semibold tracking-tight">{item.label} is on its way</h2>
      <p className="relative mt-2 max-w-sm text-sm text-muted-foreground">{item.description}. This section is coming soon.</p>
    </section>
  );
}
