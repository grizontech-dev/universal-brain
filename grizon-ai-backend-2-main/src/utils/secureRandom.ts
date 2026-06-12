import { randomBytes } from "crypto";

function base64UrlEncode(buf: Buffer): string {
  // Node 20 supports base64url, but keep a small fallback to be safe.
  if (typeof buf.toString === "function") {
    try {
      return buf.toString("base64url");
    } catch {
      // ignore
    }
  }
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomToken(bytes: number): string {
  return base64UrlEncode(randomBytes(bytes));
}

