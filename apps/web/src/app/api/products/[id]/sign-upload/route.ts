import { NextResponse } from "next/server";
import { prisma } from "@kesher/db";
import { getSession } from "@/lib/session";
import { isCloudinaryConfigured } from "@/lib/cloudinary/client";
import { signProductImageUpload } from "@/lib/cloudinary/sign-upload";

export const dynamic = "force-dynamic";

/**
 * Signs a direct browser→Cloudinary upload for a product image. The
 * signature pins the org/product folder, so the file itself never passes
 * through this server and can't land outside the product's prefix.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const product = await prisma.product.findFirst({
    where: { id, organizationId: session.org },
    select: { id: true },
  });
  if (!product) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!isCloudinaryConfigured()) {
    return NextResponse.json({ error: "cloudinary_not_configured" }, { status: 503 });
  }

  return NextResponse.json(signProductImageUpload(session.org, product.id));
}
