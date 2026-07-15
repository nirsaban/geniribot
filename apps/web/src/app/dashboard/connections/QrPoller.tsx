"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { withBase } from "@/lib/basePath";
import { he } from "@/lib/he";

type State = { status: string; qrImage: string | null };

/** Polls the connection state and shows the QR until it pairs. */
export function QrPoller({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "pending", qrImage: null });
  const wasConnected = useRef(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(withBase(`/api/connections/${id}/state`), { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as State;
        if (!alive) return;
        setState(data);
        // Once it connects, refresh the server component to show connected UI.
        if (data.status === "connected" && !wasConnected.current) {
          wasConnected.current = true;
          router.refresh();
        }
      } catch {
        /* transient; keep polling */
      }
    };
    void tick();
    const iv = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [id, router]);

  if (state.status === "connected") {
    return <p className="text-sm font-medium text-brand">{he.statusLabel.CONNECTED} ✓</p>;
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {state.qrImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={state.qrImage}
          alt="WhatsApp QR"
          width={220}
          height={220}
          className="rounded-lg border border-gray-200"
        />
      ) : (
        <div className="flex h-[220px] w-[220px] items-center justify-center rounded-lg border border-dashed border-gray-300 text-sm text-gray-400">
          {he.waiting}
        </div>
      )}
      <p className="max-w-xs text-center text-xs text-gray-500">{he.scanQr}</p>
    </div>
  );
}
