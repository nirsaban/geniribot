"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { from: "bot" | "them"; text: string };

/**
 * Animated WhatsApp-style chat demo: messages appear one by one, each preceded
 * by a brief typing indicator, giving the hero a "live conversation" feel.
 * Loops. Starts once scrolled into view. Respects reduced-motion (shows all).
 */
export function TypingChat({
  messages,
  caption,
  appName,
}: {
  messages: readonly Msg[];
  caption: string;
  appName: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [count, setCount] = useState(0); // how many bubbles are shown
  const [typing, setTyping] = useState<null | "bot" | "them">(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setCount(messages.length);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setStarted(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [messages.length]);

  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function schedule(fn: () => void, ms: number) {
      timers.push(setTimeout(() => !cancelled && fn(), ms));
    }

    function run() {
      setCount(0);
      let delay = 500;
      messages.forEach((m, i) => {
        schedule(() => setTyping(m.from), delay);
        delay += 900;
        schedule(() => {
          setTyping(null);
          setCount(i + 1);
        }, delay);
        delay += 700;
      });
      // pause, then loop
      schedule(() => {
        setTyping(null);
        run();
      }, delay + 3200);
    }
    run();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [started, messages]);

  return (
    <div
      ref={ref}
      className="mx-auto w-full max-w-sm rounded-2xl border border-cyan-400/15 bg-[#080b10]/80 p-4 shadow-[0_0_60px_-20px_rgba(34,211,238,0.5)] backdrop-blur"
    >
      <div className="mb-3 flex items-center gap-3 border-b border-white/5 pb-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-300">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.7-1.2A9 9 0 1 0 12 3Z" />
          </svg>
        </span>
        <div className="text-right">
          <p className="text-sm font-semibold text-white">{appName}</p>
          <p className="text-xs text-emerald-400">● מחובר</p>
        </div>
      </div>

      <div className="flex min-h-[220px] flex-col justify-end space-y-2">
        {messages.slice(0, count).map((m, i) => (
          <div key={i} className={m.from === "bot" ? "flex justify-start" : "flex justify-end"}>
            <div
              className={[
                "animate-pop max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                m.from === "bot"
                  ? "rounded-bl-sm bg-cyan-500/15 text-cyan-50"
                  : "rounded-br-sm bg-white/10 text-slate-100",
              ].join(" ")}
            >
              {m.text}
            </div>
          </div>
        ))}
        {typing && (
          <div className={typing === "bot" ? "flex justify-start" : "flex justify-end"}>
            <div
              className={[
                "flex gap-1 rounded-2xl px-3.5 py-3",
                typing === "bot" ? "rounded-bl-sm bg-cyan-500/15" : "rounded-br-sm bg-white/10",
              ].join(" ")}
              aria-label="מקליד/ה…"
            >
              <Dot /> <Dot delay={0.15} /> <Dot delay={0.3} />
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.3 3.29 6.8-6.8a1 1 0 0 1 1.4 0Z"
            clipRule="evenodd"
          />
        </svg>
        {caption}
      </div>
    </div>
  );
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300/80"
      style={{ animationDelay: `${delay}s`, animationDuration: "0.9s" }}
    />
  );
}
