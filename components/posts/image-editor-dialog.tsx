"use client";

/* eslint-disable @next/next/no-img-element -- the preview is a live ImageKit transformation URL */
import { useEffect, useMemo, useState } from "react";
import {
  Contrast,
  Crop,
  Droplet,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  ImagePlus,
  Paintbrush,
  RotateCcw,
  RotateCw,
  ScanFace,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  SunMedium,
  Type,
  Undo2,
  Wand2,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import {
  ASPECTS,
  checkEdits,
  EDITS,
  toImageEdit,
  transformationUrl,
  type Aspect,
  type EditInput,
  type EditKind,
  type ImageEdit,
  type TextPosition,
} from "@/lib/imagekit/transformations";
import type { PostMedia } from "@/lib/posts/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

// Edits a post image with ImageKit (lib/imagekit/transformations.ts, the same edits the Creator
// Agent's transform_image tool has). Crop, adjust and text edits preview live straight from
// ImageKit's URL API; AI edits run on the server (/api/media/edit) and each result is stored as a new
// image, so it has a permanent URL and can be undone. Saving bakes any live edits into a new image.

type Tab = "ai" | "crop" | "adjust" | "text";

const TABS: { id: Tab; label: string; Icon: LucideIcon }[] = [
  { id: "ai", label: "AI magic", Icon: Sparkles },
  { id: "crop", label: "Crop", Icon: Crop },
  { id: "adjust", label: "Adjust", Icon: SlidersHorizontal },
  { id: "text", label: "Text", Icon: Type },
];

// The live (non-AI) controls, turned into edits in a fixed order
type Controls = {
  crop: { aspect: Aspect; mode: "smart_crop" | "face_crop" | "resize" } | null;
  grayscale: boolean;
  contrast: boolean;
  sharpen: number;
  blur: number;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  rounded: number;
  border: number;
  borderColor: string;
  gradient: boolean;
  gradientColor: string;
  text: string;
  textPosition: TextPosition;
  textColor: string;
  textSize: number;
  textBox: boolean;
  textBoxColor: string;
};

const DEFAULT_CONTROLS: Controls = {
  crop: null,
  grayscale: false,
  contrast: false,
  sharpen: 0,
  blur: 0,
  rotate: 0,
  flipH: false,
  flipV: false,
  rounded: 0,
  border: 0,
  borderColor: "#FFFFFF",
  gradient: false,
  gradientColor: "#000000",
  text: "",
  textPosition: "bottom",
  textColor: "#FFFFFF",
  textSize: 64,
  textBox: false,
  textBoxColor: "#000000",
};

// A flat edit input with every unused field null, as /api/media/edit (and the agent tool) take it
function input(kind: EditKind, fields: Partial<Omit<EditInput, "kind">> = {}): EditInput {
  return { kind, prompt: null, aspect: null, amount: null, text: null, color: null, background: null, position: null, direction: null, ...fields };
}

function liveInputs(c: Controls): EditInput[] {
  const edits: EditInput[] = [];
  if (c.crop) edits.push(input(c.crop.mode, { aspect: c.crop.aspect }));
  if (c.rotate % 360 !== 0) edits.push(input("rotate", { amount: c.rotate % 360 }));
  if (c.flipH) edits.push(input("flip", { direction: "horizontal" }));
  if (c.flipV) edits.push(input("flip", { direction: "vertical" }));
  if (c.grayscale) edits.push(input("grayscale"));
  if (c.contrast) edits.push(input("contrast"));
  if (c.sharpen > 0) edits.push(input("sharpen", { amount: c.sharpen }));
  if (c.blur > 0) edits.push(input("blur", { amount: c.blur }));
  if (c.gradient) edits.push(input("gradient", { color: c.gradientColor }));
  if (c.text.trim()) {
    edits.push(input("text", { text: c.text, position: c.textPosition, color: c.textColor, amount: c.textSize, background: c.textBox ? c.textBoxColor : null }));
  }
  if (c.border > 0) edits.push(input("border", { amount: c.border, color: c.borderColor }));
  if (c.rounded > 0) edits.push(input("rounded", { amount: c.rounded }));
  return edits;
}

function toEdits(inputs: EditInput[]) {
  return inputs.map(toImageEdit).filter((edit): edit is ImageEdit => typeof edit !== "string");
}

// Waits until the user stops dragging a slider or typing before asking ImageKit for a new preview
function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

async function requestEdit(image: PostMedia, edits: EditInput[]): Promise<PostMedia> {
  const response = await fetch("/api/media/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: image.url, name: image.name, edits }),
  });
  const body = (await response.json().catch(() => null)) as { media?: PostMedia; error?: string } | null;
  if (!response.ok || !body?.media) throw new Error(body?.error ?? "The edit failed. Please try again.");
  return body.media;
}

