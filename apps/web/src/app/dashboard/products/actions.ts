"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ProductStatus } from "@kesher/db";
import { prisma } from "@kesher/db";
import { productsLimitReached } from "@/lib/plan";
import { getSession } from "@/lib/session";

async function requireOrg(): Promise<string> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.org;
}

async function ownProduct(org: string, id: string) {
  const p = await prisma.product.findFirst({ where: { id, organizationId: org } });
  if (!p) redirect("/dashboard/products");
  return p;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^\w֐-׿]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "product";
}

/** Unique within the org — appends -2, -3… on collision rather than a random suffix, since this slug is a shareable public URL. */
async function uniqueSlug(org: string, name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  let n = 2;
  while (await prisma.product.findUnique({ where: { organizationId_slug: { organizationId: org, slug } } })) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

/** Create a draft product from just a name, then continue straight to the full editor — same UX as flow creation. */
export async function createProductAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/dashboard/products");

  if (await productsLimitReached(org)) {
    redirect("/dashboard/products?limitReached=1");
  }

  const product = await prisma.product.create({
    data: { organizationId: org, name, slug: await uniqueSlug(org, name) },
  });
  revalidatePath("/dashboard/products");
  redirect(`/dashboard/products/${product.id}/edit`);
}

export async function updateProductAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const product = await ownProduct(org, id);

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priceRaw = String(formData.get("priceIls") ?? "").trim();
  const priceIls = priceRaw ? Math.max(0, Math.round(Number(priceRaw))) : null;

  await prisma.product.update({
    where: { id: product.id },
    data: {
      name: name || product.name,
      description: description || null,
      priceIls: priceRaw && Number.isFinite(priceIls) ? priceIls : null,
    },
  });
  revalidatePath("/dashboard/products");
  revalidatePath(`/dashboard/products/${id}/edit`);
}

export async function setProductStatusAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as ProductStatus;
  if (!["DRAFT", "ACTIVE", "ARCHIVED"].includes(status)) return;
  const product = await ownProduct(org, id);
  await prisma.product.update({ where: { id: product.id }, data: { status } });
  revalidatePath("/dashboard/products");
  revalidatePath(`/dashboard/products/${id}/edit`);
}

/**
 * Permanently delete a product. Leads and flows keep their history; only the
 * live link is cleared (same pattern as `deleteFlowAction`) so filters and
 * schema lookups don't point at a row that no longer exists.
 */
export async function deleteProductAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const product = await ownProduct(org, id);
  await prisma.$transaction([
    prisma.contact.updateMany({ where: { organizationId: org, productId: product.id }, data: { productId: null } }),
    prisma.conversation.updateMany({
      where: { organizationId: org, productId: product.id },
      data: { productId: null },
    }),
    prisma.flow.updateMany({ where: { organizationId: org, productId: product.id }, data: { productId: null } }),
    prisma.product.delete({ where: { id: product.id } }),
  ]);
  revalidatePath("/dashboard/products");
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/flows");
}
