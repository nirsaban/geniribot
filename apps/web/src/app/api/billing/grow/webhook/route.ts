import { NextResponse } from "next/server";
import { isGrowSuccess, parseGrowCallback } from "@kesher/billing";
import { prisma } from "@kesher/db";
import { applyGrowPayment } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

/**
 * Grow (Meshulam) payment callback — the ONLY way a payment reaches us.
 *
 * There is one untagged hosted payment page for the whole platform, so this
 * callback carries no organization id and we never send custom fields. What
 * it does carry is the product bought, how many monthly payments of the
 * הוראת קבע the payer committed to, and the payer's phone/email — enough to
 * open the right plan for the right number of months against the right
 * account (see `applyGrowPayment`). It fires again on every renewal charge.
 *
 * Security: the callback is unauthenticated and we do not call back into Grow
 * to verify it (no API access). Plan and length come from the payload, and
 * deliveries are deduped by transaction id. A forged POST naming a real
 * payer's phone/email with a matching product could therefore grant that
 * payer's org a plan for free — accepted for now, worth revisiting if Grow
 * API access or a signed callback becomes available.
 */
export async function POST(req: Request) {
  let flat: Record<string, string> = {};
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      flat = (await req.json()) as Record<string, string>;
    } else {
      const form = await req.formData();
      for (const [k, v] of form.entries()) flat[k] = String(v);
    }
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const cb = parseGrowCallback(flat);

  // Keep the raw body regardless of outcome. Grow's exact field names for a
  // הוראת קבע (how it spells the payments count in particular) can only be
  // confirmed against a real delivery, and /admin renders these rows.
  await prisma.growCallbackLog
    .create({ data: { payload: flat as object, success: isGrowSuccess(cb) } })
    .catch(() => {});

  if (!isGrowSuccess(cb)) {
    return NextResponse.json({ ok: false, error: "not_successful" }, { status: 400 });
  }

  const result = await applyGrowPayment(cb);
  return NextResponse.json({ ok: true, applied: result.applied, reason: result.reason });
}
