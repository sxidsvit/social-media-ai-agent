"use client";

/* eslint-disable @next/next/no-img-element -- artifact previews are remote ImageKit URLs of any size */
import { useEffect, useState } from "react";
import { Check, Copy, Database, ExternalLink, FileText, FolderOpen, Globe, ImageIcon, Lightbulb, Link2, TriangleAlert, Video, type LucideIcon } from "lucide-react";
import type { ArtifactType, ArtifactView, ContentDraftView, ResearchMethod, ResearchView } from "@/lib/orchestration/types";
import { platformName, postText } from "@/lib/social-platforms";
import { cn } from "@/lib/utils";

// What the agents made: image thumbnails and file/link cards, each opening its permanent URL, plus
// the Creator Agent's drafts (with their images) and the Research Agent's findings with sources.
// Files that only exist on an agent's computer show their path instead.

const TYPE_ICONS: Record<ArtifactType, LucideIcon> = {
  image: ImageIcon,
  video: Video,
  document: FileText,
  data: Database,
  link: Link2,
};

// ImageKit serves resized copies; other URLs are shown as they are
export function thumbnail(url: string, width: number) {
  if (!url.includes("ik.imagekit.io") && !url.includes("imagekit")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}tr=w-${width}`;
}

export function ArtifactGrid({ artifacts, total, compact = false, className }: { artifacts: ArtifactView[]; total?: number; compact?: boolean; className?: string }) {
  if (artifacts.length === 0) return null;
  const images = artifacts.filter((artifact) => artifact.type === "image" && artifact.url);
  const files = artifacts.filter((artifact) => !images.includes(artifact));
  const more = (total ?? artifacts.length) - artifacts.length;

  return (
    <div className={cn("space-y-2", className)}>
      {images.length > 0 && (
        <ul className={cn("grid gap-1.5", compact ? "grid-cols-4" : "grid-cols-3 sm:grid-cols-4")}>
          {images.map((artifact) => (
            <li key={artifact.id}>
              <a
                href={artifact.url!}
                target="_blank"
                rel="noreferrer"
                title={artifact.name}
                className="group/thumb relative block aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-border/60"
              >
                <img
                  src={thumbnail(artifact.url!, compact ? 160 : 320)}
                  alt={artifact.name}
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-300 group-hover/thumb:scale-105"
                />
              </a>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((artifact) => {
            const Icon = artifact.url ? TYPE_ICONS[artifact.type] : FolderOpen;
            const body = (
              <>
                <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{artifact.name}</span>
                {artifact.url ? (
                  <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <span className="shrink-0 truncate font-mono text-[10px] text-muted-foreground">{artifact.sandboxPath}</span>
                )}
              </>
            );
            const className = "flex items-center gap-2 rounded-lg bg-muted/60 px-2 py-1.5 text-xs";
            return (
              <li key={artifact.id}>
                {artifact.url ? (
                  <a href={artifact.url} target="_blank" rel="noreferrer" className={cn(className, "transition-colors hover:bg-muted")}>
                    {body}
                  </a>
                ) : (
                  <div className={className} title="Saved on the agent's computer">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {more > 0 && <p className="text-[11px] text-muted-foreground">+{more} more in the Tasks tab</p>}
    </div>
  );
}

// The Creator Agent's drafts: the post as it would go out, with its images
export function DraftList({ drafts }: { drafts: ContentDraftView[] }) {
  if (drafts.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {drafts.map((draft) => (
        <li key={draft.id}>
          <DraftCard draft={draft} />
        </li>
      ))}
    </ul>
  );
}

const KIND_LABELS: Record<ContentDraftView["kind"], string> = {
  post: "Post",
  caption: "Caption",
  thread: "Thread",
  script: "Script",
  carousel: "Carousel",
  hashtags: "Hashtags",
  idea: "Idea",
};

function DraftCard({ draft }: { draft: ContentDraftView }) {
  const images = draft.media.filter((item) => !item.mimeType?.startsWith("video/"));
  const videos = draft.media.filter((item) => item.mimeType?.startsWith("video/"));
  const Icon = draft.kind === "idea" ? Lightbulb : FileText;
  return (
    <article className="rounded-xl bg-card p-2.5 ring-1 ring-border/60">
      <header className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{draft.title}</span>
          <span className="block text-[11px] text-muted-foreground">
            {platformName(draft.platform)} · {KIND_LABELS[draft.kind]} · Draft #{draft.id}
          </span>
        </span>
        <CopyButton text={postText(draft)} label="Copy post" />
      </header>

      {images.length > 0 && (
        <ul className={cn("mt-2 grid gap-1.5", images.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
          {images.map((item) => (
            <li key={item.url}>
              <a href={item.url} target="_blank" rel="noreferrer" title={item.name} className="block overflow-hidden rounded-lg bg-muted ring-1 ring-border/60">
                <img
                  src={thumbnail(item.url, images.length === 1 ? 720 : 400)}
                  alt={item.name}
                  loading="lazy"
                  className={cn("w-full object-contain", images.length === 1 ? "max-h-96" : "aspect-square object-cover")}
                />
              </a>
            </li>
          ))}
        </ul>
      )}
      {videos.map((item) => (
        <video key={item.url} src={item.url} controls preload="metadata" className="mt-2 max-h-96 w-full rounded-lg bg-black" />
      ))}

      <div className="mt-2 space-y-1.5 text-xs leading-relaxed">
        {draft.hook && <p className="font-medium whitespace-pre-wrap">{draft.hook}</p>}
        <p className="whitespace-pre-wrap break-words">{draft.body}</p>
        {draft.cta && <p className="whitespace-pre-wrap text-muted-foreground">{draft.cta}</p>}
        {draft.hashtags.length > 0 && <p className="break-words text-primary">{draft.hashtags.join(" ")}</p>}
        {draft.notes && <p className="text-[11px] whitespace-pre-wrap text-muted-foreground">Note: {draft.notes}</p>}
        {draft.warnings.length > 0 && (
          <p className="flex gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
            {draft.warnings.join(" ")}
          </p>
        )}
      </div>
    </article>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined)}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}

const METHOD_LABELS: Record<ResearchMethod, string> = { knowledge: "From knowledge", live: "Checked live", mixed: "Knowledge + live" };

// The Research Agent's saved findings, each citing its numbered sources
export function ResearchList({ research }: { research: ResearchView[] }) {
  if (research.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {research.map((item) => (
        <li key={item.id} className="rounded-xl bg-card p-2.5 text-xs leading-relaxed ring-1 ring-border/60">
          <header className="flex items-start gap-2">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">{item.topic}</span>
              <span className="block text-[11px] text-muted-foreground">
                {METHOD_LABELS[item.method]}
                {item.platforms.length > 0 && ` · ${item.platforms.map(platformName).join(", ")}`} · Research #{item.id}
              </span>
            </span>
          </header>
          <p className="mt-1.5 whitespace-pre-wrap">{item.summary}</p>

          <ul className="mt-2 space-y-1">
            {item.findings.map((finding, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-muted-foreground">•</span>
                <span className="min-w-0">
                  <span className="font-medium">{finding.insight}</span>
                  {finding.sources.length > 0 && <sup className="ml-0.5 text-[10px] text-muted-foreground">[{finding.sources.join(", ")}]</sup>}
                  {finding.details && <span className="block whitespace-pre-wrap text-muted-foreground">{finding.details}</span>}
                </span>
              </li>
            ))}
          </ul>
          {item.hashtags.length > 0 && <p className="mt-2 break-words text-primary">{item.hashtags.join(" ")}</p>}

          {item.sources.length > 0 && (
            <ol className="mt-2 space-y-0.5 border-t border-border/60 pt-2 text-[11px]">
              {item.sources.map((source, i) => (
                <li key={i} className="flex items-baseline gap-1.5">
                  <span className="w-4 shrink-0 text-right text-muted-foreground">{i + 1}.</span>
                  <span className="min-w-0 flex-1">
                    {source.url ? (
                      <a href={source.url} target="_blank" rel="noreferrer" className="break-words underline-offset-2 hover:underline">
                        {source.title}
                      </a>
                    ) : (
                      source.title
                    )}
                    {source.note && <span className="text-muted-foreground"> — {source.note}</span>}
                  </span>
                  {source.visited && (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-emerald-700 dark:text-emerald-300" title="Opened in the agent's browser during this task">
                      <Globe className="size-3" aria-hidden />
                      live
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ul>
  );
}

// "4m 12s", "1h 05m", "2d 3h"
export function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// The current time, ticking every second while `active`
export function useNow(active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
