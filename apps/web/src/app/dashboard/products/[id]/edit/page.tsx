import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { Card } from "@/components/ui";
import { withBase } from "@/lib/basePath";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import { createFlowAction } from "../../../flows/actions";
import { deleteProductAction, setProductStatusAction, updateProductAction } from "../../actions";
import { ImagesPanel } from "./ImagesPanel";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: he.productStatusDraft,
  ACTIVE: he.productStatusActive,
  ARCHIVED: he.productStatusArchived,
};

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;

  const [product, org, flows, leadsCount] = await Promise.all([
    prisma.product.findFirst({ where: { id, organizationId: session.org } }),
    prisma.organization.findUnique({ where: { id: session.org }, select: { slug: true } }),
    prisma.flow.findMany({
      where: { organizationId: session.org, productId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, isActive: true },
    }),
    prisma.contact.count({ where: { organizationId: session.org, productId: id } }),
  ]);
  if (!product) notFound();

  const base = process.env.PUBLIC_BASE_URL ?? "https://wabot.miltech.cloud";
  const publicUrl = org ? `${base}${withBase(`/p/${org.slug}/${product.slug}`)}` : null;

  return (
    <>
      <Link href="/dashboard/products" className="text-sm font-medium text-brand">
        {he.backToProducts}
      </Link>
      <h1 className="mb-5 mt-2 text-2xl font-bold text-ink">{product.name}</h1>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold text-ink">{he.productDetailsTitle}</h2>
          <form action={updateProductAction} className="space-y-3">
            <input type="hidden" name="id" value={product.id} />
            <label className="block">
              <span className="label">{he.productNameLabel}</span>
              <input name="name" defaultValue={product.name} required className="input mt-0.5 w-full" />
            </label>
            <label className="block">
              <span className="label">{he.productDescriptionLabel}</span>
              <textarea
                name="description"
                defaultValue={product.description ?? ""}
                rows={4}
                className="input mt-0.5 w-full"
              />
            </label>
            <label className="block">
              <span className="label">{he.productPriceLabel}</span>
              <input
                name="priceIls"
                type="number"
                min={0}
                defaultValue={product.priceIls ?? ""}
                dir="ltr"
                className="input mt-0.5 w-full text-left"
              />
            </label>
            <button className="btn-primary btn-sm">{he.saveProduct}</button>
          </form>

          <div className="mt-5 border-t border-line pt-4">
            <span className="label">{he.productStatusLabel}</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["DRAFT", "ACTIVE", "ARCHIVED"] as const).map((s) => (
                <form action={setProductStatusAction} key={s}>
                  <input type="hidden" name="id" value={product.id} />
                  <input type="hidden" name="status" value={s} />
                  <button
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                      product.status === s
                        ? "border-brand bg-brand/10 text-brand-dark"
                        : "border-line text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                </form>
              ))}
            </div>
          </div>

          {publicUrl && (
            <div className="mt-5 border-t border-line pt-4">
              <span className="label">{he.productPublicLinkTitle}</span>
              <p className="mb-1 text-xs text-slate-400">{he.productPublicLinkHint}</p>
              <a href={publicUrl} target="_blank" rel="noreferrer" className="break-all text-sm text-brand" dir="ltr">
                {publicUrl}
              </a>
            </div>
          )}

          <div className="mt-5 border-t border-line pt-4">
            <form action={deleteProductAction}>
              <input type="hidden" name="id" value={product.id} />
              <button className="btn-danger btn-sm">🗑 {he.deleteProduct}</button>
            </form>
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <h2 className="mb-3 font-semibold text-ink">{he.productImagesTitle}</h2>
            <ImagesPanel productId={product.id} images={product.images} />
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-ink">{he.productFlowsTitle}</h2>
              <form action={createFlowAction}>
                <input type="hidden" name="template" value="lead" />
                <input type="hidden" name="productId" value={product.id} />
                <button className="btn-secondary btn-sm">{he.productAddFlow}</button>
              </form>
            </div>
            {flows.length === 0 ? (
              <p className="text-sm text-slate-400">{he.productNoFlows}</p>
            ) : (
              <ul className="space-y-2">
                {flows.map((f) => (
                  <li key={f.id} className="flex items-center justify-between text-sm">
                    <Link href={`/dashboard/flows/${f.id}/edit`} className="text-ink hover:text-brand">
                      {f.name}
                    </Link>
                    <span className={f.isActive ? "badge-green" : "badge-gray"}>
                      {f.isActive ? he.active : he.inactive}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-ink">{he.productLeadsTitle}</h2>
              <span className="text-sm text-slate-500">{leadsCount}</span>
            </div>
            <Link
              href={`/dashboard/leads?product=${product.id}`}
              className="btn-secondary btn-sm mt-3 inline-block"
            >
              {he.productViewLeads}
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
}
