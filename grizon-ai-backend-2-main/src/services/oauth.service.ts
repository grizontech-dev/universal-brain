import { OAuth2Client } from "google-auth-library";
import { getPool } from "../db/pool.js";
import { googleConfig } from "../config/auth.js";

export type VerifiedGoogleToken = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  locale?: string;
};

export type GoogleSignInOutcome = "logged_in" | "linked_existing" | "registered";

export type GoogleSignInResult = {
  userId: string;
  outcome: GoogleSignInOutcome;
  // For registered/linking flows we may need to ensure email_verified_at is set.
  userWasBanned: boolean;
  providerEmail: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const oauthService = {
  async verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleToken> {
    const clientIds = googleConfig.clientIds;

    // Verify against each configured audience until one works.
    for (const aud of clientIds) {
      try {
        const client = new OAuth2Client(aud);
        const ticket = await client.verifyIdToken({
          idToken,
          audience: aud,
        });

        const payload = ticket.getPayload();
        if (!payload) throw new Error("Missing Google token payload");

        const iss = payload.iss;
        if (!googleConfig.acceptedIssuers.includes(iss ?? "")) {
          throw new Error("Unexpected Google iss");
        }

        const emailVerified = String(payload.email_verified ?? "") === "true";
        if (!emailVerified) {
          // Contract: map to a dedicated error code.
          throw new Error("GOOGLE_EMAIL_NOT_VERIFIED");
        }

        return {
          sub: String(payload.sub),
          email: String(payload.email),
          email_verified: emailVerified,
          name: payload.name ? String(payload.name) : undefined,
          picture: payload.picture ? String(payload.picture) : undefined,
          locale: payload.locale ? String(payload.locale) : undefined,
        };
      } catch (e: any) {
        const msg = String(e?.message ?? "");
        if (msg === "GOOGLE_EMAIL_NOT_VERIFIED") throw e;
        // Try next audience.
      }
    }

    throw new Error("INVALID_GOOGLE_TOKEN");
  },

  async signInOrLinkByGoogleToken(args: {
    idToken: string;
    platform: "web" | "admin" | "mobile-ios" | "mobile-android";
    nameOverride?: string;
    timezone?: string;
    locale?: string;
  }): Promise<GoogleSignInResult> {
    const pool = getPool();
    const verified = await this.verifyGoogleIdToken(args.idToken);

    const sub = verified.sub;
    const email = verified.email;
    const emailNorm = normalizeEmail(email);

    // 1) Hit: oauth_accounts row exists for this provider+sub.
    const existingOauth = await pool.query(
      `
      SELECT user_id
      FROM oauth_accounts
      WHERE provider = 'google' AND provider_user_id = $1
      LIMIT 1
    `,
      [sub],
    );

    if (existingOauth.rowCount) {
      const userId = existingOauth.rows[0].user_id as string;
      const user = await pool.query(`SELECT status FROM users WHERE id = $1`, [userId]);
      if (!user.rowCount) throw new Error("INCONSISTENT_STATE");
      if ((user.rows[0].status as string) === "banned") return { userId, outcome: "logged_in", userWasBanned: true, providerEmail: email };

      return { userId, outcome: "logged_in", userWasBanned: false, providerEmail: email };
    }

    // 2) Miss: look up by verified email.
    const userRes = await pool.query(
      `
      SELECT id, status
      FROM users
      WHERE email_normalised = $1
      LIMIT 1
    `,
      [emailNorm],
    );

    if (userRes.rowCount) {
      const userId = userRes.rows[0].id as string;
      const status = userRes.rows[0].status as string;
      if (status === "banned") return { userId, outcome: "linked_existing", userWasBanned: true, providerEmail: email };

      // Link Google to existing user.
      await pool.query(
        `
        INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email, email_verified, raw_profile)
        VALUES ($1,'google',$2,$3,true,$4)
      `,
        [
          userId,
          sub,
          emailNorm,
          JSON.stringify({
            name: verified.name ?? args.nameOverride ?? null,
            picture: verified.picture ?? null,
            locale: args.locale ?? verified.locale ?? null,
            timezone: args.timezone ?? null,
          }),
        ],
      );

      return { userId, outcome: "linked_existing", userWasBanned: false, providerEmail: emailNorm };
    }

    // 3) Fresh sign-up.
    const name = args.nameOverride ?? verified.name ?? "New User";
    const nowIso = new Date().toISOString();

    const insertUserRes = await pool.query(
      `
      INSERT INTO users (
        email, email_normalised, password_hash,
        role, status,
        name, bio, avatar_url,
        locale, timezone,
        registration_platform,
        email_verified_at,
        created_at, updated_at
      )
      VALUES ($1,$2,NULL,'user','active',$3,NULL,$4,$5,$6,$7, $8, $9, $9)
      RETURNING id
    `,
      [
        email,
        emailNorm,
        name,
        verified.picture ?? null,
        args.locale ?? verified.locale ?? null,
        args.timezone ?? null,
        args.platform,
        nowIso,
        nowIso,
      ],
    );

    const userId = insertUserRes.rows[0].id as string;
    await pool.query(
      `
      INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email, email_verified, raw_profile)
      VALUES ($1,'google',$2,$3,true,$4)
    `,
      [
        userId,
        sub,
        emailNorm,
        JSON.stringify({ name, picture: verified.picture ?? null, locale: args.locale ?? verified.locale ?? null }),
      ],
    );

    return { userId, outcome: "registered", userWasBanned: false, providerEmail: emailNorm };
  },

  async linkGoogleToAuthenticatedUser(args: { userId: string; idToken: string }): Promise<{ provider: "google"; provider_email: string; linked_at: string }> {
    const pool = getPool();
    const verified = await this.verifyGoogleIdToken(args.idToken);
    const sub = verified.sub;
    const emailNorm = normalizeEmail(verified.email);

    const existingOauth = await pool.query(
      `
      SELECT user_id
      FROM oauth_accounts
      WHERE provider='google' AND provider_user_id = $1
      LIMIT 1
    `,
      [sub],
    );

    if (existingOauth.rowCount) {
      const linkedUserId = existingOauth.rows[0].user_id as string;
      if (linkedUserId !== args.userId) throw Object.assign(new Error("GOOGLE_ALREADY_LINKED"), { code: "GOOGLE_ALREADY_LINKED" });
    }

    const alreadyLinked = await pool.query(
      `
      SELECT 1 FROM oauth_accounts WHERE user_id = $1 AND provider='google'
      LIMIT 1
    `,
      [args.userId],
    );
    if (alreadyLinked.rowCount) {
      throw Object.assign(new Error("ALREADY_LINKED"), { code: "ALREADY_LINKED" });
    }

    const res = await pool.query(
      `
      INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email, email_verified, raw_profile)
      VALUES ($1,'google',$2,$3,true,'{}')
      RETURNING provider_email, linked_at
    `,
      [args.userId, sub, emailNorm],
    );

    return { provider: "google", provider_email: res.rows[0].provider_email, linked_at: res.rows[0].linked_at };
  },

  async unlinkGoogleFromAuthenticatedUser(args: { userId: string }): Promise<void> {
    const pool = getPool();

    const googleOauth = await pool.query(
      `
      SELECT provider_user_id
      FROM oauth_accounts
      WHERE user_id = $1 AND provider='google'
      LIMIT 1
    `,
      [args.userId],
    );

    if (!googleOauth.rowCount) {
      throw Object.assign(new Error("NOT_LINKED"), { code: "NOT_LINKED" });
    }

    const userRes = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [args.userId]);
    const passwordHash = userRes.rows[0]?.password_hash as string | null | undefined;

    // Contract rule: if user has password_hash IS NULL and no other oauth providers => refuse.
    if (passwordHash == null) {
      const otherProviders = await pool.query(
        `SELECT 1 FROM oauth_accounts WHERE user_id = $1 AND provider <> 'google' LIMIT 1`,
        [args.userId],
      );
      if (!otherProviders.rowCount) {
        throw Object.assign(new Error("LAST_SIGN_IN_METHOD"), { code: "LAST_SIGN_IN_METHOD" });
      }
    }

    await pool.query(`DELETE FROM oauth_accounts WHERE user_id = $1 AND provider='google'`, [args.userId]);
  },
};

