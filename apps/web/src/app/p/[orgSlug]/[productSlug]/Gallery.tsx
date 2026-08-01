"use client";

import { useState } from "react";

/**
 * Product image gallery for the public product page — a main image plus a
 * thumbnail strip. Purely presentational client state (which image is
 * active); no data fetching. Renders a placeholder when the product has no
 * images at all rather than an empty box.
 */
export function Gallery({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-2xl border border-white/8 bg-white/[0.02] text-slate-600">
        <PlaceholderIcon />
      </div>
    );
  }

  const current = images[Math.min(active, images.length - 1)];

  return (
    <div>
      <div className="aspect-square w-full overflow-hidden rounded-2xl border border-white/8 bg-white/[0.02]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current} alt={alt} className="h-full w-full object-cover" />
      </div>
      {images.length > 1 && (
        <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <button
              key={`${src}-${i}`}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`תמונה ${i + 1}`}
              className={[
                "h-16 w-16 flex-none overflow-hidden rounded-xl border transition",
                i === active ? "border-cyan-400" : "border-white/10 opacity-60 hover:opacity-100",
              ].join(" ")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PlaceholderIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-14 w-14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}
