import { he } from "@/lib/he";

/**
 * Super-admin "paste your Meta app config" form for WhatsApp Embedded Signup.
 * Mirrors GrowSecrets: shows masked status of already-saved values (never the
 * real value) and inputs to set/replace them. The save action encrypts on write.
 */
export function MetaSecrets({
  appIdMask,
  appSecretMask,
  configIdMask,
  verifyTokenMask,
  graphVersion,
  saveAction,
  removeAction,
}: {
  appIdMask: string | null;
  appSecretMask: string | null;
  configIdMask: string | null;
  verifyTokenMask: string | null;
  graphVersion: string | null;
  saveAction: (formData: FormData) => Promise<void>;
  removeAction: () => Promise<void>;
}) {
  const anySet = appIdMask || appSecretMask || configIdMask || verifyTokenMask;
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
        <summary className="cursor-pointer font-medium">{he.howToGetMeta}</summary>
        <ol className="mt-2 list-decimal space-y-1 pr-5 text-gray-600">
          <li>{he.metaStep1}</li>
          <li>{he.metaStep2}</li>
          <li>{he.metaStep3}</li>
        </ol>
      </details>

      <form action={saveAction} className="space-y-3">
        <Field label={he.metaAppId} name="app_id" status={status(appIdMask)} />
        <Field label={he.metaAppSecret} name="app_secret" status={status(appSecretMask)} />
        <Field label={he.metaConfigId} name="config_id" status={status(configIdMask)} />
        <Field label={he.metaVerifyToken} name="verify_token" status={status(verifyTokenMask)} />
        <label className="block">
          <span className="text-sm font-medium text-gray-700">{he.metaGraphVersion}</span>
          <input
            name="graph_version"
            type="text"
            dir="ltr"
            defaultValue={graphVersion ?? ""}
            placeholder="v21.0"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-left outline-none focus:border-brand"
          />
        </label>
        <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
          🔒 {he.saveSecret}
        </button>
      </form>

      {anySet && (
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
        placeholder="••••••••"
        dir="ltr"
        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-left outline-none focus:border-brand"
      />
    </label>
  );
}
