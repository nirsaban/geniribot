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
    <div className="mx-auto mt-24 w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
      <h1 className="mb-1 text-2xl font-bold text-brand-dark">{he.appName}</h1>
      <p className="mb-6 text-sm text-gray-500">{he.tagline}</p>

      <form action={formAction} className="space-y-4">
        {isRegister && (
          <>
            <Field name="orgName" label={he.orgName} />
            <Field name="name" label={he.yourName} required={false} />
          </>
        )}
        <Field name="email" label={he.email} type="email" />
        <Field name="password" label={he.password} type="password" />

        {err && <p className="text-sm text-red-600">{err}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-brand py-2 font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {isRegister ? he.registerCta : he.loginCta}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        {isRegister ? he.haveAccount : he.noAccount}{" "}
        <Link href={isRegister ? "/login" : "/register"} className="font-medium text-brand">
          {isRegister ? he.login : he.register}
        </Link>
      </p>
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  required = true,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-brand"
      />
    </label>
  );
}
