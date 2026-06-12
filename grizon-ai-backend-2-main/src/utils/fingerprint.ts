import { createHash } from "crypto";

function ipFirstThreeOctets(ip: string | undefined): string {
  if (!ip) return "unknown";
  const normalized = ip.replace("::ffff:", "");
  const parts = normalized.split(".");
  if (parts.length !== 4) return normalized;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}

export function fingerprintFromRequest(req: {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}): string {
  const ua = Array.isArray(req.headers["user-agent"]) ? req.headers["user-agent"][0] : req.headers["user-agent"];
  const acceptLanguage = Array.isArray(req.headers["accept-language"])
    ? req.headers["accept-language"][0]
    : req.headers["accept-language"];

  const raw = `${ua ?? "unknown"}|${ipFirstThreeOctets(req.ip)}|${acceptLanguage ?? "unknown"}`;
  const digest = createHash("sha256").update(raw, "utf8").digest("hex");
  // Docs: slice(0, 32)
  return digest.slice(0, 32);
}

export function fingerprintFromParts(args: { userAgent: string; ip?: string; acceptLanguage?: string }): string {
  const raw = `${args.userAgent}|${ipFirstThreeOctets(args.ip)}|${args.acceptLanguage ?? "unknown"}`;
  const digest = createHash("sha256").update(raw, "utf8").digest("hex");
  return digest.slice(0, 32);
}

