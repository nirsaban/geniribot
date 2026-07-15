"use client";

import Link from "next/link";
import { useActionState } from "react";
import { he } from "@/lib/he";

type Action = (
  prev: { error?: string } | undefined,
  formData: FormData,
) => Promise<{ error?: string }>;

function messageFor(error?: string): string | null {
  if (!error) return null;
  if (error === "authError") return he.authError;
  if (error === "emailTaken") return he.emailTaken;
  return error;
}

export function AuthForm({ mode, action }: { mode: "login" | "register"; action: Action }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const isRegister = mode === "register";
  const err = messageFor(state?.error);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand/5 to-canvas p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-brand text-2xl text-white shadow-card">
            ק
          </span>
          <h1 className="text-2xl font-extrabold text-ink">{he.appName}</h1>
          <p className="mt-1 text-sm text-slate-500">{he.tagline}</p>
        </div>

        <div className="card p-7">
          <h2 className="mb-5 text-lg font-bold text-ink">{isRegister ? he.registerCta : he.loginCta}</h2>
          <form action={formAction} className="space-y-4">
            {isRegister && (
              <>
                <Field name="orgName" label={he.orgName} />
                <Field name="name" label={he.yourName} required={false} />
              </>
            )}
            <Field name="email" label={he.email} type="email" dir="ltr" />
            <Field name="password" label={he.password} type="password" dir="ltr" />

            {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}

            <button type="submit" disabled={pending} className="btn-primary w-full py-2.5">
              {pending ? "…" : isRegister ? he.registerCta : he.loginCta}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-sm text-slate-500">
          {isRegister ? he.haveAccount : he.noAccount}{" "}
          <Link href={isRegister ? "/login" : "/register"} className="font-semibold text-brand">
            {isRegister ? he.login : he.register}
          </Link>
        </p>
      </div>
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  required = true,
  dir,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  dir?: "ltr" | "rtl";
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input name={name} type={type} required={required} dir={dir} className="input" />
    </label>
  );
}