export function ImageEditorDialog({
  image,
  open,
  onOpenChange,
  onSave,
}: {
  image: PostMedia | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (image: PostMedia) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-5xl">
        {/* Keyed so each image opens with fresh controls and history */}
        {image && <Editor key={image.url} image={image} onCancel={() => onOpenChange(false)} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  );
}

function Editor({ image, onCancel, onSave }: { image: PostMedia; onCancel: () => void; onSave: (image: PostMedia) => void }) {
  const [history, setHistory] = useState<PostMedia[]>([image]);
  const current = history[history.length - 1];
  const [tab, setTab] = useState<Tab>("ai");
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const set = <K extends keyof Controls>(key: K, value: Controls[K]) => setControls((c) => ({ ...c, [key]: value }));

  const live = useMemo(() => liveInputs(controls), [controls]);
  const debouncedLive = useDebounced(live, 350);
  const liveEdits = useMemo(() => toEdits(debouncedLive), [debouncedLive]);
  const liveProblem = liveEdits.length ? checkEdits(liveEdits) : null;
  const previewUrl = useMemo(() => {
    if (!liveEdits.length || liveProblem) return current.url;
    try {
      return transformationUrl(current.url, liveEdits);
    } catch {
      return current.url;
    }
  }, [current.url, liveEdits, liveProblem]);

  // Show the spinner while ImageKit renders a new preview
  const [shownUrl, setShownUrl] = useState(previewUrl);
  if (shownUrl !== previewUrl) {
    setShownUrl(previewUrl);
    setPreviewLoading(true);
  }

  // Runs one AI edit on top of the live edits; the result becomes the new current image
  async function runAi(label: string, ai: EditInput[]) {
    setBusy(label);
    setError(null);
    try {
      const result = await requestEdit(current, [...live, ...ai]);
      setHistory((h) => [...h, result]);
      setControls(DEFAULT_CONTROLS);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setError(null);
    if (!live.length) {
      onSave(current);
      return;
    }
    setBusy("Saving your edits");
    try {
      const result = await requestEdit(current, live);
      onSave(result);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const changed = history.length > 1 || live.length > 0;

  return (
    <>
      <header className="flex items-center gap-3 border-b px-5 py-4 pr-12">
        <span className="flex size-9 items-center justify-center rounded-xl bg-linear-to-br from-violet-500 to-fuchsia-600 text-white shadow-md shadow-violet-500/30">
          <Wand2 className="size-4.5" />
        </span>
        <div className="min-w-0">
          <DialogTitle className="text-base font-semibold">Edit image</DialogTitle>
          <DialogDescription className="text-xs">AI edits, crops, adjustments and text, powered by ImageKit</DialogDescription>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_340px] md:overflow-hidden">
        {/* Preview */}
        <div className="relative flex min-h-72 items-center justify-center bg-[conic-gradient(var(--muted)_25%,transparent_0_50%,var(--muted)_0_75%,transparent_0)] bg-size-[20px_20px] p-6 md:min-h-0">
          <img
            src={previewUrl}
            alt={current.name}
            onLoad={() => setPreviewLoading(false)}
            onError={() => setPreviewLoading(false)}
            className={cn(
              "max-h-[56svh] max-w-full rounded-xl object-contain shadow-2xl shadow-black/20 transition-[opacity,filter] duration-300",
              (previewLoading || busy) && "opacity-60 blur-[1px]"
            )}
          />
          {(previewLoading || busy) && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flex items-center gap-2 rounded-full bg-background/90 px-4 py-2 text-sm font-medium shadow-lg ring-1 ring-border backdrop-blur">
                <Spinner />
                {busy ? `${busy}…` : "Rendering preview…"}
              </span>
            </div>
          )}
          {busy && busy !== "Saving your edits" && (
            <p className="absolute inset-x-0 bottom-3 text-center text-xs text-muted-foreground">AI edits can take up to a minute.</p>
          )}
          <div className="absolute top-3 left-3 flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg bg-background/90 backdrop-blur"
              disabled={history.length < 2 || !!busy}
              onClick={() => {
                setHistory((h) => h.slice(0, -1));
                setControls(DEFAULT_CONTROLS);
              }}
            >
              <Undo2 data-icon="inline-start" />
              Undo
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg bg-background/90 backdrop-blur"
              disabled={!changed || !!busy}
              onClick={() => {
                setHistory((h) => h.slice(0, 1));
                setControls(DEFAULT_CONTROLS);
              }}
            >
              <RotateCcw data-icon="inline-start" />
              Reset
            </Button>
          </div>
          {history.length > 1 && (
            <span className="absolute top-3 right-3 rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-medium shadow-sm ring-1 ring-border backdrop-blur">
              {history.length - 1} AI {history.length === 2 ? "edit" : "edits"} applied
            </span>
          )}
        </div>

        {/* Controls */}
        <div className="flex min-h-0 flex-col border-t md:border-t-0 md:border-l">
          <div role="tablist" className="grid grid-cols-4 gap-1 border-b p-2">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  tab === id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            {tab === "ai" && <AiPanel busy={!!busy} onRun={runAi} />}
            {tab === "crop" && <CropPanel crop={controls.crop} onChange={(crop) => set("crop", crop)} />}
            {tab === "adjust" && <AdjustPanel controls={controls} set={set} />}
            {tab === "text" && <TextPanel controls={controls} set={set} />}
            {liveProblem && <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{liveProblem}</p>}
          </div>
        </div>
      </div>

      <footer className="flex flex-col gap-2 border-t bg-muted/40 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className={cn("min-h-4 text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? (live.length ? `${live.length} live ${live.length === 1 ? "edit" : "edits"}: saved as a new image` : "The original image is kept: edits save as a new image.")}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="lg" className="rounded-xl" onClick={onCancel} disabled={busy === "Saving your edits"}>
            Cancel
          </Button>
          <Button size="lg" className="min-w-32 rounded-xl px-4 shadow-lg shadow-primary/20" onClick={save} disabled={!changed || !!busy || !!liveProblem}>
            {busy === "Saving your edits" && <Spinner />}
            Save image
          </Button>
        </div>
      </footer>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{children}</h4>;
}

function AiPanel({ busy, onRun }: { busy: boolean; onRun: (label: string, edits: EditInput[]) => void }) {
  const [prompt, setPrompt] = useState("");
  const [background, setBackground] = useState("");
  const [fillAspect, setFillAspect] = useState<Aspect>("portrait");
  const [fillPrompt, setFillPrompt] = useState("");

  const quick: { kind: EditKind; Icon: LucideIcon; edits: EditInput[] }[] = [
    { kind: "remove_background", Icon: Eraser, edits: [input("remove_background")] },
    { kind: "drop_shadow", Icon: Droplet, edits: [input("remove_background"), input("drop_shadow")] },
    { kind: "upscale", Icon: ZoomIn, edits: [input("upscale")] },
    { kind: "retouch", Icon: Paintbrush, edits: [input("retouch")] },
    { kind: "variation", Icon: Shuffle, edits: [input("variation")] },
  ];

  return (
    <>
      <section>
        <SectionTitle>One-click</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          {quick.map(({ kind, Icon, edits }) => (
            <button
              key={kind}
              type="button"
              disabled={busy}
              title={EDITS[kind].description}
              onClick={() => onRun(EDITS[kind].label, edits)}
              className="group/ai flex items-center gap-2 rounded-xl bg-muted/50 p-2.5 text-left text-xs font-medium ring-1 ring-border/60 transition-all outline-none hover:-translate-y-px hover:bg-muted hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-violet-500/15 to-fuchsia-500/15 text-violet-600 transition-transform group-hover/ai:scale-105 dark:text-violet-300">
                <Icon className="size-3.5" />
              </span>
              {kind === "drop_shadow" ? "Cut out + shadow" : EDITS[kind].label}
            </button>
          ))}
        </div>
      </section>

      <PromptAction
        title="Edit with a prompt"
        placeholder="e.g. make it golden hour, add steam rising from the coffee"
        value={prompt}
        onChange={setPrompt}
        busy={busy}
        Icon={Wand2}
        action="Apply edit"
        onRun={() => onRun("Editing with AI", [input("edit", { prompt })])}
      />
      <PromptAction
        title="Change background"
        placeholder="e.g. a sunny beach with soft bokeh"
        value={background}
        onChange={setBackground}
        busy={busy}
        Icon={ImagePlus}
        action="Replace background"
        onRun={() => onRun("Changing the background", [input("change_background", { prompt: background })])}
      />

      <section>
        <SectionTitle>Generative fill</SectionTitle>
        <p className="mb-2 text-xs text-muted-foreground">Extend the image to a new shape and let AI paint the new space.</p>
        <AspectPicker value={fillAspect} onChange={setFillAspect} />
        <Input
          value={fillPrompt}
          onChange={(e) => setFillPrompt(e.target.value)}
          placeholder="What to fill it with (optional)"
          className="mt-2 h-9 rounded-xl"
        />
        <Button
          size="sm"
          variant="secondary"
          className="mt-2 w-full rounded-xl"
          disabled={busy}
          onClick={() => onRun("Filling the new space", [input("extend", { aspect: fillAspect, prompt: fillPrompt.trim() || null })])}
        >
          <Sparkles data-icon="inline-start" />
          Extend to {ASPECTS[fillAspect].label}
        </Button>
      </section>
    </>
  );
}

function PromptAction({
  title,
  placeholder,
  value,
  onChange,
  busy,
  Icon,
  action,
  onRun,
}: {
  title: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  Icon: LucideIcon;
  action: string;
  onRun: () => void;
}) {
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={2} maxLength={500} className="min-h-0 resize-none rounded-xl text-sm" />
      <Button size="sm" variant="secondary" className="mt-2 w-full rounded-xl" disabled={busy || value.trim().length < 3} onClick={onRun}>
        <Icon data-icon="inline-start" />
        {action}
      </Button>
    </section>
  );
}

function AspectPicker({ value, onChange }: { value: Aspect | null; onChange: (aspect: Aspect) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {(Object.keys(ASPECTS) as Aspect[]).map((aspect) => {
        const { label, ratio } = ASPECTS[aspect];
        return (
          <button
            key={aspect}
            type="button"
            aria-pressed={value === aspect}
            onClick={() => onChange(aspect)}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-xl p-2 text-[10px] font-medium ring-1 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              value === aspect ? "bg-primary/10 text-primary ring-primary/50" : "text-muted-foreground ring-border/60 hover:bg-muted"
            )}
          >
            <span className="flex h-7 items-center">
              <span className="rounded-[3px] border-[1.5px] border-current" style={{ width: ratio >= 1 ? 26 : 26 * ratio, height: ratio >= 1 ? 26 / ratio : 26 }} />
            </span>
            {label.split(" ")[1]}
          </button>
        );
      })}
    </div>
  );
}

