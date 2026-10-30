import Link from "next/link";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = { className?: string; wordmarkClassName?: string; href?: string };

export function Logo({ className, wordmarkClassName, href = "/" }: Props) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-600/25">
        <Sparkles className="size-4" />
      </span>
      <span className={cn("text-[17px]", wordmarkClassName)}>Socialix</span>
    </Link>
  );
}
