"use client";

/* eslint-disable @next/next/no-img-element -- scene images are pre-sized sprites served from our own API */
import { useEffect, useRef, useState } from "react";
import type { OfficeAgent, OfficeScene } from "@/lib/office-studio";
import type { AgentLiveStatus } from "@/lib/orchestration/types";
import { cn } from "@/lib/utils";
import { STATUS_TONES } from "@/components/agents/agent-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Props = {
  scene: OfficeScene;
  // "contain": keep the scene's aspect ratio (height follows width).
  // "cover": fill the size given via className, cropping around the agents.
  fit?: "contain" | "cover";
  // Animation speed for every agent, in frames per second
  fps?: number;
  className?: string;
  // Makes the agents clickable: clicking a character or its tag selects that agent
  selectedAgentId?: string | null;
  onAgentSelect?: (agentId: string) => void;
  // Live status per agent id, shown as a dot on each name tag
  statuses?: Record<string, AgentLiveStatus>;
  // Content of the popover that opens when hovering or focusing an agent's name tag
  renderPreview?: (agent: OfficeAgent, close: () => void) => React.ReactNode;
};

// Scene pixels kept around the outermost agents when cropping in "cover" mode
const AGENT_MARGIN = 40;
// The characters are drawn from behind, seated, with their heads a little left of centre
const HEAD_X = 0.4;

// Renders an AgentWorld office: the background plus each agent at its seat, playing its animation.
// Agents are laid out in percentages of an aspect-locked stage, so they never drift off their desks;
// the stage itself is sized with container query units to fit (or cover) whatever box it's given.
export function AgentOffice({ scene, fit = "contain", fps = 8, className, selectedAgentId, onAgentSelect, statuses, renderPreview }: Props) {
  const [ready, setReady] = useState(false);
  const backgroundRef = useRef<HTMLImageElement>(null);

  // The server-rendered background often finishes loading before hydration, in which case onLoad
  // never fires — so also check the element once mounted.
  useEffect(() => {
    if (backgroundRef.current?.complete) setReady(true);
  }, [scene.background]);

  const pct = (value: number, total: number) => `${(value / total) * 100}%`;

  // Horizontal band the agents occupy, as fractions of the scene width
  const left = Math.max(0, Math.min(...scene.agents.map((a) => a.x)) - AGENT_MARGIN);
  const right = Math.min(scene.width, Math.max(...scene.agents.map((a) => a.x + a.width)) + AGENT_MARGIN);
  const band = scene.agents.length ? { width: (right - left) / scene.width, center: (left + right) / 2 / scene.width } : { width: 1, center: 0.5 };

  // Stage width: cover the box, but never zoom in past the point where the agents' band fits.
  // Then centre on the agents without exposing an edge, and centre vertically (letterboxed if capped).
  // In "contain" mode the box already has the scene's aspect ratio, so this resolves to 100cqw.
  const ratio = scene.width / scene.height;
  const stageWidth = `min(max(100cqw, 100cqh * ${ratio}), 100cqw / ${band.width})`;
  const stageStyle = {
    width: `calc(${stageWidth})`,
    height: `calc(${stageWidth} / ${ratio})`,
    left: `clamp(100cqw - ${stageWidth}, 50cqw - ${stageWidth} * ${band.center}, 0px)`,
    top: `calc((100cqh - ${stageWidth} / ${ratio}) / 2)`,
  };

  const interactive = !!onAgentSelect;
  const fadeIn = cn("transition-opacity duration-500", ready ? "opacity-100" : "opacity-0");

  return (
    <div
      role={interactive ? "group" : "img"}
      aria-label={`${scene.name} with ${scene.agents.length} AI agents at work: ${scene.agents.map((a) => a.role.name).join(", ")}`}
      className={cn(
        "relative w-full overflow-hidden bg-muted select-none",
        !ready && "animate-pulse",
        className
      )}
      style={{ containerType: "size", aspectRatio: fit === "contain" ? `${scene.width} / ${scene.height}` : undefined }}
    >
      {/* Soft fill behind the stage for any letterboxing in "cover" mode */}
      {fit === "cover" && (
        <img src={scene.background} alt="" draggable={false} className={cn("absolute inset-0 size-full scale-110 object-cover blur-2xl", fadeIn)} />
      )}

      <div className="absolute" style={stageStyle}>
        <img
          ref={backgroundRef}
          src={scene.background}
          alt=""
          draggable={false}
          onLoad={() => setReady(true)}
          onError={() => setReady(true)}
          className={cn("absolute inset-0 size-full", fadeIn)}
        />

        {scene.agents.map((agent) => (
          <div
            key={agent.id}
            className={cn(
              "absolute transition-[filter] duration-300",
              interactive && "cursor-pointer hover:drop-shadow-[0_0_10px_rgb(255_255_255/0.9)]",
              selectedAgentId === agent.id && "drop-shadow-[0_0_14px_var(--primary)] hover:drop-shadow-[0_0_14px_var(--primary)]"
            )}
            onClick={interactive ? () => onAgentSelect(agent.id) : undefined}
            style={{
              left: pct(agent.x, scene.width),
              top: pct(agent.y, scene.height),
              width: pct(agent.width, scene.width),
              height: pct(agent.height, scene.height),
              zIndex: agent.zIndex,
            }}
          >
            <AgentSprite agent={agent} fps={fps} />
          </div>
        ))}

        {/* Name tags sit in their own layer so a nearer agent never covers another's tag */}
        {scene.agents.map((agent) => (
          <AgentTag
            key={agent.id}
            agent={agent}
            selected={selectedAgentId === agent.id}
            onSelect={onAgentSelect && (() => onAgentSelect(agent.id))}
            status={statuses?.[agent.id]}
            renderPreview={renderPreview}
            style={{ left: pct(agent.x + agent.width * HEAD_X, scene.width), top: pct(agent.y, scene.height) }}
          />
        ))}
      </div>
    </div>
  );
}

