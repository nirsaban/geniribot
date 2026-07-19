"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { he } from "@/lib/he";

declare global {
  interface Window {
    FB?: {
      init(opts: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }): void;
      login(
        cb: (resp: { authResponse?: { code?: string }; status?: string }) => void,
        opts: Record<string, unknown>,
      ): void;
    };
    fbAsyncInit?: () => void;
  }
}

type Props = { appId: string; configId: string; graphVersion: string };

/** Session info returned by the Embedded Signup popup via postMessage. */
type SignupInfo = { phone_number_id?: string; waba_id?: string };

export function EmbeddedSignupButton({ appId, configId, graphVersion }: Props) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  // Captured from the postMessage event; paired with the FB.login code on submit.
  const info = useRef<SignupInfo>({});

  // Load the Facebook JS SDK once and init.
  useEffect(() => {
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version: graphVersion });
      setReady(true);
    };
    if (document.getElementById("facebook-jssdk")) {
      if (window.FB) setReady(true);
      return;
    }
    const s = document.createElement("script");
    s.id = "facebook-jssdk";
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    document.body.appendChild(s);
  }, [appId, graphVersion]);

  // Listen for the WA_EMBEDDED_SIGNUP session info (phone_number_id + waba_id).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!/facebook\.com$/.test(new URL(event.origin).hostname)) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data?.event === "FINISH") {
          info.current = {
            phone_number_id: data.data?.phone_number_id,
            waba_id: data.data?.waba_id,
          };
        }
      } catch {
        /* non-JSON messages from the SDK — ignore */
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const submit = useCallback(
    async (code: string) => {
      setBusy(true);
      setMsg(null);
      try {
        const res = await fetch("/api/whatsapp/embedded-signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code,
            phone_number_id: info.current.phone_number_id,
            waba_id: info.current.waba_id,
          }),
        });
        if (res.status === 402) {
          window.location.href = "/dashboard/billing?limit=connections";
          return;
        }
        if (res.status === 503) {
          setMsg({ kind: "err", text: he.esNotConfigured });
          return;
        }
        if (!res.ok) {
          setMsg({ kind: "err", text: he.esFailed });
          return;
        }
        setMsg({ kind: "ok", text: he.esSuccess });
        router.refresh();
      } finally {
        setBusy(false);
        info.current = {};
      }
    },
    [router],
  );

  const launch = useCallback(() => {
    if (!window.FB) return;
    setMsg(null);
    window.FB.login(
      (resp) => {
        const code = resp.authResponse?.code;
        if (resp.status === "connected" && code) {
          void submit(code);
        } else {
          setMsg({ kind: "err", text: he.esCancelled });
        }
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  }, [configId, submit]);

  return (
    <div>
      <button
        type="button"
        onClick={launch}
        disabled={!ready || busy}
        className="btn-primary w-full !bg-[#1877F2] disabled:opacity-60"
      >
        {busy ? he.esConnecting : `f  ${he.esButton}`}
      </button>
      {msg && (
        <p className={`mt-2 text-xs ${msg.kind === "err" ? "text-red-600" : "text-emerald-600"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
