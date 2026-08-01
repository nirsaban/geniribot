import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { he } from "@/lib/he";
import { getPlanCatalog } from "@/lib/plan";
import { getSession } from "@/lib/session";
import { createProductAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "badge-gray",
  ACTIVE: "badge-green",
  ARCHIVED: "badge-gray",
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "טיוטה",
  ACTIVE: "פעיל",
  ARCHIVED: "בארכיון",
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ limitReached?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { limitReached } = await searchParams;

  const [products, catalog, productCount] = await Promise.all([
    prisma.product.findMany({
      where: { organizationId: session.org },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { flows: true, contacts: true } },
      },
    }),
    getPlanCatalog(),
    prisma.product.count({ where: { organizationId: session.org } }),
  ]);
  const org = await prisma.organization.findUnique({ where: { id: session.org }, select: { plan: true, slug: true } });
  const limit = org ? catalog[org.plan].limits.products : 0;

  return (
    <>
      <PageHeader
        title={he.productsTitle}
        subtitle={he.productsSubtitle}
        action={
          <form action={createProductAction} className="flex items-center gap-2">
            <input
              name="name"
              required
              placeholder={he.productNamePlaceholder}
              className="input"
              dir="rtl"
            />
            <button className="btn-primary shrink-0">+ {he.newProduct}</button>
          </form>
        }
      />

      {limitReached && (
        <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          {he.productsLimitReached} ({productCount}/{limit})
        </div>
      )}

      {products.length === 0 ? (
        <EmptyState icon="🛍️" title={he.noProducts} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <Card key={p.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-ink">{p.name}</div>
                  {p.priceIls !== null && (
                    <div className="mt-0.5 text-sm text-slate-500">₪{p.priceIls.toLocaleString("he-IL")}</div>
                  )}
                </div>
                <span className={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</span>
              </div>
              {p.images[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.images[0]} alt={p.name} className="h-32 w-full rounded-lg object-cover" />
              )}
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span>🧩 {p._count.flows} {he.productFlowsCount}</span>
                <span>👥 {p._count.contacts} {he.productLeadsCount}</span>
              </div>
              <Link href={`/dashboard/products/${p.id}/edit`} className="btn-secondary btn-sm mt-auto w-full">
                {he.editProduct}
              </Link>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