function AgentSprite({ agent, fps }: { agent: OfficeAgent; fps: number }) {
  const [frame, setFrame] = useState(0);
  const { frames } = agent;

  useEffect(() => {
    if (frames.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let timer: number | undefined;
    let cancelled = false;

    // Hold the first frame until every frame has decoded, so the loop never blinks to an empty frame.
    // Each agent starts at a random frame so the team doesn't type in lockstep.
    Promise.all(
      frames.map((src) => {
        const image = new Image();
        image.src = src;
        return image.decode().catch(() => undefined);
      })
    ).then(() => {
      if (cancelled) return;
      let current = Math.floor(Math.random() * frames.length);
      setFrame(current);
      timer = window.setInterval(() => {
        current = (current + 1) % frames.length;
        setFrame(current);
      }, 1000 / fps);
    });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [frames, fps]);

  return (
    <>
      {frames.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          className={cn("pointer-events-none absolute inset-0 size-full object-contain", i !== frame && "invisible")}
        />
      ))}
    </>
  );
}

// Speech-bubble tag floating above an agent's head. Text is sized in container units so it scales
// with the office, clamped to stay readable on small screens and tidy on large ones.
// When onSelect is given the tag becomes a button, so the agents are reachable by keyboard too.
// With renderPreview, hovering or focusing the tag also opens a popover with the agent's live status.
function AgentTag({
  agent,
  style,
  selected = false,
  onSelect,
  status,
  renderPreview,
}: {
  agent: OfficeAgent;
  style: React.CSSProperties;
  selected?: boolean;
  onSelect?: () => void;
  status?: AgentLiveStatus;
  renderPreview?: Props["renderPreview"];
}) {
  const [open, setOpen] = useState(false);
  const Pill = onSelect || renderPreview ? "button" : "div";
  const pillProps = {
    ...((onSelect || renderPreview) && { type: "button" as const }),
    ...(onSelect && { onClick: onSelect, "aria-pressed": selected }),
  };
  const pillClass = cn(
    "relative flex items-center gap-[0.4em] rounded-full py-[0.3em] pr-[0.8em] pl-[0.3em] whitespace-nowrap shadow-lg ring-1 backdrop-blur-sm transition-[background-color,color,box-shadow,scale] duration-300",
    selected ? "scale-110 bg-primary text-primary-foreground shadow-primary/40 ring-primary" : "bg-card/95 text-foreground ring-border/70",
    onSelect && "cursor-pointer outline-none hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/60",
    onSelect && selected && "hover:scale-110"
  );
  const tone = status ? STATUS_TONES[status] : null;
  const pillContent = (
    <>
      <span
        aria-hidden
        className={cn(
          "relative flex size-[1.7em] items-center justify-center rounded-full text-[1.05em] leading-none",
          selected ? "bg-primary-foreground/20" : "bg-muted"
        )}
      >
        {agent.role.emoji}
        {/* Live status dot */}
        {tone && (
          <span className={cn("absolute -right-[0.1em] -bottom-[0.1em] size-[0.6em] rounded-full ring-2 ring-card", tone.dot, tone.pulse && "animate-pulse")} />
        )}
      </span>
      <span className="leading-none font-semibold tracking-tight">{agent.role.name}</span>
      {/* Pointer down to the agent */}
      <span
        aria-hidden
        className={cn(
          "absolute top-full left-1/2 size-[0.6em] -translate-x-1/2 -translate-y-1/2 rotate-45 ring-1 transition-colors duration-300 [clip-path:polygon(100%_0,100%_100%,0_100%)]",
          selected ? "bg-primary ring-primary" : "bg-card/95 ring-border/70"
        )}
      />
    </>
  );

  return (
    <div
      title={renderPreview ? undefined : agent.role.description}
      className={cn(
        "absolute -translate-x-1/2 -translate-y-full pb-[0.6em] text-[clamp(9px,1.5cqw,13px)]",
        selected ? "z-[51]" : "z-50"
      )}
      style={style}
    >
      {renderPreview ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger openOnHover delay={150} closeDelay={250} render={<button {...pillProps} className={pillClass} />}>
            {pillContent}
          </PopoverTrigger>
          <PopoverContent side="top" sideOffset={10} className="rounded-2xl p-3 shadow-xl" style={{ width: "18.5rem" }}>
            {renderPreview(agent, () => setOpen(false))}
          </PopoverContent>
        </Popover>
      ) : (
        <Pill {...pillProps} className={pillClass}>
          {pillContent}
        </Pill>
      )}
    </div>
  );
}
