import { he } from "@/lib/he";
import { removeGrowSecretsAction, saveGrowSecretsAction } from "./actions";

/**
 * Secure "paste your Grow keys" form. Renders masked status of already-saved
 * secrets (never the real value) and inputs to set/replace them. Server actions
 * encrypt on save.
 */
export function GrowSecrets({
  pageCodeMask,
  userIdMask,
  apiKeyMask,
}: {
  pageCodeMask: string | null;
  userIdMask: string | null;
  apiKeyMask: string | null;
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

      <form action={saveGrowSecretsAction} className="space-y-3">
        <Field label={he.growPageCode} name="page_code" status={status(pageCodeMask)} />
        <Field label={he.growUserId} name="user_id" status={status(userIdMask)} />
        <Field label={he.growApiKey} name="api_key" status={status(apiKeyMask)} />
        <div className="flex items-center gap-2">
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
            🔒 {he.saveSecret}
          </button>
        </div>
      </form>

      {(pageCodeMask || userIdMask || apiKeyMask) && (
        <form action={removeGrowSecretsAction} className="mt-2">
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