function CropPanel({ crop, onChange }: { crop: Controls["crop"]; onChange: (crop: Controls["crop"]) => void }) {
  const modes: { id: NonNullable<Controls["crop"]>["mode"]; label: string; Icon: LucideIcon }[] = [
    { id: "smart_crop", label: "Smart", Icon: Sparkles },
    { id: "face_crop", label: "Face", Icon: ScanFace },
    { id: "resize", label: "Center", Icon: Crop },
  ];
  return (
    <>
      <section>
        <SectionTitle>Shape</SectionTitle>
        <AspectPicker value={crop?.aspect ?? null} onChange={(aspect) => onChange({ aspect, mode: crop?.mode ?? "smart_crop" })} />
        <p className="mt-2 text-xs text-muted-foreground">Feed 4:5 suits Instagram, 9:16 TikTok and Reels, 16:9 YouTube.</p>
      </section>
      <section>
        <SectionTitle>Focus on</SectionTitle>
        <div className="grid grid-cols-3 gap-1.5">
          {modes.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={crop?.mode === id}
              disabled={!crop}
              title={EDITS[id].description}
              onClick={() => crop && onChange({ ...crop, mode: id })}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-medium ring-1 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
                crop?.mode === id ? "bg-primary/10 text-primary ring-primary/50" : "text-muted-foreground ring-border/60 hover:bg-muted"
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </section>
      {crop && (
        <Button variant="ghost" size="sm" className="w-full rounded-xl text-muted-foreground" onClick={() => onChange(null)}>
          Remove crop
        </Button>
      )}
    </>
  );
}

function ToggleRow({ label, Icon, checked, onChange }: { label: string; Icon: LucideIcon; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-xl px-1 py-1.5 text-sm">
      <Icon className="size-4 text-muted-foreground" />
      <span className="flex-1">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function SliderRow({ label, value, max, unit = "", onChange }: { label: string; value: number; max: number; unit?: string; onChange: (value: number) => void }) {
  return (
    <div className="space-y-2 px-1">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{value ? `${value}${unit}` : "Off"}</span>
      </div>
      <Slider value={[value]} min={0} max={max} onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)} />
    </div>
  );
}

function ColorInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <label className="relative flex size-8 shrink-0 cursor-pointer overflow-hidden rounded-lg ring-1 ring-border" title={label}>
      <span className="size-full" style={{ background: value }} />
      <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" aria-label={label} />
    </label>
  );
}

