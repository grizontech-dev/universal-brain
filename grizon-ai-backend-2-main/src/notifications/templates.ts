/** HTML email bodies for Module 7 notification templates (`NotificationJobPayload`). */

export type NotificationVars = Record<string, string | number>;

function escapeHtml(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function v(vars: NotificationVars, key: string): string {
  return escapeHtml(vars[key]);
}

function plain(vars: NotificationVars, key: string, fallback = ""): string {
  const x = vars[key];
  if (x === undefined || x === null) return fallback;
  return String(x);
}

export function welcomeTemplate(vars: NotificationVars): { subject: string; html: string; text: string } {
  const name = v(vars, "userName") || v(vars, "name") || "there";
  const subject = "Welcome to Grizon AI";
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<h2 style="color:#111">Welcome</h2>
<p>Hi ${name},</p>
<p>Your account is ready. Sign in to start chatting with your agents.</p>
</body></html>`;
  const text = `Hi ${plain(vars, "userName") || plain(vars, "name") || "there"}, welcome — your account is ready.`;
  return { subject, html, text };
}

export function newDeviceTemplate(vars: NotificationVars): { subject: string; html: string; text: string } {
  const subject = "New sign-in on your account";
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<h2 style="color:#111">New device</h2>
<p>We noticed a sign-in from a new device or location.</p>
<ul style="color:#444;font-size:14px">
<li>When: ${v(vars, "when") || v(vars, "timestamp") || "—"}</li>
<li>IP: ${v(vars, "ip") || "—"}</li>
<li>Device: ${v(vars, "device") || v(vars, "deviceSummary") || "—"}</li>
</ul>
<p style="color:#666;font-size:13px">If this was not you, change your password and contact support.</p>
</body></html>`;
  const text = `New sign-in detected. IP: ${plain(vars, "ip") || "unknown"}.`;
  return { subject, html, text };
}

export function passwordChangedTemplate(vars: NotificationVars): { subject: string; html: string; text: string } {
  const name = v(vars, "userName") || v(vars, "name") || "there";
  const subject = "Your password was changed";
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<h2 style="color:#111">Password updated</h2>
<p>Hi ${name},</p>
<p>Your password was successfully changed.</p>
<p style="color:#666;font-size:13px">If you did not make this change, reset your password immediately.</p>
</body></html>`;
  const text = `Hi ${plain(vars, "userName") || plain(vars, "name") || "there"}, your password was changed.`;
  return { subject, html, text };
}

export function bannedTemplate(vars: NotificationVars): { subject: string; html: string; text: string } {
  const subject = "Your account access has been restricted";
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<h2 style="color:#c00">Account restricted</h2>
<p>Your account has been suspended or banned.</p>
<p style="color:#444">${v(vars, "reason") || "Please contact support if you believe this is a mistake."}</p>
</body></html>`;
  const text = `Your account has been restricted. ${plain(vars, "reason")}`.trim();
  return { subject, html, text };
}

export function topupSucceededTemplate(vars: NotificationVars): { subject: string; html: string; text: string } {
  const subject = "Credit top-up confirmed";
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<h2 style="color:#111">Top-up complete</h2>
<p>Your wallet was credited successfully.</p>
<ul style="color:#444;font-size:14px">
<li>Amount: ${v(vars, "amount") || "—"}</li>
<li>New balance: ${v(vars, "balance") || "—"}</li>
</ul>
</body></html>`;
  const text = `Credit top-up confirmed. New balance: ${plain(vars, "balance") || "see app"}.`;
  return { subject, html, text };
}

export function rateLimitFlaggedTemplate(vars: NotificationVars): { subject: string; html: string; text: string } {
  const email = v(vars, "flaggedUserEmail") || v(vars, "email") || "unknown";
  const subject = `Rate limit review: ${email}`;
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<h2 style="color:#111">Rate limit review</h2>
<p>User <strong>${email}</strong> (ID: ${v(vars, "flaggedUserId") || v(vars, "userId") || "—"}) exceeded cooldown thresholds.</p>
<p>Cooldown count (24h): ${v(vars, "cooldownCount") || v(vars, "count") || "—"}</p>
<p style="color:#666;font-size:13px">Review in the admin panel under rate limits.</p>
</body></html>`;
  const text = `User ${plain(vars, "flaggedUserEmail") || plain(vars, "email") || "unknown"} flagged for rate limit review.`;
  return { subject, html, text };
}
