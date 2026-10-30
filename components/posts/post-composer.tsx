"use client";

/* eslint-disable @next/next/no-img-element -- post images are remote ImageKit URLs of any size */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  CalendarDays,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  Hash,
  ImagePlus,
  Link2,
  Pencil,
  Sparkles,
  Star,
  TriangleAlert,
  Upload,
  Video,
  Wand2,
  X,
} from "lucide-react";
import { savePost } from "@/app/dashboard/posts/actions";
import { accountLabel, type BlotatoAccount } from "@/lib/blotato/shared";
import { ASPECTS, imageKitThumbnail, type Aspect } from "@/lib/imagekit/transformations";
import {
  checkPost,
  IMAGE_TYPES,
  isVideo,
  listTimeZones,
  MAX_MEDIA,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_BYTES,
  postCaption,
  parseHashtags,
  UPLOAD_TYPES,
  VIDEO_TYPES,
  zonedTimeToUtc,
  type PostInput,
  type PostMedia,
  type PostPlatform,
} from "@/lib/posts/shared";
import { PLATFORM_RULES } from "@/lib/social-platforms";
import { cn } from "@/lib/utils";
import { ImageEditorDialog } from "@/components/posts/image-editor-dialog";
import { PLATFORM_STYLES, PlatformIcon } from "@/components/posts/platform-icon";
import { PlatformPreview } from "@/components/posts/platform-preview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// The post editor: details, platforms, images (upload, ImageKit AI generation and the Edit Image
// dialog) and the schedule on the left; a live preview for each chosen platform on the right.

export type ComposerInitial = {
  draftId: number | null;
  // Editing an existing post: its id, and when it's scheduled (wall-clock date and time in its zone)
  postId?: number;
  schedule?: { date: string; time: string; timeZone: string } | null;
  title: string;
  caption: string;
  hashtags: string[];
  platforms: PostPlatform[];
  media: PostMedia[];
  accountIds?: Partial<Record<PostPlatform, string>>;
};

// The platforms the user connected in Blotato, with their accounts: only these can be picked
export type ComposerPublishing = {
  platforms: PostPlatform[];
  accounts: Partial<Record<PostPlatform, BlotatoAccount[]>>;
};

type Props = {
  initial: ComposerInitial;
  account: string;
  initials: string;
  // Generation and edits need ImageKit; without it only uploads work
  imageKit: boolean;
  publishing: ComposerPublishing;
};

const PLATFORM_HINTS: Record<PostPlatform, string> = {
  instagram: "Post, carousel or reel",
  tiktok: "Video or photo post",
  youtube: "Videos & Shorts only",
};

// A sensible default slot: the next full hour, at least an hour from now
function defaultSlot() {
  const at = new Date(Date.now() + 60 * 60 * 1000);
  at.setMinutes(0, 0, 0);
  at.setHours(at.getHours() + 1);
  return { date: at, time: format(at, "HH:mm") };
}

function relative(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  return `in ${Math.round(hours / 24)} days`;
}

