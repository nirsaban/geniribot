import nodemailer, { type Transporter } from "nodemailer";

/**
 * SMTP delivery for transactional mail (team invitations today).
 *
 * Never throws, always reports the outcome: mail is an optional side channel,
 * so an SMTP outage must never fail the action that triggered it — creating an
 * invite still succeeds and the inviter can copy the link instead.
 *
 * Config is env-only: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD,
 * SMTP_FROM. With SMTP_HOST unset, sending is a no-op, so installs without mail
 * stay dormant rather than erroring.
 *
 * (Ported from the kursim project's lib/email.ts, which uses the same contract.)
 */

export type MailResult = { ok: true } | { ok: false; error: string };

let cached: Transporter | null = null;

function transport(): Transporter | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  if (cached) return cached;
  const port = Number(process.env.SMTP_PORT ?? 465);
  cached = nodemailer.createTransport({
    host,
    port,
    // 465 is implicit TLS; 587 upgrades via STARTTLS.
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER ?? "",
      pass: process.env.SMTP_PASSWORD ?? "",
    },
  });
  return cached;
}

/** True when mail is configured — lets the UI say whether an invite can be emailed. */
export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

export function isRealEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(e);
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<MailResult> {
  const t = transport();
  if (!t) return { ok: false, error: "smtp_not_configured" };
  if (!isRealEmail(opts.to)) return { ok: false, error: "invalid_recipient" };
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "",
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      replyTo: opts.replyTo,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "send_failed" };
  }
}
