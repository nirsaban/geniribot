import { he } from "@/lib/he";

/**
 * Secure "paste your Make webhook URLs" form. Renders masked status of
 * already-saved secrets (never the real value) and inputs to set/replace
 * them. Server actions (passed in) encrypt on save. Used by the super-admin
 * panel (platform creds) and the per-tenant dashboard settings.
 */
export function GrowSecrets({
  createCheckoutMask,
  verifyMask,
  chargeTokenMask,
  saveAction,
  removeAction,
}: {
  createCheckoutMask: string | null;
  verifyMask: string | null;
  chargeTokenMask: string | null;
  saveAction: (formData: FormData) => Promise<void>;
  removeAction: () => Promise<void>;
}) {
  const status = (m: string | null) =>
    m ? (
      <span className="text-xs text-brand">
        {he.secretSet} · {m}
      </span>
    ) : (
      <span className="text-xs text-gray-400">{he.secretNotSet}</span>
    );

  return (
    <div>
      <details className="mb-4 rounded-lg bg-gray-50 p-3 text-sm">
        <summary className="cursor-pointer font-medium">{he.howToGetGrow}</summary>
        <ol className="mt-2 list-decimal space-y-1 pr-5 text-gray-600">
          <li>{he.growStep1}</li>
          <li>{he.growStep2}</li>
          <li>{he.growStep3}</li>
        </ol>
      </details>

      <form action={saveAction} className="space-y-3">
        <Field label={he.growCreateCheckoutUrl} name="create_checkout_url" status={status(createCheckoutMask)} />
        <Field label={he.growVerifyUrl} name="verify_url" status={status(verifyMask)} />
        <Field label={he.growChargeTokenUrl} name="charge_token_url" status={status(chargeTokenMask)} />
        <div className="flex items-center gap-2">
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
            🔒 {he.saveSecret}
          </button>
        </div>
      </form>

      {(createCheckoutMask || verifyMask || chargeTokenMask) && (
        <form action={removeAction} className="mt-2">
          <button className="text-xs text-red-600 hover:underline">{he.removeSecret}</button>
        </form>
      )}
    </div>
  );
}

function Field({
  label,
  name,
  status,
}: {
  label: string;
  name: string;
  status: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-sm font-medium text-gray-700">
        {label}
        {status}
      </span>
      <input
        name={name}
        type="password"
        autoComplete="off"
        placeholder="https://hook.eu2.make.com/••••••••"
        dir="ltr"
        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-left outline-none focus:border-brand"
      />
    </label>
  );
}