type SetControl = <K extends keyof Controls>(key: K, value: Controls[K]) => void;

function AdjustPanel({ controls, set }: { controls: Controls; set: SetControl }) {
  return (
    <>
      <section>
        <SectionTitle>Orientation</SectionTitle>
        <div className="grid grid-cols-4 gap-1.5">
          <IconButton label="Rotate left" Icon={RotateCcw} onClick={() => set("rotate", (controls.rotate - 90) % 360)} />
          <IconButton label="Rotate right" Icon={RotateCw} onClick={() => set("rotate", (controls.rotate + 90) % 360)} />
          <IconButton label="Flip horizontal" Icon={FlipHorizontal2} active={controls.flipH} onClick={() => set("flipH", !controls.flipH)} />
          <IconButton label="Flip vertical" Icon={FlipVertical2} active={controls.flipV} onClick={() => set("flipV", !controls.flipV)} />
        </div>
      </section>
      <section>
        <SectionTitle>Look</SectionTitle>
        <ToggleRow label="Grayscale" Icon={SunMedium} checked={controls.grayscale} onChange={(v) => set("grayscale", v)} />
        <ToggleRow label="Auto contrast" Icon={Contrast} checked={controls.contrast} onChange={(v) => set("contrast", v)} />
        <div className="mt-2 space-y-4">
          <SliderRow label="Sharpen" value={controls.sharpen} max={100} onChange={(v) => set("sharpen", v)} />
          <SliderRow label="Blur" value={controls.blur} max={50} onChange={(v) => set("blur", v)} />
        </div>
      </section>
      <section className="space-y-4">
        <SectionTitle>Frame</SectionTitle>
        <SliderRow label="Rounded corners" value={controls.rounded} max={200} unit="px" onChange={(v) => set("rounded", v)} />
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <SliderRow label="Border" value={controls.border} max={60} unit="px" onChange={(v) => set("border", v)} />
          </div>
          <ColorInput label="Border colour" value={controls.borderColor} onChange={(v) => set("borderColor", v)} />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <ToggleRow label="Gradient fade" Icon={Droplet} checked={controls.gradient} onChange={(v) => set("gradient", v)} />
          </div>
          <ColorInput label="Gradient colour" value={controls.gradientColor} onChange={(v) => set("gradientColor", v)} />
        </div>
      </section>
    </>
  );
}

