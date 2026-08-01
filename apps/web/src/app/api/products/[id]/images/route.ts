import { NextResponse } from "next/server";
import { prisma } from "@kesher/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * A URL a client asks us to persist must actually be a Cloudinary-hosted
 * secure delivery URL — otherwise a client could get us to store an
 * arbitrary (or malicious) URL on the product's public image list.
 */
function isTrustedCloudinaryUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname === "res.cloudinary.com") return true;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (cloudName && parsed.hostname === `${cloudName}-res.cloudinary.com`) return true;
  return false;
}

async function loadOwnedProduct(id: string, orgId: string) {
  return prisma.product.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, images: true },
  });
}

/** Appends a Cloudinary secure_url onto this product's images array. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { url } = (await req.json()) as { url?: string };
  if (!url || !isTrustedCloudinaryUrl(url)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const { id } = await params;
  const product = await loadOwnedProduct(id, session.org);
  if (!product) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const images = product.images.includes(url) ? product.images : [...product.images, url];
  const updated = await prisma.product.update({
    where: { id: product.id },
    data: { images },
    select: { images: true },
  });

  return NextResponse.json({ images: updated.images });
}

/** Removes a URL from this product's images array. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { url } = (await req.json()) as { url?: string };
  if (!url) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const { id } = await params;
  const product = await loadOwnedProduct(id, session.org);
  if (!product) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const images = product.images.filter((existing) => existing !== url);
  const updated = await prisma.product.update({
    where: { id: product.id },
    data: { images },
    select: { images: true },
  });

  return NextResponse.json({ images: updated.images });
}
