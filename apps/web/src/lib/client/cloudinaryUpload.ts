"use client";

import { withBase } from "@/lib/basePath";

export interface ProductUploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
}

export interface CloudinaryUploadResult {
  secure_url: string;
}

/** Ask our API to sign a direct upload into this product's Cloudinary folder. */
export async function signProductUpload(
  productId: string,
): Promise<{ sign: ProductUploadSignature } | { error: "not_configured" | "failed" }> {
  const res = await fetch(withBase(`/api/products/${productId}/sign-upload`), {
    method: "POST",
  });
  if (res.status === 503) return { error: "not_configured" };
  if (!res.ok) return { error: "failed" };
  return { sign: await res.json() };
}

/** Direct browser→Cloudinary upload with progress callback (server never sees the file). */
export function uploadToCloudinary(
  file: File,
  sign: ProductUploadSignature,
  onProgress: (pct: number) => void,
): Promise<CloudinaryUploadResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", sign.apiKey);
  form.append("timestamp", String(sign.timestamp));
  form.append("signature", sign.signature);
  form.append("folder", sign.folder);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${sign.cloudName}/image/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else reject(new Error(`upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("upload failed"));
    xhr.send(form);
  });
}
