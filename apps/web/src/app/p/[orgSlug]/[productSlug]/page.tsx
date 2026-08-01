import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@kesher/db";
import { FlowDefinition } from "@kesher/flow-engine";
import { normalizePhone } from "@/lib/audience";
import { Reveal } from "@/components/landing/Reveal";
import { Gallery } from "./Gallery";

// Public, unauthenticated product landing page — one Product, deep-linking
// straight into a WhatsApp chat that triggers that product's Flow. Reached
// from Instagram bio links / ads, so it must render standalone (no session,
// no dashboard chrome) and always fresh (product status/price can change).
export const dynamic = "force-dynamic";

type PageParams = { orgSlug: string; productSlug: string };

/**
 * Next's dynamic route params come back still percent-encoded for non-ASCII
 * segments (e.g. Hebrew slugs) rather than decoded — decode defensively;
 * a plain ASCII slug round-trips through decodeURIComponent unchanged.
 */
function decodeSlug(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function loadProduct(orgSlug: string, productSlug: string) {
  const org = await prisma.organization.findUnique({ where: { slug: decodeSlug(orgSlug) } });
  if (!org) return null;
  const product = await prisma.product.findFirst({
    where: { organizationId: org.id, slug: decodeSlug(productSlug), status: "ACTIVE" },
  });
  if (!product) return null;
  return { org, product };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { orgSlug, productSlug } = await params;
  const data = await loadProduct(orgSlug, productSlug);
  if (!data) return { title: "המוצר לא נמצא" };
  const { org, product } = data;

  const title = `${product.name} — ${org.name}`;
  const description = product.description
    ? product.description.slice(0, 160)
    : `${product.name} מאת ${org.name}`;
  const image = product.images[0];

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      ...(image ? { images: [{ url: image }] } : {}),
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { orgSlug, productSlug } = await params;
  const data = await loadProduct(orgSlug, productSlug);
  if (!data) notFound();
  const { org, product } = data;

  const [connection, flow] = await Promise.all([
    prisma.whatsAppConnection.findFirst({
      where: { organizationId: org.id, status: "CONNECTED" },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.flow.findFirst({
      where: { productId: product.id, isActive: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const rawPhone = connection?.displayPhoneNumber || connection?.phoneNumber || null;
  const phone = rawPhone ? normalizePhone(rawPhone) : null;

  // Prefer the linked flow's own keyword trigger so the deep-link message
  // actually starts that flow; fall back to a generic "interested in X".
  let keyword: string | null = null;
  if (flow) {
    const parsed = FlowDefinition.safeParse(flow.definition);
    if (parsed.success && parsed.data.trigger?.type === "keyword") {
      keyword = parsed.data.trigger.keywords?.find((k) => k.trim())?.trim() ?? null;
    }
  }
  const prefilled = keyword ? `מעוניין ב${keyword}` : `אני מעוניין/ת ב${product.name}`;
  const waHref = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(prefilled)}` : null;

  const price =
    product.priceIls != null ? `₪${product.priceIls.toLocaleString("he-IL")}` : "צור/י קשר למחיר";

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#05070a] text-slate-300 antialiased">
      <Ambience />

      <header className="relative z-10 border-b border-white/5">
        <div className="mx-auto max-w-5xl px-5 py-5">
          <span className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300/90">
            {org.name}
          </span>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-5 py-12 md:py-20">
        <div className="grid gap-10 md:grid-cols-2 md:gap-14">
          <Reveal>
            <Gallery images={product.images} alt={product.name} />
          </Reveal>

          <Reveal delay={100}>
            <h1 className="text-3xl font-black leading-tight tracking-tight text-white md:text-4xl">
              {product.name}
            </h1>
            <p className="mt-4 bg-gradient-to-l from-cyan-200 via-cyan-400 to-sky-400 bg-clip-text text-2xl font-extrabold text-transparent">
              {price}
            </p>

            {product.description && (
              <p className="mt-6 whitespace-pre-line text-base leading-relaxed text-slate-400">
                {product.description}
              </p>
            )}

            <div className="mt-9">
              {waHref ? (
                <a
                  href={waHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-400 px-7 py-3.5 text-base font-bold text-slate-950 shadow-[0_0_44px_-10px_rgba(34,211,238,0.9)] transition hover:bg-cyan-300"
                >
                  <WhatsAppIcon />
                  לשיחה בוואטסאפ
                </a>
              ) : (
                <p className="max-w-sm rounded-lg border border-white/10 bg-white/[0.03] px-5 py-3.5 text-sm leading-relaxed text-slate-400">
                  יצירת קשר בוואטסאפ אינה זמינה כרגע לעסק הזה. נסו שוב מאוחר יותר.
                </p>
              )}
            </div>
          </Reveal>
        </div>
      </main>

      <footer className="relative z-10 border-t border-white/5 py-8 text-center text-xs text-slate-600">
        {org.name}
      </footer>
    </div>
  );
}

/* ---------------- ambient background (matches the main landing page) ---------------- */
function Ambience() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[40rem] overflow-hidden">
      <div
        className="absolute -top-40 left-1/2 h-[40rem] w-[60rem] -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(ellipse 50% 50% at 50% 50%, rgba(34,211,238,0.12), transparent 70%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.9) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(ellipse 90% 60% at 50% 0%, #000 55%, transparent 100%)",
        }}
      />
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.29-1.39a9.9 9.9 0 0 0 4.7 1.2h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.15c-.24.68-1.4 1.3-1.94 1.37-.5.08-1.12.11-1.81-.11-.42-.13-.95-.31-1.64-.6-2.88-1.24-4.76-4.14-4.9-4.33-.14-.19-1.17-1.55-1.17-2.97 0-1.41.74-2.1 1-2.39.26-.28.57-.35.76-.35h.55c.18 0 .42-.07.65.5.24.57.81 1.98.88 2.12.07.15.11.32.02.51-.09.19-.14.31-.28.48-.14.17-.29.37-.42.5-.14.14-.29.29-.12.57.16.28.72 1.19 1.55 1.93 1.06.95 1.96 1.24 2.24 1.38.28.14.44.12.6-.07.16-.19.69-.81.87-1.09.19-.28.37-.23.62-.14.26.09 1.63.77 1.9.91.28.14.46.21.53.33.07.12.07.68-.17 1.36Z" />
    </svg>
  );
}
