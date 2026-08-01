"use client";

import { useRef, useState } from "react";
import { withBase } from "@/lib/basePath";
import { signProductUpload, uploadToCloudinary } from "@/lib/client/cloudinaryUpload";

/** Direct browser→Cloudinary upload of product photos (server only signs, never proxies the file). */
export function ProductImageUploader({
  productId,
  images,
  onChanged,
}: {
  productId: string;
  images: string[];
  onChanged: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(file: File) {
    setError(null);
    const signed = await signProductUpload(productId);
    if ("error" in signed) {
      setError(signed.error === "not_configured" ? "העלאת תמונות אינה מוגדרת" : "ההעלאה נכשלה");
      return;
    }

    setProgress(0);
    let result;
    try {
      result = await uploadToCloudinary(file, signed.sign, setProgress);
    } catch {
      setError("ההעלאה נכשלה");
      setProgress(null);
      return;
    }
    setProgress(null);

    try {
      const res = await fetch(withBase(`/api/products/${productId}/images`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: result.secure_url }),
      });
      if (!res.ok) throw new Error();
      onChanged();
    } catch {
      setError("ההעלאה נכשלה");
    }
  }

  async function handleRemove(url: string) {
    setError(null);
    try {
      const res = await fetch(withBase(`/api/products/${productId}/images`), {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) throw new Error();
      onChanged();
    } catch {
      setError("המחיקה נכשלה");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) handleSelect(file);
          }}
        />
        <button
          type="button"
          disabled={progress !== null}
          onClick={() => fileInput.current?.click()}
          className="btn-secondary btn-sm"
        >
          📷 הוספת תמונה
        </button>
      </div>

      {progress !== null && (
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-brand transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted">{progress}%</span>
        </div>
      )}

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((url) => (
            <div key={url} className="group relative aspect-square overflow-hidden rounded-xl border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => handleRemove(url)}
                aria-label="מחיקת תמונה"
                className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white opacity-0 transition group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
