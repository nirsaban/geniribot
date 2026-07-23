"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { landing } from "./copy";

/**
 * Hero section with a live fire animation behind the content.
 *
 * The flames are a WebGL fragment shader: fractal noise scrolled upward and
 * shaped by a vertical falloff, run through a black→ember→orange→gold→white
 * heat ramp, with a horizontal wobble so the flames lick rather than slide.
 * Embers drift up on top. No video file, no external assets.
 *
 * Degrades gracefully — on reduced-motion or missing WebGL the canvas simply
 * stays empty and the CSS ember glow behind it carries the section.
 */
export function HeroFire() {
  const h = landing.hero;

  return (
    <section className="relative isolate overflow-hidden border-b border-white/5 bg-[#05070a]">
      {/* ambient ember glow (also the no-WebGL fallback) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-20 h-2/3 bg-[radial-gradient(ellipse_70%_100%_at_50%_100%,rgba(34,211,238,0.28),transparent_70%)]" />

      {/* the fire */}
      <FireCanvas className="absolute inset-0 -z-10 h-full w-full" />

      {/* keep text legible over the flames */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-[#05070a] via-[#05070a]/55 to-[#05070a]/85" />

      <div className="mx-auto max-w-6xl px-5 pb-28 pt-20 text-center md:pb-36 md:pt-28">
        <span className="inline-flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/90">
          <span className="h-px w-8 bg-cyan-400/50" />
          {landing.eyebrows.hero}
          <span className="h-px w-8 bg-cyan-400/50" />
        </span>

        <h1 className="animate-fade-up mt-6 text-[2.7rem] font-black leading-[0.98] tracking-tight text-white sm:text-6xl md:text-[4.3rem]">
          {h.title}
          <br />
          <span className="bg-gradient-to-t from-cyan-200 via-cyan-400 to-sky-400 bg-clip-text text-transparent drop-shadow-[0_0_28px_rgba(34,211,238,0.45)]">
            {h.titleAccent}
          </span>
        </h1>

        <p className="animate-fade-up mx-auto mt-6 max-w-xl text-lg leading-relaxed text-slate-300/90 [animation-delay:0.1s]">
          {h.subtitle}
        </p>

        <div className="animate-fade-up mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row [animation-delay:0.15s]">
          <Link
            href="/register"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-400 px-8 py-3.5 text-base font-bold text-slate-950 shadow-[0_0_50px_-10px_rgba(34,211,238,0.9)] transition hover:bg-cyan-300"
          >
            {h.ctaPrimary}
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 rotate-180"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
          <a
            href="#pricing"
            className="inline-flex items-center justify-center rounded-lg border border-cyan-200/20 px-8 py-3.5 text-base font-semibold text-white transition hover:border-cyan-200/40 hover:bg-white/5"
          >
            {h.ctaSecondary}
          </a>
        </div>

        <p className="mt-5 text-sm text-slate-500">{h.note}</p>
      </div>
    </section>
  );
}

/* ---------------- the fire ---------------- */

export function FireCanvas({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const rawGl = (cv.getContext("webgl", { alpha: true, antialias: true }) ||
      cv.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!rawGl) return;

    // pin non-null typed locals so narrowing holds inside the render closures
    const canvas: HTMLCanvasElement = cv;
    const gl: WebGLRenderingContext = rawGl;

    const vertSrc = `
      attribute vec2 a_pos;
      void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
    `;

    const fragSrc = `
      precision highp float;
      uniform vec2  u_res;
      uniform float u_time;

      float hash(vec2 p) {
        p = fract(p * vec2(127.13, 311.7));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 6; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
        return v;
      }

      // black -> deep navy ember -> blue -> cyan -> white
      vec3 heatRamp(float h) {
        vec3 c = mix(vec3(0.0, 0.015, 0.03), vec3(0.01, 0.10, 0.22), smoothstep(0.00, 0.32, h));
        c = mix(c, vec3(0.02, 0.42, 0.85), smoothstep(0.28, 0.58, h));
        c = mix(c, vec3(0.20, 0.82, 0.96), smoothstep(0.55, 0.82, h));
        c = mix(c, vec3(0.85, 0.97, 1.00), smoothstep(0.84, 1.00, h));
        return c;
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_res.xy;
        float aspect = u_res.x / u_res.y;
        vec2 p = vec2(uv.x * aspect, uv.y);

        float t = u_time;

        // flames lick sideways instead of sliding straight up
        float wobble = sin(uv.y * 7.0 - t * 1.6) * 0.035 * (1.0 - uv.y);
        p.x += wobble;

        // scroll the noise downward => flames rise
        float n  = fbm(vec2(p.x * 3.2, p.y * 2.4 - t * 1.15));
        float n2 = fbm(vec2(p.x * 6.5 + 4.0, p.y * 4.5 - t * 1.9));
        float f = mix(n, n2, 0.45);

        // vertical falloff: hot at the base, gone by the top
        float shape = pow(clamp(1.0 - uv.y, 0.0, 1.0), 1.5);
        // taper at the left/right edges so it reads as one body of fire
        float sides = smoothstep(0.0, 0.28, uv.x) * smoothstep(1.0, 0.72, uv.x);
        sides = mix(0.55, 1.0, sides);

        float heat = f * shape * sides * 2.35;
        heat *= 0.92 + 0.08 * sin(t * 9.0); // flicker

        vec3 col = heatRamp(clamp(heat, 0.0, 1.0));

        // embers: sparse bright motes drifting upward
        vec2 ep = vec2(p.x * 9.0, p.y * 9.0 - t * 0.9);
        float e = hash(floor(ep));
        float emb = step(0.9975, e) * smoothstep(0.0, 0.55, 1.0 - uv.y);
        col += vec3(0.45, 0.85, 1.0) * emb * 1.4;

        float alpha = clamp(heat * 1.15 + emb, 0.0, 1.0);
        gl_FragColor = vec4(col, alpha);
      }
    `;

    function compile(type: number, src: string) {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }

    const vs = compile(gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    // additive blending so flames glow instead of flattening the background
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    // full-screen triangle
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");

    let raf = 0;
    let start = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function frame(now: number) {
      if (!start) start = now;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
