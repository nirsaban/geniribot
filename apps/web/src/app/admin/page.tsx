import { redirect } from "next/navigation";
import { type PlanId } from "@kesher/billing";
import { prisma } from "@kesher/db";
import { Card, PageHeader, Stat } from "@/components/ui";
import { getGrowPaymentUrls, platformOrgId } from "@/lib/billing";
import { he } from "@/lib/he";
import { META_SECRETS } from "@/lib/meta";
import { getPlanCatalog } from "@/lib/plan";
import { getSecret, secretMask } from "@/lib/secrets";
import { getSession } from "@/lib/session";
import {
  removePlatformMetaAction,
  savePlanConfigAction,
  savePlatformMetaAction,
  savePlatformPaymentUrlsAction,
  setOrgPlanAction,
} from "./actions";
import { MetaSecrets } from "./MetaSecrets";
import { PaymentLink } from "./PaymentLink";

export const dynamic = "force-dynamic";

const PLAN_TONE: Record<PlanId, string> = { FREE: "badge-gray", STARTER: "badge-brand", PRO: "badge-green" };
const PLAN_ORDER: PlanId[] = ["FREE", "STARTER", "PRO"];

export default async function AdminPage() {
  const session = await getSession();
  if (!session?.sa) redirect("/dashboard");

  const platformId = await platformOrgId();
  const orgs = await prisma.organization.findMany({
    where: { slug: { not: "platform" } },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { users: true, contacts: true } },
    },
  });
  const usersCount = await prisma.user.count({ where: { isSuperAdmin: false } });
  const paidCount = orgs.filter((o) => o.plan !== "FREE").length;

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
  const [paymentUrls, catalog] = await Promise.all([getGrowPaymentUrls(), getPlanCatalog()]);

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
                  <th className="p-3 font-medium">{he.setPlan} / {he.paymentLink}</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.id} className="border-b border-line/60 last:border-0">
                    <td className="p-3 font-medium text-ink">{o.name}</td>
                    <td className="p-3"><span className={PLAN_TONE[o.plan as PlanId]}>{catalog[o.plan as PlanId].name}</span></td>
                    <td className="p-3 text-slate-500">{o._count.users}</td>
                    <td className="p-3 text-slate-500">{o._count.contacts}</td>
                    <td className="p-3 text-slate-400">{fmt(o.createdAt)}</td>
                    <td className="p-3">
                      <div className="flex flex-col items-end gap-2">
                        <div className="flex gap-1">
                          {(["FREE", "STARTER", "PRO"] as PlanId[]).map((p) => (
                            <form action={setOrgPlanAction} key={p}>
                              <input type="hidden" name="orgId" value={o.id} />
                              <input type="hidden" name="plan" value={p} />
                              <button
                                className={`rounded-lg border px-2 py-1 text-[11px] ${
                                  o.plan === p ? "border-brand bg-brand/10 text-brand-dark" : "border-line text-slate-500 hover:bg-slate-50"
                                }`}
                              >
                                {catalog[p].name}
                              </button>
                            </form>
                          ))}
                        </div>
                        <PaymentLink orgId={o.id} />
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
                  <NumField label={he.planConfigPriceMonthly} name="priceIls" defaultValue={plan.priceIls} />
                  <NumField label={he.planConfigPriceAnnual} name="annualIls" defaultValue={plan.annualIls} />
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

      {/* Static Grow payment page links — one per plan × billing interval */}
      <div className="mt-6">
        <h2 className="mb-1 font-semibold text-ink">{he.platformPaymentUrl}</h2>
        <p className="mb-3 text-sm text-slate-500">{he.platformPaymentUrlDesc}</p>
        <Card>
          <form action={savePlatformPaymentUrlsAction} className="grid gap-3 sm:grid-cols-2">
            <PaymentUrlField
              label={he.platformPaymentUrlStarterMonthly}
              name="starter_monthly"
              defaultValue={paymentUrls.STARTER.MONTHLY}
            />
            <PaymentUrlField
              label={he.platformPaymentUrlStarterAnnual}
              name="starter_annual"
              defaultValue={paymentUrls.STARTER.ANNUAL}
            />
            <PaymentUrlField
              label={he.platformPaymentUrlProMonthly}
              name="pro_monthly"
              defaultValue={paymentUrls.PRO.MONTHLY}
            />
            <PaymentUrlField
              label={he.platformPaymentUrlProAnnual}
              name="pro_annual"
              defaultValue={paymentUrls.PRO.ANNUAL}
            />
            <button className="btn-primary sm:col-span-2">{he.saveSecret}</button>
          </form>
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
}: {
  label: string;
  name: string;
  defaultValue: number;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        name={name}
        type="number"
        min={0}
        defaultValue={defaultValue}
        dir="ltr"
        className="input mt-0.5 w-full text-left"
      />
    </label>
  );
}

function PaymentUrlField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: string | null;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue ?? ""}
        dir="ltr"
        placeholder={he.platformPaymentUrlPlaceholder}
        className="input mt-0.5 w-full text-left"
      />
    </label>
  );
}
