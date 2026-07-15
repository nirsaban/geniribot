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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden mesh-bg p-4">
      {/* floating 3D blobs */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 animate-blob rounded-full bg-brand/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 animate-blob rounded-full bg-blue-400/20 blur-3xl" style={{ animationDelay: "3s" }} />
      <div className="pointer-events-none absolute left-1/3 top-1/4 h-56 w-56 animate-blob rounded-full bg-violet-400/15 blur-3xl" style={{ animationDelay: "6s" }} />

      <div className="relative w-full max-w-sm animate-fade-up">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="logo-3d mb-4 grid h-16 w-16 animate-float place-items-center rounded-2xl text-3xl font-black text-white">
            G
          </span>
          <h1 className="gradient-text text-3xl font-black">{he.appName}</h1>
          <p className="mt-1.5 text-sm text-slate-500">{he.tagline}</p>
        </div>

        <div className="card animate-pop p-7 backdrop-blur">
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
