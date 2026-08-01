import { getCloudinary, productFolder } from "./client";

export interface ProductUploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
}

/**
 * Server-side signature for a direct browser→Cloudinary upload of a product
 * image. The folder is pinned into the signature, so the client cannot
 * upload outside this product's folder. Product images are public marketing
 * assets, so this uses the default `type: upload` (still a signed upload for
 * auth, just publicly readable afterward) — unlike private/authenticated media.
 */
export function signProductImageUpload(orgId: string, productId: string): ProductUploadSignature {
  const cld = getCloudinary();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = productFolder(orgId, productId);
  const signature = cld.utils.api_sign_request(
    { timestamp, folder },
    process.env.CLOUDINARY_API_SECRET!,
  );
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
    apiKey: process.env.CLOUDINARY_API_KEY!,
    timestamp,
    signature,
    folder,
  };
}
