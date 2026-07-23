"use client";

import { useEffect, useRef } from "react";

/**
 * Cinematic particle-network backdrop (NOVI style): electric-cyan nodes that
 * drift slowly and connect with hairline links when close, plus a soft mouse
 * parallax. Purely decorative — sits behind the hero. Respects reduced-motion.
 */
export function ParticleField({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const context = el.getContext("2d");
    if (!context) return;
    // pin non-null typed locals so narrowing holds inside the render closures
    const canvas: HTMLCanvasElement = el;
    const ctx: CanvasRenderingContext2D = context;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let raf = 0;

    type P = { x: number; y: number; vx: number; vy: number; r: number };
    let pts: P[] = [];
    const mouse = { x: -9999, y: -9999 };

    function resize() {
      const parent = canvas.parentElement;
      w = parent?.clientWidth ?? window.innerWidth;
      h = parent?.clientHeight ?? window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const density = Math.min(90, Math.max(36, Math.floor((w * h) / 16000)));
      pts = Array.from({ length: density }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.6 + 0.6,
      }));
    }

    function step() {
      ctx.clearRect(0, 0, w, h);

      for (const p of pts) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;

        // gentle pull toward the cursor
        const dxm = mouse.x - p.x;
        const dym = mouse.y - p.y;
        const dm2 = dxm * dxm + dym * dym;
        if (dm2 < 130 * 130) {
          p.x += dxm * 0.0009;
          p.y += dym * 0.0009;
        }
      }

      // links
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i];
          const b = pts[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          const max = 120;
          if (d2 < max * max) {
            const alpha = (1 - Math.sqrt(d2) / max) * 0.28;
            ctx.strokeStyle = `rgba(34,211,238,${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // nodes
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(103,232,249,0.9)";
        ctx.shadowColor = "rgba(34,211,238,0.9)";
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      raf = requestAnimationFrame(step);
    }

    function onMove(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    }
    function onLeave() {
      mouse.x = -9999;
      mouse.y = -9999;
    }

    resize();
    if (reduced) {
      // one static frame, no animation loop
      step();
      cancelAnimationFrame(raf);
    } else {
      raf = requestAnimationFrame(step);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseleave", onLeave);
    }
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
