import { SignJWT, jwtVerify, type KeyLike } from "jose";
import { createPrivateKey, createPublicKey } from "crypto";

import type { AccessTokenDecoded, Platform, UserRole } from "../types/auth.js";

export type AccessTokenClaims = {
  sub: string;
  role: UserRole;
  plan_id: string | null;
  aud: Platform; // device platform
  iss: string;
  jti: string;
  act?: { sub: string };
  expEpochSeconds: number;
  iatEpochSeconds: number;
};

export async function signAccessToken(args: {
  privateKey: KeyLike;
  claims: AccessTokenClaims;
  kid: string;
}): Promise<string> {
  const { privateKey, claims, kid } = args;

  const key: KeyLike = typeof privateKey === "string" ? createPrivateKey(privateKey) : privateKey;
  return new SignJWT({
    role: claims.role,
    plan_id: claims.plan_id,
    jti: claims.jti,
    act: claims.act,
  })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(claims.iss)
    .setAudience(claims.aud)
    .setSubject(claims.sub)
    .setIssuedAt(claims.iatEpochSeconds)
    .setExpirationTime(claims.expEpochSeconds)
    .sign(key);
}

export async function verifyAccessToken(args: {
  token: string;
  publicKeys: KeyLike[];
  issuer: string;
  audience: Platform;
}): Promise<AccessTokenDecoded> {
  const lastErr: unknown[] = [];

  for (const key of args.publicKeys) {
    try {
      const verifyKey: KeyLike = typeof key === "string" ? createPublicKey(key) : key;
      const { payload } = await jwtVerify(args.token, verifyKey, {
        issuer: args.issuer,
        audience: args.audience,
      });

      const sub = payload.sub;
      const jti = payload.jti;
      const exp = payload.exp;
      const iat = payload.iat;
      const role = payload.role as UserRole | undefined;
      const plan_id = (payload.plan_id as string | null | undefined) ?? null;
      const aud = payload.aud as Platform | string | undefined;
      const act = payload.act as { sub: string } | undefined;

      if (!sub || !jti || !exp || !iat || !role || !aud || (typeof aud !== "string" && !Array.isArray(aud))) {
        // Structural mismatch
        throw new Error("JWT payload shape mismatch");
      }

      return {
        sub,
        jti,
        exp,
        iat,
        role,
        plan_id,
        aud: typeof aud === "string" ? (aud as Platform) : (aud[0] as Platform),
        iss: payload.iss as string,
        act,
      };
    } catch (e) {
      lastErr.push(e);
    }
  }

  // Re-throw the last error with best-effort message.
  const err = lastErr[lastErr.length - 1];
  throw err ?? new Error("JWT verification failed");
}

export function getAuthHeaderBearerToken(req: { header: (name: string) => string | undefined }): string | null {
  const auth = req.header("Authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

