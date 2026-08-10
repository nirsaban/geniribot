import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { effectivePlan, formatIls, type PlanId } from "@kesher/billing";
import { prisma } from "@kesher/db";
import { Card, PageHeader, Stat } from "@/components/ui";
import { BASE_PATH } from "@/lib/basePath";
import { growPaymentUrl, platformOrgId } from "@/lib/billing";
import { he } from "@/lib/he";
import { META_SECRETS } from "@/lib/meta";
import { getPlanCatalog } from "@/lib/plan";
import { getSecret, secretMask } from "@/lib/secrets";
import { getSession } from "@/lib/session";
import {
  claimPaymentForOrgAction,
  removePlatformMetaAction,
  savePlanConfigAction,
  savePlatformMetaAction,
  savePlatformPaymentUrlAction,
  setOrgPlanAction,
} from "./actions";
import { CopyField } from "./CopyField";
import { MetaSecrets } from "./MetaSecrets";

export const dynamic = "force-dynamic";

const PLAN_TONE: Record<PlanId, string> = { FREE: "badge-gray", STARTER: "badge-brand", PRO: "badge-green" };
const PLAN_ORDER: PlanId[] = ["FREE", "STARTER", "PRO"];

export default async function AdminPage() {
  const session = await getSession();
  if (!session?.sa) redirect("/dashboard");

  const platformId = await platformOrgId();
  const rows = await prisma.organization.findMany({
    where: { slug: { not: "platform" } },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { users: true, contacts: true } },
      subscription: { select: { status: true, currentPeriodEnd: true, priceIls: true } },
    },
  });
  // What the tenant actually gets — `Organization.plan` alone can be stale (see `effectivePlan`).
  const orgs = rows.map((o) => ({
    ...o,
    effective: effectivePlan(o.plan as PlanId, o.subscription),
    /** Active with no dated period = an admin unlocked it, no Grow payment behind it. */
    manual: o.subscription?.status === "ACTIVE" && o.subscription.currentPeriodEnd === null,
  }));
  const usersCount = await prisma.user.count({ where: { isSuperAdmin: false } });
  const paidCount = orgs.filter((o) => o.effective !== "FREE").length;

  const [metaAppIdMask, metaAppSecretMask, metaConfigIdMask, metaVerifyMask, metaGraphVersion] =
    platformId
      ? await Promise.all([
          secretMask(platformId, META_SECRETS.appId),
          secretMask(platformId, META_SECRETS.appSecret),
          secretMask(platformId, META_SECRETS.configId),
          secretMask(platformId, META_SECRETS.webhookVerifyToken),
          getSecret(platformId, META_SECRETS.graphVersion),
        ])
      : [null, null, null, null, null];

  const fmt = (d: Date) => new Intl.DateTimeFormat("he-IL", { dateStyle: "short" }).format(d);
  const fmtTime = (d: Date) =>
    new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(d);
  const [payUrl, catalog, unclaimed, callbacks] = await Promise.all([
    growPaymentUrl(),
    getPlanCatalog(),
    prisma.unclaimedGrowPayment.findMany({
      where: { claimedAt: null },
      orderBy: { paidAt: "desc" },
      take: 20,
    }),
    prisma.growCallbackLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  // Built from the request rather than an env var so they're always the URLs
  // this deployment actually answers on — these get pasted into Grow by hand,
  // and a stale one silently means "no payments ever activate".
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}${BASE_PATH}`;
  const notifyUrl = `${origin}/api/billing/grow/webhook`;
  const returnUrl = `${origin}/thank-you`;

  return (
    <>
      <PageHeader title={he.adminTitle} subtitle={he.adminSubtitle} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label={he.adminOrgs} value={orgs.length} icon="🏢" />
        <Stat label={he.adminUsers} value={usersCount} icon="👤" accent="slate" />
        <Stat label={he.adminActivePlans} value={paidCount} icon="💎" accent="green" />
      </div>

      {/* Orgs table */}
      <div className="mt-6">
        <h2 className="mb-3 font-semibold text-ink">{he.adminOrgsTable}</h2>
        <Card className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-line text-xs text-slate-400">
                <tr>
                  <th className="p-3 font-medium">{he.colOrg}</th>
                  <th className="p-3 font-medium">{he.colPlan}</th>
                  <th className="p-3 font-medium">{he.colUsersCount}</th>
                  <th className="p-3 font-medium">{he.colLeadsCount}</th>
                  <th className="p-3 font-medium">{he.colJoined}</th>
                  <th className="p-3 font-medium">{he.setPlan}</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.id} className="border-b border-line/60 last:border-0">
                    <td className="p-3 font-medium text-ink">{o.name}</td>
                    <td className="p-3">
                      <span className={PLAN_TONE[o.effective]}>{catalog[o.effective].name}</span>
                      {o.effective !== "FREE" && o.manual && (
                        <div className="mt-1 text-[11px] text-slate-400">{he.planGrantedManually}</div>
                      )}
                      {o.effective === "FREE" && o.plan !== "FREE" && (
                        <div className="mt-1 text-[11px] text-amber-600">{he.planLapsed}</div>
                      )}
                    </td>
                    <td className="p-3 text-slate-500">{o._count.users}</td>
                    <td className="p-3 text-slate-500">{o._count.contacts}</td>
                    <td className="p-3 text-slate-400">{fmt(o.createdAt)}</td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        {(["FREE", "STARTER", "PRO"] as PlanId[]).map((p) => (
                          <form action={setOrgPlanAction} key={p}>
                            <input type="hidden" name="orgId" value={o.id} />
                            <input type="hidden" name="plan" value={p} />
                            <button
                              className={`rounded-lg border px-2 py-1 text-[11px] ${
                                o.effective === p ? "border-brand bg-brand/10 text-brand-dark" : "border-line text-slate-500 hover:bg-slate-50"
                              }`}
                            >
                              {catalog[p].name}
                            </button>
                          </form>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Plan pricing & limits — overrides the hardcoded defaults everywhere */}
      <div className="mt-6">
        <h2 className="mb-1 font-semibold text-ink">{he.planConfigTitle}</h2>
        <p className="mb-3 text-sm text-slate-500">{he.planConfigDesc}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {PLAN_ORDER.map((id) => {
            const plan = catalog[id];
            return (
              <Card key={id}>
                <form action={savePlanConfigAction} className="space-y-3">
                  <input type="hidden" name="id" value={id} />
                  <div className="flex items-center justify-between">
                    <span className={PLAN_TONE[id]}>{plan.name}</span>
                  </div>
                  <NumField
                    label={he.planConfigPriceMonthly}
                    name="priceIls"
                    defaultValue={plan.priceIls}
                    step="0.01"
                  />
                  <NumField
                    label={he.planConfigConnections}
                    name="connections"
                    defaultValue={plan.limits.connections}
                  />
                  <NumField label={he.planConfigContacts} name="contacts" defaultValue={plan.limits.contacts} />
                  <NumField
                    label={he.planConfigMessages}
                    name="monthlyMessages"
                    defaultValue={plan.limits.monthlyMessages}
                  />
                  <NumField label={he.planConfigProducts} name="products" defaultValue={plan.limits.products} />
                  <button className="btn-primary btn-sm w-full">{he.saveSecret}</button>
                </form>
              </Card>
            );
          })}
        </div>
      </div>

      {/* THE Grow payment page — one link for the whole platform */}
      <div className="mt-6">
        <h2 className="mb-1 font-semibold text-ink">{he.platformPaymentUrl}</h2>
        <p className="mb-3 text-sm text-slate-500">{he.platformPaymentUrlDesc}</p>
        <Card>
          <form action={savePlatformPaymentUrlAction} className="space-y-3">
            <label className="block">
              <span className="text-xs text-slate-500">{he.platformPaymentUrlLabel}</span>
              <input
                name="payment_url"
                defaultValue={payUrl}
                dir="ltr"
                placeholder={he.platformPaymentUrlPlaceholder}
                className="input mt-0.5 w-full text-left"
              />
            </label>
            <p className="text-xs text-slate-400">{he.growProductsHint}</p>
            <button className="btn-primary">{he.saveSecret}</button>
          </form>
        </Card>
      </div>

      {/* The two URLs that have to be pasted into Grow's own dashboard */}
      <div className="mt-6">
        <h2 className="mb-1 font-semibold text-ink">{he.growUrlsTitle}</h2>
        <p className="mb-3 text-sm text-slate-500">{he.growUrlsDesc}</p>
        <Card className="space-y-4">
          <CopyField label={he.growNotifyUrlLabel} value={notifyUrl} hint={he.growNotifyUrlHint} />
          <CopyField label={he.growReturnUrlLabel} value={returnUrl} hint={he.growReturnUrlHint} />
        </Card>
      </div>

      {/* Payments Grow reported that no account has picked up yet */}
      <div className="mt-6">
        <h2 className="mb-1 font-semibold text-ink">{he.unclaimedTitle}</h2>
        <p className="mb-3 text-sm text-slate-500">{he.unclaimedDesc}</p>
        <Card className="!p-0">
          {unclaimed.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">{he.unclaimedEmpty}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="border-b border-line text-xs text-slate-400">
                  <tr>
                    <th className="p-3 font-medium">{he.colPaidAt}</th>
                    <th className="p-3 font-medium">{he.colPlan}</th>
                    <th className="p-3 font-medium">{he.colAmount}</th>
                    <th className="p-3 font-medium">{he.colPayments}</th>
                    <th className="p-3 font-medium">{he.colPayer}</th>
                    <th className="p-3 font-medium">{he.colAttachTo}</th>
                  </tr>
                </thead>
                <tbody>
                  {unclaimed.map((p) => (
                    <tr key={p.id} className="border-b border-line/60 last:border-0">
                      <td className="p-3 text-slate-400">{fmtTime(p.paidAt)}</td>
                      <td className="p-3">
                        <span className={PLAN_TONE[p.plan as PlanId]}>{catalog[p.plan as PlanId].name}</span>
                      </td>
                      <td className="p-3 text-slate-500">₪{formatIls(Number(p.amountIls))}</td>
                      <td className="p-3 text-slate-500">{he.monthsCount(p.paymentsCount)}</td>
                      <td className="p-3 text-slate-500" dir="ltr">
                        {[p.payerPhone, p.payerEmail].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="p-3">
                        <form action={claimPaymentForOrgAction} className="flex justify-end gap-1">
                          <input type="hidden" name="paymentId" value={p.id} />
                          <select name="orgId" className="input !py-1 text-xs" defaultValue="">
                            <option value="" disabled>
                              {he.selectOrg}
                            </option>
                            {orgs.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                          <button className="btn-secondary btn-sm">{he.attach}</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Raw callbacks — the only way to see what Grow actually sends */}
      <div className="mt-6">
        <h2 className="mb-1 font-semibold text-ink">{he.callbacksTitle}</h2>
        <p className="mb-3 text-sm text-slate-500">{he.callbacksDesc}</p>
        <Card className="!p-0">
          {callbacks.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">{he.callbacksEmpty}</p>
          ) : (
            <ul className="divide-y divide-line/60">
              {callbacks.map((c) => (
                <li key={c.id} className="p-3">
                  <details>
                    <summary className="flex cursor-pointer items-center gap-2 text-sm">
                      <span className={c.success ? "badge-green" : "badge-gray"}>
                        {c.success ? he.callbackOk : he.callbackFailed}
                      </span>
                      <span className="text-slate-400">{fmtTime(c.createdAt)}</span>
                    </summary>
                    <pre
                      dir="ltr"
                      className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-left text-[11px] text-slate-600"
                    >
                      {JSON.stringify(c.payload, null, 2)}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Platform Meta / Embedded Signup config */}
      <div className="mt-6">
        <h2 className="mb-1 font-semibold text-ink">{he.platformMeta}</h2>
        <p className="mb-3 text-sm text-slate-500">{he.platformMetaDesc}</p>
        <Card>
          <MetaSecrets
            appIdMask={metaAppIdMask}
            appSecretMask={metaAppSecretMask}
            configIdMask={metaConfigIdMask}
            verifyTokenMask={metaVerifyMask}
            graphVersion={metaGraphVersion}
            saveAction={savePlatformMetaAction}
            removeAction={removePlatformMetaAction}
          />
        </Card>
      </div>
    </>
  );
}

function NumField({
  label,
  name,
  defaultValue,
  step = "1",
}: {
  label: string;
  name: string;
  defaultValue: number;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        name={name}
        type="number"
        min={0}
        step={step}
        defaultValue={defaultValue}
        dir="ltr"
        className="input mt-0.5 w-full text-left"
      />
    </label>
  );
}
