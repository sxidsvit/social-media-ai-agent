"use client";

import { useActionState, useRef, useState, startTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Check, ChevronRight, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CAMPAIGN_ICONS } from "@/lib/campaign-icons";
import type { Office } from "@/lib/campaigns";
import { createCampaign, type CreateCampaignState } from "@/app/create-campaign/actions";
import { Logo } from "@/components/brand/logo";
import { CampaignIcon } from "@/components/campaign/campaign-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const MAX_NAME = 60;
const MAX_ICON_BYTES = 2 * 1024 * 1024;
const STEPS = ["Campaign", "Office space"] as const;

// isFirst: onboarding (no campaigns yet) vs. adding another campaign from the dashboard
type Props = { offices: Office[]; isFirst: boolean };

export function CreateCampaignWizard({ offices, isFirst }: Props) {
  const [step, setStep] = useState<0 | 1>(0);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string>(CAMPAIGN_ICONS[0].id);
  const [custom, setCustom] = useState<{ file: File; url: string } | null>(null);
  const [fileError, setFileError] = useState<string>();
  const [office, setOffice] = useState<string | null>(offices[0]?.id ?? null);
  const [state, formAction, pending] = useActionState<CreateCampaignState, FormData>(createCampaign, {});
  const fileInput = useRef<HTMLInputElement>(null);

  const iconFile = custom?.file ?? null;
  const iconPreview = custom?.url ?? null;

  // Swap the custom icon, releasing the previous blob preview URL
  const setIconFile = (file: File | null) => {
    if (custom) URL.revokeObjectURL(custom.url);
    setCustom(file ? { file, url: URL.createObjectURL(file) } : null);
  };

  const trimmedName = name.trim();
  const canContinue = trimmedName.length > 0 && trimmedName.length <= MAX_NAME;

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setFileError("Please choose an image file.");
    if (file.size > MAX_ICON_BYTES) return setFileError("Image must be 2MB or smaller.");
    setFileError(undefined);
    setIconFile(file);
  };

  const goNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (canContinue) setStep(1);
  };

  const submit = () => {
    if (!office || pending) return;
    // Build the payload from state so the uploaded File survives failed attempts
    const fd = new FormData();
    fd.set("name", trimmedName);
    fd.set("office", office);
    if (iconFile) fd.set("iconFile", iconFile);
    else fd.set("icon", icon);
    startTransition(() => formAction(fd));
  };

  return (
    <div className="relative h-svh overflow-hidden bg-linear-to-br from-blue-50 via-slate-50 to-indigo-50">
      <div className="pointer-events-none absolute -top-40 -left-40 size-120 rounded-full bg-blue-300/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-40 -bottom-40 size-120 rounded-full bg-indigo-300/20 blur-3xl" />

      <div className="relative mx-auto flex h-full w-full max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex shrink-0 items-center justify-between">
          <Logo href={isFirst ? "/create-campaign" : "/dashboard"} />
          {!isFirst && (
            <Button variant="ghost" size="lg" className="text-muted-foreground" nativeButton={false} render={<Link href="/dashboard" />}>
              <X data-icon="inline-start" />
              Cancel
            </Button>
          )}
        </div>
        <Stepper step={step} />

        <div className="mt-5 flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white bg-card shadow-xl shadow-blue-900/5">
          {step === 0 ? (
            <form onSubmit={goNext} className="flex min-h-0 flex-col gap-6 overflow-y-auto p-6 sm:p-9">
              <Heading title={isFirst ? "Create your first campaign" : "Create a new campaign"} description="Give it a name and a logo. You can change these later." />

              <Field>
                <FieldLabel htmlFor="campaign-name" className="font-semibold">Campaign name</FieldLabel>
                <Input
                  id="campaign-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={MAX_NAME}
                  placeholder="e.g. Summer Product Launch"
                  autoComplete="off"
                  autoFocus
                  className="h-12 rounded-xl px-4 text-base md:text-sm"
                />
              </Field>

              <Field>
                <FieldLabel className="font-semibold">Logo</FieldLabel>
                <div role="radiogroup" aria-label="Campaign logo" className="flex flex-wrap gap-2.5">
                  {CAMPAIGN_ICONS.map(({ id, label, Icon, tone }) => {
                    const selected = !iconFile && icon === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={label}
                        title={label}
                        onClick={() => {
                          setIcon(id);
                          setIconFile(null);
                        }}
                        className={cn(
                          "flex size-16 items-center justify-center rounded-2xl border-2 bg-muted/60 transition-all outline-none hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50",
                          selected ? "border-primary bg-accent shadow-md shadow-primary/15" : "border-transparent"
                        )}
                      >
                        <span className={cn("flex size-12 items-center justify-center rounded-xl shadow-sm", tone)}>
                          <Icon className="size-5.5" />
                        </span>
                      </button>
                    );
                  })}

                  {iconPreview ? (
                    <div className="relative">
                      <button
                        type="button"
                        role="radio"
                        aria-checked
                        aria-label="Custom logo — click to replace"
                        onClick={() => fileInput.current?.click()}
                        className="flex size-16 items-center justify-center rounded-2xl border-2 border-primary bg-accent shadow-md shadow-primary/15 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                        <img src={iconPreview} alt="" className="size-12 rounded-xl object-cover" />
                      </button>
                      <button
                        type="button"
                        aria-label="Remove custom logo"
                        onClick={() => setIconFile(null)}
                        className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background shadow-sm hover:bg-foreground/80"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      className="flex size-16 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-primary/30 bg-accent/50 text-primary transition-colors outline-none hover:border-primary/60 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <Upload className="size-4" />
                      <span className="text-[11px] font-semibold">Upload</span>
                    </button>
                  )}
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  className="sr-only"
                  tabIndex={-1}
                  onChange={onFileChange}
                />
                {fileError && <FieldError>{fileError}</FieldError>}
              </Field>

              <div className="flex items-center gap-3.5 rounded-2xl border bg-muted/40 p-4">
                <CampaignIcon icon={icon} iconUrl={iconPreview} className="size-12 shadow-sm" />
                <div className="min-w-0">
                  <p className={cn("truncate font-semibold", !trimmedName && "text-foreground/80")}>
                    {trimmedName || "Your campaign"}
                  </p>
                  <p className="text-xs text-muted-foreground">Preview</p>
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="submit" size="lg" disabled={!canContinue} className="h-12 min-w-36 rounded-xl px-6 text-base shadow-lg shadow-primary/20">
                  Continue
                  <ChevronRight data-icon="inline-end" />
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex min-h-0 flex-col gap-6 overflow-y-auto p-6 sm:p-9">
              <div className="flex items-start justify-between gap-4">
                <Heading title="Choose an office space" description="Pick where your AI agents will work on your campaign." />
                <div className="hidden shrink-0 items-center gap-2 rounded-full border bg-muted/40 py-1 pr-3.5 pl-1 sm:flex">
                  <CampaignIcon icon={icon} iconUrl={iconPreview} className="size-7 rounded-full" />
                  <span className="max-w-36 truncate text-sm font-semibold">{trimmedName}</span>
                </div>
              </div>

              {offices.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                  No offices available yet. Add images to public/offices.
                </div>
              ) : (
                <div role="radiogroup" aria-label="Office space" className="grid gap-4 sm:grid-cols-2">
                  {offices.map((o, i) => {
                    const selected = office === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setOffice(o.id)}
                        className={cn(
                          "group overflow-hidden rounded-2xl border-2 bg-background p-1.5 text-left transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                          selected ? "border-primary shadow-lg shadow-primary/15" : "border-border hover:border-primary/40"
                        )}
                      >
                        <div className="relative aspect-16/10 overflow-hidden rounded-xl bg-muted">
                          <Image
                            src={o.src}
                            alt={o.name}
                            fill
                            priority={i < 2}
                            sizes="(min-width: 640px) 340px, 100vw"
                            className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                          />
                          {selected && (
                            <span className="absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-2 ring-white">
                              <Check className="size-4" strokeWidth={3} />
                            </span>
                          )}
                        </div>
                        <p className="px-2 pt-2.5 pb-1 text-sm font-semibold">{o.name}</p>
                      </button>
                    );
                  })}
                </div>
              )}

              {state.error && (
                <Alert variant="destructive">
                  <AlertDescription>{state.error}</AlertDescription>
                </Alert>
              )}

              <div className="flex items-center justify-between">
                <Button variant="ghost" size="lg" className="h-12 rounded-xl px-4" onClick={() => setStep(0)} disabled={pending}>
                  <ArrowLeft data-icon="inline-start" />
                  Back
                </Button>
                <Button
                  size="lg"
                  onClick={submit}
                  disabled={!office || pending}
                  className="h-12 min-w-44 rounded-xl px-6 text-base shadow-lg shadow-primary/20"
                >
                  {pending && <Spinner />}
                  {pending ? "Creating…" : "Create Campaign"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Heading({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1.5">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mt-6 flex shrink-0 items-center gap-3">
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <li key={label} className="flex items-center gap-3">
            {i > 0 && <span className={cn("h-px w-8 transition-colors", done || active ? "bg-primary" : "bg-border")} />}
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  done || active ? "bg-primary text-primary-foreground shadow-md shadow-primary/25" : "border bg-background text-muted-foreground"
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("text-sm font-semibold", !active && !done && "text-muted-foreground")}>{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
