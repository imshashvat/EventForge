/**
 * Email service — sends transactional emails via Resend (primary) or SMTP (fallback).
 *
 * Priority:
 *   1. RESEND_API_KEY set → use Resend SDK (recommended, better deliverability)
 *   2. SMTP_HOST set      → use Nodemailer SMTP
 *   3. Neither set        → warn and skip (graceful degradation)
 *
 * Safe to call from API routes and background jobs. Non-fatal — never throws.
 */
import { logger } from "@/core/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

// ── Resend sender ─────────────────────────────────────────────────────────────

async function sendViaResend(opts: SendMailOptions): Promise<void> {
  const { Resend } = await import("resend");
  const client = new Resend(process.env.RESEND_API_KEY!);
  const from = process.env.EMAIL_FROM ?? "EventForge <onboarding@resend.dev>";

  const { error } = await client.emails.send({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    ...(opts.text !== undefined ? { text: opts.text } : {}),
  });

  if (error) {
    logger.error("Resend email failed", { error_code: error.name, message: error.message });
    return; // Non-fatal
  }
  logger.info("Email sent via Resend", { to: opts.to, subject: opts.subject });
}

// ── SMTP (Nodemailer) fallback ────────────────────────────────────────────────

async function sendViaSMTP(opts: SendMailOptions): Promise<void> {
  const nodemailer = await import("nodemailer");
  const from = process.env.EMAIL_FROM ?? "EventForge <noreply@eventforge.app>";

  const transport = nodemailer.default.createTransport({
    host: process.env.SMTP_HOST!,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER ?? "",
      pass: process.env.SMTP_PASS ?? "",
    },
  });

  try {
    await transport.sendMail({ from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text });
    logger.info("Email sent via SMTP", { to: opts.to });
  } catch (err) {
    logger.error("SMTP email failed", { error_code: String(err) });
    // Non-fatal
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function sendMail(opts: SendMailOptions): Promise<void> {
  if (process.env.RESEND_API_KEY) {
    return sendViaResend(opts);
  }
  if (process.env.SMTP_HOST) {
    return sendViaSMTP(opts);
  }
  logger.warn("No email provider configured (RESEND_API_KEY or SMTP_HOST) — email skipped", {
    to: opts.to,
    subject: opts.subject,
  });
}


// ── Templates ─────────────────────────────────────────────────────────────────

export function registrationConfirmationEmail(params: {
  participantName: string;
  eventName: string;
  eventSlug: string;
  status: "approved" | "pending";
  baseUrl?: string;
}): Pick<SendMailOptions, "subject" | "html" | "text"> {
  const base = params.baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://eventforge.app";
  const eventUrl = `${base}/events/${params.eventSlug}`;

  const isPending = params.status === "pending";
  const statusLine = isPending
    ? "Your registration is <strong>pending review</strong> by the organiser. You'll hear back shortly."
    : "Your registration has been <strong>approved</strong>! You're all set.";

  const subject = isPending
    ? `Registration received — ${params.eventName}`
    : `Registration confirmed — ${params.eventName}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${subject}</title>
<style>
  body { margin: 0; padding: 0; background: #0B0F14; font-family: 'Inter', -apple-system, sans-serif; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 40px 20px; }
  .card { background: #10151C; border: 1px solid #2A3340; border-radius: 16px; overflow: hidden; }
  .header { background: linear-gradient(135deg, #7C5CFC, #17B8A6); padding: 32px 32px 28px; }
  .logo { font-size: 20px; font-weight: 700; color: #fff; letter-spacing: -0.5px; }
  .body { padding: 32px; }
  h1 { margin: 0 0 8px; font-size: 22px; color: #F2F5F8; font-weight: 600; }
  p { margin: 0 0 16px; color: #A6B0BD; font-size: 15px; line-height: 1.6; }
  .status-box { background: #171D26; border: 1px solid #2A3340; border-radius: 10px;
                padding: 14px 16px; margin: 20px 0; color: #F2F5F8; font-size: 14px; }
  .btn { display: inline-block; margin-top: 4px; padding: 12px 24px;
         background: linear-gradient(135deg, #7C5CFC, #17B8A6);
         color: #fff; text-decoration: none; border-radius: 8px;
         font-weight: 600; font-size: 14px; }
  .footer { padding: 20px 32px; border-top: 1px solid #2A3340; }
  .footer p { margin: 0; font-size: 12px; color: #6B7684; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="header">
      <div class="logo">⚡ EventForge</div>
    </div>
    <div class="body">
      <h1>Hi ${params.participantName}!</h1>
      <p>Thanks for registering for <strong style="color:#F2F5F8">${params.eventName}</strong>.</p>
      <div class="status-box">${statusLine}</div>
      <p>Visit your event dashboard to see full details.</p>
      <a class="btn" href="${eventUrl}">View Event</a>
    </div>
    <div class="footer">
      <p>You received this email because you registered on EventForge. If this wasn't you, you can safely ignore this email.</p>
    </div>
  </div>
</div>
</body>
</html>`;

  const text = [
    `Hi ${params.participantName},`,
    "",
    `Thanks for registering for ${params.eventName}.`,
    "",
    isPending
      ? "Your registration is pending review. You'll hear back soon."
      : "Your registration has been approved!",
    "",
    `View event: ${eventUrl}`,
  ].join("\n");

  return { subject, html, text };
}

export function registrationStatusUpdateEmail(params: {
  participantName: string;
  eventName: string;
  eventSlug: string;
  newStatus: "approved" | "rejected" | "waitlisted";
  reviewNote?: string | null;
  baseUrl?: string;
}): Pick<SendMailOptions, "subject" | "html" | "text"> {
  const base = params.baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://eventforge.app";
  const eventUrl = `${base}/events/${params.eventSlug}`;

  const STATUS_COPY = {
    approved: { subject: "You're in!", line: "Your registration has been <strong>approved</strong>! You're set to participate." },
    rejected: { subject: "Registration update", line: "Unfortunately, your registration has been <strong>declined</strong> by the organiser." },
    waitlisted: { subject: "You're on the waitlist", line: "Your registration has been moved to the <strong>waitlist</strong>. We'll notify you if a spot opens up." },
  } as const;

  const copy = STATUS_COPY[params.newStatus];

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; background: #0B0F14; font-family: 'Inter', -apple-system, sans-serif; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 40px 20px; }
  .card { background: #10151C; border: 1px solid #2A3340; border-radius: 16px; overflow: hidden; }
  .header { background: linear-gradient(135deg, #7C5CFC, #17B8A6); padding: 28px 32px; }
  .logo { font-size: 20px; font-weight: 700; color: #fff; }
  .body { padding: 32px; }
  h1 { margin: 0 0 8px; font-size: 20px; color: #F2F5F8; font-weight: 600; }
  p { margin: 0 0 16px; color: #A6B0BD; font-size: 15px; line-height: 1.6; }
  .note { background: #171D26; border-left: 3px solid #2A3340; padding: 12px 16px; border-radius: 4px; margin: 16px 0; font-size: 14px; color: #A6B0BD; font-style: italic; }
  .btn { display: inline-block; margin-top: 4px; padding: 12px 24px; background: linear-gradient(135deg, #7C5CFC, #17B8A6); color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; }
  .footer p { font-size: 12px; color: #6B7684; padding: 16px 32px; border-top: 1px solid #2A3340; margin: 0; }
</style>
</head>
<body>
<div class="wrap"><div class="card">
  <div class="header"><div class="logo">⚡ EventForge</div></div>
  <div class="body">
    <h1>Hi ${params.participantName}!</h1>
    <p>Update on your registration for <strong style="color:#F2F5F8">${params.eventName}</strong>:</p>
    <p>${copy.line}</p>
    ${params.reviewNote ? `<div class="note">"${params.reviewNote}"</div>` : ""}
    ${params.newStatus !== "rejected" ? `<a class="btn" href="${eventUrl}">View Event</a>` : ""}
  </div>
  <div class="footer"><p>You received this because you registered on EventForge.</p></div>
</div></div>
</body></html>`;

  const text = `Hi ${params.participantName},\n\nUpdate on ${params.eventName}:\n${params.newStatus.toUpperCase()}\n${params.reviewNote ? `Note: ${params.reviewNote}\n` : ""}\n${eventUrl}`;

  return { subject: `${copy.subject} — ${params.eventName}`, html, text };
}
