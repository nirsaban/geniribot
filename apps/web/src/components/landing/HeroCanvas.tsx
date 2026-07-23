"use client";

import { useEffect, useRef } from "react";

/**
 * Cinematic WebGL hero backdrop — a domain-warped fBm "energy field" that flows
 * like liquid light in electric cyan over near-black, masked to a single
 * top-center glow to match the NOVI aesthetic. Slow mouse parallax. This is the
 * "video-like" layer: 60fps generative motion, no video file.
 *
 * Degrades gracefully: on WebGL failure or reduced-motion it renders nothing
 * (the CSS ambient glow + the particle network on top still carry the hero).
 */
export function HeroCanvas({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const rawGl = (cv.getContext("webgl", { antialias: true, alpha: true }) ||
      cv.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!rawGl) return; // fallback: CSS glow + particle network remain

    // pin non-null typed locals so narrowing holds inside the render closures
    const canvas: HTMLCanvasElement = cv;
    const gl: WebGLRenderingContext = rawGl;

    const vertSrc = `
      attribute vec2 a_pos;
      void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
    `;

    const fragSrc = `
      precision highp float;
      uniform vec2 u_res;
      uniform float u_time;
      uniform vec2 u_mouse;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 345.45));
        p += dot(p, p + 34.345);
        return fract(p.x * p.y);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          v += a * noise(p);
          p *= 2.0;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_res.xy;
        float aspect = u_res.x / u_res.y;
        vec2 p = uv;
        p.x *= aspect;
        p += (u_mouse - 0.5) * 0.12;

        float t = u_time * 0.05;
        // domain warping → flowing, liquid motion
        vec2 q = vec2(fbm(p * 1.6 + vec2(0.0, t)), fbm(p * 1.6 + vec2(5.2, -t)));
        vec2 r = vec2(
          fbm(p * 1.6 + 2.0 * q + vec2(1.7, 9.2) + t * 0.6),
          fbm(p * 1.6 + 2.0 * q + vec2(8.3, 2.8) - t * 0.6)
        );
        float f = fbm(p * 1.6 + 2.4 * r);

        float energy = smoothstep(0.35, 0.85, f);

        vec3 dark = vec3(0.015, 0.03, 0.04);
        vec3 cyan = vec3(0.13, 0.82, 0.92);
        vec3 ice  = vec3(0.62, 0.95, 1.0);
        vec3 col = mix(dark, cyan, energy);
        col = mix(col, ice, smoothstep(0.78, 1.0, f) * 0.7);

        // filament highlights
        float fil = smoothstep(0.55, 0.6, f) - smoothstep(0.6, 0.66, f);
        col += ice * fil * 0.5;

        // single top-center glow mask
        vec2 c = uv - vec2(0.5, 0.12);
        c.x *= aspect;
        float d = length(c);
        float mask = smoothstep(1.15, 0.05, d);
        col *= mask;

        col *= 0.92;
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    function compile(type: number, src: string) {
      const sh = gl.createShader(type)!;
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

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    // full-screen triangle
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uMouse = gl.getUniformLocation(prog, "u_mouse");

    const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
    let raf = 0;
    let start = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function frame(now: number) {
      if (!start) start = now;
      // ease mouse toward target for smooth parallax
      mouse.x += (mouse.tx - mouse.x) * 0.04;
      mouse.y += (mouse.ty - mouse.y) * 0.04;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    }

    function onMove(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      mouse.tx = (e.clientX - rect.left) / rect.width;
      mouse.ty = 1 - (e.clientY - rect.top) / rect.height;
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      const ext = gl.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
