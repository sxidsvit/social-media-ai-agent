"use client";

/* eslint-disable @next/next/no-img-element -- previews are remote ImageKit / storage URLs of any size */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { LoaderCircle, SendHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { thumbnail } from "@/components/agents/task-results";
import type { ChatState, WorkspaceAgent } from "@/components/agents/agent-workspace";

// failed: an error notice or cut-off reply, shown in the chat but not sent back as context
export type ChatMessage = { id: string; from: "user" | "agent"; text: string; createdAt: Date; failed?: boolean };

export function AgentChat({
  agent,
  chat,
  typing,
  paused,
  onSend,
  onLoadOlder,
  userInitials,
  notice,
}: {
  agent: WorkspaceAgent;
  chat: ChatState;
  typing: boolean;
  paused: boolean;
  onSend: (text: string) => void;
  // Fetches the next older page (or retries the first one)
  onLoadOlder: () => void;
  userInitials: string;
  // Shown just above the message box (the Master Agent's running plans, or a hint for workers)
  notice?: React.ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const { role } = agent;
  const master = role.id === "master";
  const { messages, loaded, loading, error } = chat;
  const hasMore = loaded && chat.nextCursor !== null;
  const firstId = messages[0]?.id;
  const last = messages.at(-1);

  // After each render: if an older page was added on top, keep the view on what the user was
  // reading; otherwise keep the latest message in view, including while a reply streams in
  const snapshotRef = useRef<{ firstId?: string; lastId?: string; lastText?: string; typing: boolean; height: number }>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const before = snapshotRef.current;
    if (before?.firstId && firstId !== before.firstId && last?.id === before.lastId) {
      el.scrollTop += el.scrollHeight - before.height;
    } else if (!before || last?.id !== before.lastId || last?.text !== before.lastText || typing !== before.typing) {
      // Jump straight to the bottom when the chat first shows, glide for new messages
      el.scrollTo({ top: el.scrollHeight, behavior: before?.lastId ? "smooth" : "auto" });
    }
    snapshotRef.current = { firstId, lastId: last?.id, lastText: last?.text, typing, height: el.scrollHeight };
  });

  // Scrolling near the top loads the next older page. Re-observing after each page means a page
  // that doesn't fill the view loads the next one right away.
  const loadOlderRef = useRef(onLoadOlder);
  useEffect(() => {
    loadOlderRef.current = onLoadOlder;
  });
  useEffect(() => {
    const root = scrollRef.current;
    const target = topRef.current;
    if (!root || !target || !hasMore || loading || error) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadOlderRef.current();
      },
      { root, rootMargin: "120px 0px 0px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loading, error, firstId]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || paused || typing || !loaded) return;
    onSend(text);
    setDraft("");
  }

  return (
    <>
      {/* Scroll position is managed by hand when older messages are added, so opt out of anchoring */}
      <div
        ref={scrollRef}
        className="flex h-[26rem] flex-col gap-4 overflow-y-auto py-4 pr-1 [overflow-anchor:none] lg:h-auto lg:min-h-0 lg:flex-1"
      >
        {loaded && !hasMore ? (
          // The start of the conversation
          <Bubble from="agent" agent={agent}>
            {master ? (
              <>
                <p>Hi! I&apos;m your Master Agent. I coordinate your AI team.</p>
                <p className="mt-2">
                  Tell me what you need, like &quot;Plan a week of Instagram posts about our launch&quot;. I&apos;ll break it into tasks,
                  assign them to the right agents, check their work and report back here.
                </p>
              </>
            ) : (
              <>
                <p>Hi! I&apos;m your {role.name}. {role.description}.</p>
                <p className="mt-2">
                  I take my tasks from the Master Agent, but you can ask me anything about my work here.
                </p>
              </>
            )}
          </Bubble>
        ) : (
          <div ref={topRef} className="flex h-8 shrink-0 items-center justify-center text-xs text-muted-foreground">
            {error ? (
              <span>
                {error}{" "}
                <button type="button" onClick={onLoadOlder} className="font-medium text-primary underline-offset-2 hover:underline">
                  Try again
                </button>
              </span>
            ) : (
              (loading || !loaded) && <LoaderCircle className="size-4 animate-spin" aria-label="Loading messages" />
            )}
          </div>
        )}

        {messages.map((message) => (
          <Bubble key={message.id} from={message.from} agent={agent} userInitials={userInitials} time={message.createdAt} failed={message.failed}>
            <MessageBody text={message.text} />
          </Bubble>
        ))}

        {typing && (
          <div className="flex items-end gap-3" aria-live="polite">
            <AgentAvatar role={role} sprite={agent.sprite} className="size-9" />
            <span className="flex gap-1 rounded-2xl bg-muted px-3.5 py-3" aria-label={`${role.name} is typing`}>
              {[0, 150, 300].map((delay) => (
                <span key={delay} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </span>
          </div>
        )}
      </div>

      {notice}

      <form
        onSubmit={submit}
        className="flex items-center gap-2 rounded-2xl bg-card p-2 pl-4 ring-1 ring-border/70 transition-shadow focus-within:ring-2 focus-within:ring-ring/40"
      >
        <label htmlFor="agent-task" className="sr-only">
          Message for {role.name}
        </label>
        <input
          id="agent-task"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={paused || !loaded}
          autoComplete="off"
          placeholder={
            paused
              ? `${role.name} is paused — resume it to chat`
              : master
                ? "Tell the Master Agent what you need…"
                : `Ask the ${role.name} a question…`
          }
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={paused || typing || !loaded || !draft.trim()}
          aria-label="Send message"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-[translate,opacity,box-shadow] outline-none hover:-translate-y-px focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none"
        >
          <SendHorizontal className="size-4" />
        </button>
      </form>
    </>
  );
}

// Image links (bare, or as markdown images) in a message, like the ones posted when an agent
// makes an image. Requires the file extension, so a half-streamed URL isn't matched.
const IMAGE_URL = /!\[[^\]]*\]\((https?:\/\/[^\s)]+?\.(?:png|jpe?g|webp|gif|avif)(?:\?[^\s)]*)?)\)|https?:\/\/[^\s)\]]+?\.(?:png|jpe?g|webp|gif|avif)(?:\?[^\s)\]]*)?(?=[\s)\].,]|$)/gi;