function IconButton({ label, Icon, active, onClick }: { label: string; Icon: LucideIcon; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-10 items-center justify-center rounded-xl ring-1 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active ? "bg-primary/10 text-primary ring-primary/50" : "text-muted-foreground ring-border/60 hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

function TextPanel({ controls, set }: { controls: Controls; set: SetControl }) {
  return (
    <>
      <section>
        <SectionTitle>Text on image</SectionTitle>
        <Textarea
          value={controls.text}
          onChange={(e) => set("text", e.target.value)}
          placeholder="e.g. Summer drop · 20% off"
          rows={2}
          maxLength={200}
          className="min-h-0 resize-none rounded-xl text-sm"
        />
      </section>
      <section>
        <SectionTitle>Position</SectionTitle>
        <div className="grid grid-cols-3 gap-1.5">
          {(["top", "center", "bottom"] as const).map((position) => (
            <button
              key={position}
              type="button"
              aria-pressed={controls.textPosition === position}
              onClick={() => set("textPosition", position)}
              className={cn(
                "rounded-xl py-2 text-xs font-medium capitalize ring-1 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                controls.textPosition === position ? "bg-primary/10 text-primary ring-primary/50" : "text-muted-foreground ring-border/60 hover:bg-muted"
              )}
            >
              {position}
            </button>
          ))}
        </div>
      </section>
      <section className="space-y-4">
        <SectionTitle>Style</SectionTitle>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <SliderRow label="Size" value={controls.textSize} max={160} unit="px" onChange={(v) => set("textSize", Math.max(12, v))} />
          </div>
          <ColorInput label="Text colour" value={controls.textColor} onChange={(v) => set("textColor", v)} />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <ToggleRow label="Background box" Icon={Type} checked={controls.textBox} onChange={(v) => set("textBox", v)} />
          </div>
          <ColorInput label="Box colour" value={controls.textBoxColor} onChange={(v) => set("textBoxColor", v)} />
        </div>
        <p className="text-xs text-muted-foreground">Tip: add a gradient fade (Adjust) behind light text so it stays readable.</p>
      </section>
    </>
  );
}
