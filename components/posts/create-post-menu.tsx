"use client";

import { useRouter } from "next/navigation";
import { Bot, ChevronDown, PenLine, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// "Create post": write one by hand in the post editor, or brief the AI team on the AI Agent page
export function CreatePostMenu({ className, align = "end" }: { className?: string; align?: "start" | "end" }) {
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="lg"
            className={cn(
              "h-10 rounded-xl px-4 shadow-lg shadow-primary/25 transition-[translate,box-shadow] hover:-translate-y-px hover:shadow-primary/35",
              className
            )}
          />
        }
      >
        <Plus data-icon="inline-start" />
        Create post
        <ChevronDown data-icon="inline-end" className="opacity-70 transition-transform group-aria-expanded/button:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} sideOffset={8} className="w-72 rounded-2xl p-1.5 shadow-xl">
        <MenuOption
          Icon={PenLine}
          tone="bg-linear-to-br from-pink-500 to-rose-600 shadow-pink-500/30"
          title="Create manually"
          description="Write it, add images and schedule it yourself"
          onClick={() => router.push("/dashboard/posts/create")}
        />
        <MenuOption
          Icon={Bot}
          tone="bg-linear-to-br from-violet-500 to-fuchsia-600 shadow-violet-500/30"
          title="Create using AI Agent"
          description="Brief your AI team and let them draft it"
          onClick={() => router.push("/dashboard/ai-agent")}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuOption({
  Icon,
  tone,
  title,
  description,
  onClick,
}: {
  Icon: typeof Bot;
  tone: string;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <DropdownMenuItem onClick={onClick} className="group/option items-start gap-3 rounded-xl p-2.5">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-md transition-transform duration-300 group-hover/option:scale-105", tone)}>
        <Icon className="size-4.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="block text-xs whitespace-normal text-muted-foreground">{description}</span>
      </span>
    </DropdownMenuItem>
  );
}