// The message text with its image links shown as small previews underneath
function MessageBody({ text }: { text: string }) {
  const images = [...new Set([...text.matchAll(IMAGE_URL)].map((match) => match[1] ?? match[0]))];
  if (images.length === 0) return text;
  const rest = text
    .replace(IMAGE_URL, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return (
    <>
      {rest}
      <span className={cn("flex flex-wrap gap-2", rest && "mt-2")}>
        {images.map((url) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-xl ring-1 ring-border/70 transition-opacity hover:opacity-90"
          >
            <img src={thumbnail(url, 320)} alt="Generated image" loading="lazy" className="size-40 bg-background object-cover" />
          </a>
        ))}
      </span>
    </>
  );
}

function Bubble({
  from,
  agent,
  userInitials,
  time,
  failed,
  children,
}: {
  from: ChatMessage["from"];
  agent: WorkspaceAgent;
  userInitials?: string;
  time?: Date;
  failed?: boolean;
  children: React.ReactNode;
}) {
  const mine = from === "user";
  return (
    <div className={cn("flex animate-in items-start gap-3 duration-300 fade-in-0 slide-in-from-bottom-1", mine && "flex-row-reverse")}>
      {mine ? (
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-indigo-500 to-violet-600 text-xs font-semibold text-white">
          {userInitials}
        </span>
      ) : (
        <AgentAvatar role={agent.role} sprite={agent.sprite} className="size-9" />
      )}
      <div className={cn("flex max-w-[80%] flex-col gap-1", mine && "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
            mine ? "rounded-tr-md bg-primary/10 text-foreground dark:bg-primary/20" : "rounded-tl-md bg-muted",
            failed && "bg-destructive/10 text-destructive"
          )}
        >
          {children}
        </div>
        {time && (
          <time dateTime={time.toISOString()} className="px-1 text-[11px] text-muted-foreground">
            {format(time, "h:mm a")}
          </time>
        )}
      </div>
    </div>
  );
}
