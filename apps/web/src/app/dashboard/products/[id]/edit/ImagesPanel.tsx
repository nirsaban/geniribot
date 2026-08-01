"use client";

import { useRouter } from "next/navigation";
import { ProductImageUploader } from "../../ProductImageUploader";

/** Thin client wrapper: re-renders the server page's `images` once an upload/delete completes. */
export function ImagesPanel({ productId, images }: { productId: string; images: string[] }) {
  const router = useRouter();
  return <ProductImageUploader productId={productId} images={images} onChanged={() => router.refresh()} />;
}