export function PostComposer({ initial, account, initials, imageKit, publishing }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [caption, setCaption] = useState(initial.caption);
  const [hashtags, setHashtags] = useState<string[]>(initial.hashtags);
  const [tagDraft, setTagDraft] = useState("");
  // A platform disconnected since the post was written is dropped
  const [platforms, setPlatforms] = useState<PostPlatform[]>(() => initial.platforms.filter((platform) => publishing.platforms.includes(platform)));
  const [accountIds, setAccountIds] = useState<Partial<Record<PostPlatform, string>>>(initial.accountIds ?? {});
  const [media, setMedia] = useState<PostMedia[]>(initial.media);
  const [previewPlatform, setPreviewPlatform] = useState<PostPlatform>(platforms[0] ?? publishing.platforms[0] ?? "instagram");
  const [editing, setEditing] = useState<number | null>(null);

  const [slot] = useState(() => {
    if (!initial.schedule) return defaultSlot();
    const [year, month, day] = initial.schedule.date.split("-").map(Number);
    return { date: new Date(year, month - 1, day), time: initial.schedule.time };
  });
  const [date, setDate] = useState<Date | undefined>(slot.date);
  const [time, setTime] = useState(slot.time);
  const [timeZone, setTimeZone] = useState(initial.schedule?.timeZone ?? "UTC");
  const [zones, setZones] = useState<{ value: string; label: string }[]>([]);
  const [dateOpen, setDateOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [intent, setIntent] = useState<"schedule" | "draft">("schedule");
  const [now, setNow] = useState(() => Date.now());

  // Time zones come from the browser, so they're read after mount (the server's list may differ)
  useEffect(() => {
    setZones(listTimeZones());
    // A post being edited keeps the zone it was scheduled in
    if (!initial.schedule) setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [initial.schedule]);

  const allTags = useMemo(() => (tagDraft.trim() ? parseHashtags([...hashtags, tagDraft].join(" ")) : hashtags), [hashtags, tagDraft]);
  const check = checkPost({ title, caption, hashtags: allTags, platforms, media });
  const scheduledAt = date && time ? zonedTimeToUtc(format(date, "yyyy-MM-dd"), time, timeZone) : null;
  const scheduleError = !scheduledAt ? "Pick a date and time." : scheduledAt.getTime() < now + 60_000 ? "Pick a time at least a minute from now." : null;
  const shownPreview = platforms.includes(previewPlatform) ? previewPlatform : (platforms[0] ?? previewPlatform);

  // The tightest caption limit among the chosen platforms
  const captionLimit = platforms
    .map((platform) => PLATFORM_RULES[platform].maxChars ?? Infinity)
    .reduce((min, limit) => Math.min(min, limit), Infinity);
  const captionLength = postCaption({ caption, hashtags: allTags }).length;

  function togglePlatform(platform: PostPlatform) {
    if (platforms.includes(platform)) {
      setPlatforms(platforms.filter((p) => p !== platform));
    } else {
      setPlatforms(publishing.platforms.filter((p) => p === platform || platforms.includes(p)));
      setPreviewPlatform(platform);
    }
  }

  function commitTags() {
    if (!tagDraft.trim()) return;
    setHashtags(parseHashtags([...hashtags, tagDraft].join(" ")));
    setTagDraft("");
  }

  function submit(next: "schedule" | "draft") {
    setError(null);
    setIntent(next);
    const input: PostInput = {
      title: title.trim(),
      caption,
      hashtags: allTags,
      platforms,
      media,
      draftId: initial.draftId,
      postId: initial.postId ?? null,
      date: date ? format(date, "yyyy-MM-dd") : null,
      time: time || null,
      timeZone,
      accountIds: Object.fromEntries(platforms.flatMap((platform) => (accountIds[platform] ? [[platform, accountIds[platform]]] : []))),
    };
    startSaving(async () => {
      const result = await savePost(input, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/dashboard/posts");
      router.refresh();
    });
  }

  const canSchedule = !!title.trim() && platforms.length > 0 && check.errors.length === 0 && !scheduleError;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="lg" className="-ml-2 rounded-xl text-muted-foreground" nativeButton={false} render={<Link href="/dashboard/posts" />}>
          <ArrowLeft data-icon="inline-start" />
          All posts
        </Button>
        {initial.postId !== undefined ? (
          <span className="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
            <Pencil className="size-3.5" />
            {initial.schedule ? "Editing scheduled post" : "Editing draft"}
          </span>
        ) : initial.draftId !== null && (
          <span className="flex items-center gap-1.5 rounded-full bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-700 dark:text-violet-300">
            <Sparkles className="size-3.5" />
            From AI draft #{initial.draftId}
          </span>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="min-w-0 space-y-5">
          <Panel step={1} title="Post details" description="What your audience will read">
            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="post-title" className="font-semibold">Title</FieldLabel>
                <Counter value={title.length} max={platforms.includes("youtube") ? PLATFORM_RULES.youtube.maxTitle! : 200} />
              </div>
              <Input
                id="post-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder="e.g. Our summer collection is here"
                className="h-11 rounded-xl px-3.5"
              />
              <p className="text-xs text-muted-foreground">Used as the YouTube title and to find the post in your library.</p>
            </Field>

            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="post-caption" className="font-semibold">Caption</FieldLabel>
                {Number.isFinite(captionLimit) && <Counter value={captionLength} max={captionLimit} />}
              </div>
              <Textarea
                id="post-caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={6}
                maxLength={5000}
                placeholder="Hook them in the first line, then tell the story…"
                className="min-h-36 rounded-xl px-3.5 py-3 leading-relaxed"
              />
            </Field>

            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="post-tags" className="font-semibold">Hashtags</FieldLabel>
                <span className="text-xs text-muted-foreground tabular-nums">{allTags.length} tags</span>
              </div>
              <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-input px-2 py-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
                {hashtags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1 rounded-lg bg-primary/10 py-0.5 pr-1 pl-2 text-xs font-medium text-primary animate-in zoom-in-95">
                    {tag}
                    <button type="button" aria-label={`Remove ${tag}`} onClick={() => setHashtags(hashtags.filter((t) => t !== tag))} className="rounded p-0.5 hover:bg-primary/15">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <span className="flex min-w-32 flex-1 items-center gap-1">
                  {hashtags.length === 0 && <Hash className="size-4 text-muted-foreground" />}
                  <input
                    id="post-tags"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "," || e.key === " ") {
                        e.preventDefault();
                        commitTags();
                      } else if (e.key === "Backspace" && !tagDraft && hashtags.length) {
                        setHashtags(hashtags.slice(0, -1));
                      }
                    }}
                    onBlur={commitTags}
                    onPaste={(e) => {
                      e.preventDefault();
                      setHashtags(parseHashtags([...hashtags, tagDraft, e.clipboardData.getData("text")].join(" ")));
                      setTagDraft("");
                    }}
                    placeholder={hashtags.length ? "Add more…" : "summer, newdrop, style"}
                    className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Press Enter, space or comma to add. 3–5 relevant tags usually work best.</p>
            </Field>
          </Panel>

          <Panel step={2} title="Platforms" description="Your accounts connected through Blotato">
            {publishing.platforms.length === 0 && (
              <div className="flex flex-col items-start gap-3 rounded-2xl bg-sky-500/5 p-4 text-sm ring-1 ring-sky-500/25 sm:flex-row sm:items-center">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600">
                  <Link2 className="size-4.5" />
                </span>
                <span className="flex-1 text-muted-foreground">
                  No Instagram, TikTok or YouTube accounts are connected yet. Connect Blotato to schedule posts. You can still save this as a draft.
                </span>
                <Button size="sm" className="rounded-lg" nativeButton={false} render={<Link href="/dashboard/settings/integrations" />}>
                  Connect accounts
                </Button>
              </div>
            )}
            <div role="group" aria-label="Platforms" className="grid gap-3 sm:grid-cols-3">
              {publishing.platforms.map((platform) => {
                const selected = platforms.includes(platform);
                const style = PLATFORM_STYLES[platform];
                return (
                  <button
                    key={platform}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => togglePlatform(platform)}
                    className={cn(
                      "group/platform relative flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition-all outline-none hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50",
                      selected ? "border-primary bg-accent/60 shadow-md shadow-primary/10" : "border-border bg-background hover:border-primary/40"
                    )}
                  >
                    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl shadow-md transition-transform group-hover/platform:scale-105", style.tile)}>
                      <PlatformIcon platform={platform} className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{style.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{PLATFORM_HINTS[platform]}</span>
                    </span>
                    <span
                      className={cn(
                        "absolute top-2 right-2 flex size-5 items-center justify-center rounded-full transition-all",
                        selected ? "scale-100 bg-primary text-primary-foreground" : "scale-75 bg-muted opacity-0"
                      )}
                    >
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  </button>
                );
              })}
            </div>
            {platforms.some((platform) => (publishing.accounts[platform]?.length ?? 0) > 1) && (
              <div className="grid gap-3 sm:grid-cols-3">
                {platforms
                  .filter((platform) => (publishing.accounts[platform]?.length ?? 0) > 1)
                  .map((platform) => (
                    <Field key={platform}>
                      <FieldLabel htmlFor={`account-${platform}`} className="text-xs font-semibold">
                        {PLATFORM_STYLES[platform].name} account
                      </FieldLabel>
                      <NativeSelect
                        id={`account-${platform}`}
                        value={accountIds[platform] ?? publishing.accounts[platform]![0].id}
                        onChange={(e) => setAccountIds((current) => ({ ...current, [platform]: e.target.value }))}
                        className="w-full [&_select]:h-10 [&_select]:rounded-xl"
                      >
                        {publishing.accounts[platform]!.map((item) => (
                          <NativeSelectOption key={item.id} value={item.id}>
                            {item.name}
                            {item.username ? ` (${accountLabel(item)})` : ""}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                  ))}
              </div>
            )}
          </Panel>

          <Panel step={3} title="Media" description={`Up to ${MAX_MEDIA} images and one video. The first one is the cover; YouTube needs the video.`}>
            <MediaManager media={media} setMedia={setMedia} imageKit={imageKit} onEdit={setEditing} />
          </Panel>

          <Panel step={4} title="Schedule" description="When it goes live, in the time zone you pick">
            <div className="grid gap-3 sm:grid-cols-[1.2fr_0.8fr_1.4fr]">
              <Field>
                <FieldLabel className="font-semibold">Date</FieldLabel>
                <Popover open={dateOpen} onOpenChange={setDateOpen}>
                  <PopoverTrigger
                    render={
                      <Button variant="outline" className={cn("h-11 w-full justify-start rounded-xl px-3.5 font-normal", !date && "text-muted-foreground")} />
                    }
                  >
                    <CalendarDays data-icon="inline-start" className="text-muted-foreground" />
                    {date ? format(date, "EEE, MMM d, yyyy") : "Pick a date"}
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto rounded-2xl p-1.5">
                    <Calendar
                      mode="single"
                      selected={date}
                      onSelect={(day) => {
                        setDate(day);
                        setDateOpen(false);
                      }}
                      disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0) - 24 * 60 * 60 * 1000) }}
                      autoFocus
                    />
                  </PopoverContent>
                </Popover>
              </Field>
              <Field>
                <FieldLabel htmlFor="post-time" className="font-semibold">Time</FieldLabel>
                <div className="relative">
                  <Clock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="post-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-11 rounded-xl pl-10" />
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="post-zone" className="font-semibold">Time zone</FieldLabel>
                <div className="relative">
                  <Globe className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
                  <NativeSelect id="post-zone" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} className="w-full [&_select]:h-11 [&_select]:rounded-xl [&_select]:pl-10">
                    {(zones.length ? zones : [{ value: timeZone, label: timeZone }]).map((zone) => (
                      <NativeSelectOption key={zone.value} value={zone.value}>
                        {zone.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              </Field>
            </div>

            <div
              className={cn(
                "flex items-center gap-3 rounded-2xl p-3.5 text-sm ring-1 transition-colors",
                scheduleError ? "bg-amber-500/5 ring-amber-500/30" : "bg-primary/5 ring-primary/20"
              )}
            >
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", scheduleError ? "bg-amber-500/15 text-amber-600" : "bg-primary/15 text-primary")}>
                {scheduleError ? <TriangleAlert className="size-4.5" /> : <CalendarClock className="size-4.5" />}
              </span>
              {scheduleError || !scheduledAt ? (
                <span className="text-amber-700 dark:text-amber-300">{scheduleError}</span>
              ) : (
                <span className="min-w-0">
                  <span className="block font-semibold">
                    Goes live {date && format(date, "EEEE, MMMM d")} at {time} <span className="font-normal text-muted-foreground">({timeZone.replace(/_/g, " ")})</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {relative(scheduledAt.getTime() - now)} · your local time {format(scheduledAt, "MMM d, h:mm a")}
                  </span>
                </span>
              )}
            </div>
          </Panel>
        </div>

        {/* Live preview */}
        <aside className="space-y-3 lg:sticky lg:top-24">
          <div className="rounded-3xl bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_32px_-16px_rgb(15_23_42/0.12)] ring-1 ring-border/60">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                Live preview
              </h3>
              {platforms.length > 0 && (
                <div role="tablist" aria-label="Preview platform" className="flex gap-1 rounded-xl bg-muted p-1">
                  {platforms.map((platform) => (
                    <button
                      key={platform}
                      type="button"
                      role="tab"
                      aria-selected={shownPreview === platform}
                      onClick={() => setPreviewPlatform(platform)}
                      title={PLATFORM_STYLES[platform].name}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        shownPreview === platform ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <PlatformIcon platform={platform} className="size-3.5" />
                      <span className="hidden sm:inline">{PLATFORM_STYLES[platform].name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {platforms.length === 0 ? (
              <div className="flex aspect-4/5 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-center text-sm text-muted-foreground">
                <Globe className="size-6" />
                Pick a platform to preview the post
              </div>
            ) : (
              <div key={shownPreview} className="rounded-[26px] bg-linear-to-br from-muted/80 to-muted/30 p-3 animate-in duration-300 fade-in-0 zoom-in-[0.98]">
                <PlatformPreview platform={shownPreview} post={{ title, caption, hashtags: allTags, media, account, initials }} />
              </div>
            )}
          </div>

          {(check.errors.length > 0 || check.warnings.length > 0) && (
            <ul className="space-y-1.5 rounded-2xl bg-card p-3 text-xs ring-1 ring-border/60">
              {check.errors.map((message) => (
                <li key={message} className="flex gap-2 text-destructive">
                  <X className="mt-px size-3.5 shrink-0" />
                  {message}
                </li>
              ))}
              {check.warnings.map((message) => (
                <li key={message} className="flex gap-2 text-amber-700 dark:text-amber-300">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" />
                  {message}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {/* Actions */}
      <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-3xl bg-card/90 p-3 shadow-[0_12px_40px_-12px_rgb(15_23_42/0.25)] ring-1 ring-border/60 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:pl-5">
        {error ? (
          <Alert variant="destructive" className="border-0 bg-transparent p-0">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-xs text-muted-foreground">
            {platforms.length
              ? `Publishes to ${platforms.map((p) => PLATFORM_STYLES[p].name).join(", ")} from your Blotato calendar, scheduled there when you click Schedule.`
              : publishing.platforms.length
                ? "Pick at least one platform."
                : "Connect your accounts in Settings → Integrations to schedule."}
          </p>
        )}
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="lg" className="h-11 rounded-xl px-4" disabled={saving || !title.trim() || platforms.length === 0} onClick={() => submit("draft")}>
            {saving && intent === "draft" && <Spinner />}
            Save draft
          </Button>
          <Tooltip disabled={canSchedule}>
            <TooltipTrigger render={<span />}>
              <Button
                size="lg"
                className="h-11 min-w-40 rounded-xl px-5 shadow-lg shadow-primary/25 transition-[translate,box-shadow] hover:-translate-y-px hover:shadow-primary/35"
                disabled={saving || !canSchedule}
                onClick={() => submit("schedule")}
              >
                {saving && intent === "schedule" ? <Spinner /> : <CalendarClock data-icon="inline-start" />}
                {initial.schedule ? "Reschedule post" : "Schedule post"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{!title.trim() ? "Add a title" : platforms.length === 0 ? "Pick a platform" : (check.errors[0] ?? scheduleError)}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <ImageEditorDialog
        image={editing !== null ? (media[editing] ?? null) : null}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={(image) => {
          if (editing !== null) setMedia((current) => current.map((item, i) => (i === editing ? image : item)));
          setEditing(null);
        }}
      />
    </div>
  );
}

function Panel({ step, title, description, children }: { step: number; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-5 rounded-3xl bg-card p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_32px_-16px_rgb(15_23_42/0.12)] ring-1 ring-border/60 sm:p-6">
      <header className="flex items-center gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground shadow-md shadow-primary/25">{step}</span>
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  const ratio = value / max;
  return (
    <span className={cn("text-xs tabular-nums", ratio > 1 ? "font-semibold text-destructive" : ratio > 0.9 ? "text-amber-600" : "text-muted-foreground")}>
      {value.toLocaleString()} / {max.toLocaleString()}
    </span>
  );
}

// Uploading, generating, ordering and editing the post's images
function MediaManager({
  media,
  setMedia,
  imageKit,
  onEdit,
}: {
  media: PostMedia[];
  setMedia: React.Dispatch<React.SetStateAction<PostMedia[]>>;
  imageKit: boolean;
  onEdit: (index: number) => void;
}) {
  const [mode, setMode] = useState<"upload" | "generate">("upload");
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<Aspect>("vertical");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const full = media.length + uploading >= MAX_MEDIA;

  async function upload(files: File[]) {
    setError(null);
    const room = MAX_MEDIA - media.length - uploading;
    let videos = media.filter((item) => isVideo(item)).length;
    const accepted = files
      .filter((file) => {
        if (IMAGE_TYPES.includes(file.type)) return file.size <= MAX_UPLOAD_BYTES;
        // One video per post
        if (!VIDEO_TYPES.includes(file.type) || file.size > MAX_VIDEO_BYTES || videos > 0) return false;
        videos++;
        return true;
      })
      .slice(0, Math.max(0, room));
    if (accepted.length < files.length) {
      setError(`Some files were skipped: images must be PNG, JPG, WEBP or GIF up to 10MB; one MP4, MOV or WEBM video up to 100MB; ${MAX_MEDIA} files per post.`);
    }
    setUploading((n) => n + accepted.length);
    await Promise.all(
      accepted.map(async (file) => {
        try {
          const form = new FormData();
          form.set("file", file);
          const response = await fetch("/api/media/upload", { method: "POST", body: form });
          const body = (await response.json().catch(() => null)) as { media?: PostMedia; error?: string } | null;
          if (!response.ok || !body?.media) throw new Error(body?.error ?? "The upload failed.");
          setMedia((current) => [...current, body.media!]);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setUploading((n) => n - 1);
        }
      })
    );
  }

  async function generate() {
    setError(null);
    setGenerating(true);
    try {
      const response = await fetch("/api/media/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, aspect }),
      });
      const body = (await response.json().catch(() => null)) as { media?: PostMedia; error?: string } | null;
      if (!response.ok || !body?.media) throw new Error(body?.error ?? "The image couldn't be generated.");
      setMedia((current) => [...current, body.media!]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function move(index: number, by: -1 | 1) {
    setMedia((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div role="tablist" className="inline-flex rounded-xl bg-muted p-1">
        {(
          [
            { id: "upload", label: "Upload", Icon: Upload },
            { id: "generate", label: "Generate with AI", Icon: Sparkles },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              mode === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {mode === "upload" ? (
        <button
          type="button"
          disabled={full}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            upload(Array.from(e.dataTransfer.files));
          }}
          className={cn(
            "flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
            dragging ? "scale-[1.01] border-primary bg-primary/5" : "border-primary/25 bg-accent/30 hover:border-primary/50 hover:bg-accent/60"
          )}
        >
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ImagePlus className="size-5" />
          </span>
          <span className="text-sm font-semibold">{dragging ? "Drop to upload" : "Drop images or a video here, or click to browse"}</span>
          <span className="text-xs text-muted-foreground">Images: PNG, JPG, WEBP or GIF up to 10MB · Video: MP4, MOV or WEBM up to 100MB</span>
        </button>
      ) : (
        <div className="space-y-3 rounded-2xl bg-linear-to-br from-violet-500/5 to-fuchsia-500/5 p-4 ring-1 ring-violet-500/20">
          {!imageKit && <p className="text-xs text-amber-700 dark:text-amber-300">Add IMAGEKIT_PRIVATE_KEY and IMAGEKIT_URL_ENDPOINT to .env.local to generate images.</p>}
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            maxLength={900}
            placeholder="Describe the image: subject, style, mood, colours… e.g. a flat-lay of iced coffee on a pastel pink table, soft morning light"
            className="min-h-0 resize-none rounded-xl bg-card text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(ASPECTS) as Aspect[]).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={aspect === id}
                onClick={() => setAspect(id)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-medium ring-1 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  aspect === id ? "bg-violet-600 text-white ring-violet-600" : "bg-card text-muted-foreground ring-border hover:text-foreground"
                )}
              >
                {ASPECTS[id].label}
              </button>
            ))}
            <Button
              className="ml-auto h-9 rounded-xl bg-linear-to-r from-violet-600 to-fuchsia-600 px-4 text-white shadow-lg shadow-violet-500/25 hover:opacity-90"
              disabled={!imageKit || generating || full || prompt.trim().length < 5}
              onClick={generate}
            >
              {generating ? <Spinner /> : <Wand2 data-icon="inline-start" />}
              {generating ? "Generating…" : "Generate"}
            </Button>
          </div>
          {generating && <p className="text-xs text-muted-foreground">ImageKit is painting your image. This can take up to a minute.</p>}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        multiple
        accept={UPLOAD_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          upload(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {error && <p className="text-xs text-destructive">{error}</p>}

      {(media.length > 0 || uploading > 0 || generating) && (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {media.map((item, index) => (
            <li key={item.url} className="group/media relative aspect-square overflow-hidden rounded-2xl bg-muted ring-1 ring-border/60 animate-in fade-in-0 zoom-in-95">
              {isVideo(item) ? (
                <>
                  <video src={item.url} muted playsInline preload="metadata" className="size-full object-cover" />
                  <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur group-hover/media:opacity-0">
                    <Video className="size-2.5" />
                    Video
                  </span>
                </>
              ) : (
                <img src={imageKitThumbnail(item.url, 320)} alt={item.name} className="size-full object-cover" />
              )}
              {index === 0 && (
                <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                  <Star className="size-2.5 fill-current" />
                  Cover
                </span>
              )}
              {item.origin !== "upload" && (
                <span className="absolute top-1.5 right-1.5 rounded-full bg-violet-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white capitalize backdrop-blur">
                  {item.origin === "agent" ? "AI" : item.origin}
                </span>
              )}
              <div className="absolute inset-0 flex flex-col justify-end bg-linear-to-t from-black/70 via-black/10 to-transparent p-1.5 opacity-0 transition-opacity group-focus-within/media:opacity-100 group-hover/media:opacity-100">
                <div className="flex items-center gap-1">
                  <MediaAction label="Move left" disabled={index === 0} onClick={() => move(index, -1)}>
                    <ChevronLeft />
                  </MediaAction>
                  <MediaAction label="Move right" disabled={index === media.length - 1} onClick={() => move(index, 1)}>
                    <ChevronRight />
                  </MediaAction>
                  <span className="flex-1" />
                  <MediaAction label="Remove" onClick={() => setMedia((current) => current.filter((_, i) => i !== index))}>
                    <X />
                  </MediaAction>
                </div>
                {!isVideo(item) && (
                  <Button
                    size="sm"
                    className="mt-1.5 w-full rounded-lg bg-white/95 text-neutral-900 hover:bg-white"
                    disabled={!imageKit}
                    title={imageKit ? undefined : "Image editing needs ImageKit"}
                    onClick={() => onEdit(index)}
                  >
                    <Pencil data-icon="inline-start" />
                    Edit image
                  </Button>
                )}
              </div>
            </li>
          ))}
          {Array.from({ length: uploading + (generating ? 1 : 0) }, (_, i) => (
            <li key={`pending-${i}`} className="relative flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl bg-muted text-xs text-muted-foreground ring-1 ring-border/60">
              <span className="absolute size-full animate-pulse rounded-2xl bg-muted-foreground/5" />
              <Spinner />
              {i < uploading ? "Uploading…" : "Generating…"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MediaAction({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded-md bg-white/90 text-neutral-800 transition-colors hover:bg-white disabled:opacity-40 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}
