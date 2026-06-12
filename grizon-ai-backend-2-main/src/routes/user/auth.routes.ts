import { Router } from "express";
import { z } from "zod";

import { ok } from "../../utils/response.js";
import { Errors, parseBody } from "../../utils/errors.js";
import { fingerprintFromParts } from "../../utils/fingerprint.js";
import { authService } from "../../services/auth.service.js";

const router = Router();

function deviceContextFromReq(req: any) {
  const platform = req.platform as "web" | "admin" | "mobile-ios" | "mobile-android";
  const deviceName = req.header("x-device-name") as string | undefined;
  const ip = req.ip as string | undefined;
  const userAgent = req.headers["user-agent"] as string | undefined;
  const acceptLanguage = req.headers["accept-language"] as string | undefined;
  const fingerprint = fingerprintFromParts({ userAgent: userAgent ?? "", ip, acceptLanguage });
  const deviceType: string = userAgent?.toLowerCase().includes("mobile") ? "mobile" : "desktop";

  return {
    platform,
    deviceName: deviceName?.trim() || "Unknown device",
    fingerprint,
    deviceType,
    os: null,
    browser: null,
    appVersion: null,
    ip,
    userAgent,
  };
}

router.post("/check-email", async (req, res, next) => {
  try {
    const schema = z.object({
      email: z.string().min(1),
      captcha_token: z.string().optional(),
    });
    const body = parseBody(schema, req.body);

    const ctx = deviceContextFromReq(req);
    const result = await authService.checkEmail({
      email: body.email,
      captchaToken: body.captcha_token,
      ip: req.ip,
      platform: req.platform!,
      device: ctx as any,
    });

    return ok(res, result, "Email check completed.");
  } catch (e) {
    return next(e);
  }
});

router.post("/register", async (req, res, next) => {
  try {
    const schema = z.object({
      email: z.string().min(1).email(),
      password: z
        .string()
        .min(10)
        .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "password_must_have_letter_and_number"),
      name: z.string().min(1).max(60),
      bio: z.string().max(500).optional(),
      locale: z.string().optional(),
      timezone: z.string().optional(),
    });
    const body = parseBody(schema, req.body);

    const ctx = deviceContextFromReq(req);
    const result = await authService.register({
      email: body.email,
      password: body.password,
      name: body.name,
      bio: body.bio,
      locale: body.locale,
      timezone: body.timezone,
      device: ctx as any,
    });

    return ok(res, result, "Account created.");
  } catch (e: any) {
    return next(e);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const schema = z.object({ email: z.string().min(1), password: z.string().min(1) });
    const body = parseBody(schema, req.body);
    const ctx = deviceContextFromReq(req);

    const result = await authService.login({ email: body.email, password: body.password, device: ctx as any });
    return ok(res, result, "Welcome back.");
  } catch (e) {
    return next(e);
  }
});

router.post("/google", async (req, res, next) => {
  try {
    const schema = z.object({
      id_token: z.string().min(1),
      name: z.string().optional(),
      timezone: z.string().optional(),
      locale: z.string().optional(),
    });
    const body = parseBody(schema, req.body);
    const ctx = deviceContextFromReq(req);

    const result = await authService.google({
      id_token: body.id_token,
      name: body.name,
      timezone: body.timezone,
      locale: body.locale,
      device: ctx as any,
    });

    return ok(res, result, "Google sign-in completed.");
  } catch (e: any) {
    // authService/google currently propagates oauth-service error messages for now.
    if (e?.message === "INVALID_GOOGLE_TOKEN") return next(Errors.invalidGoogleToken());
    if (e?.message === "GOOGLE_EMAIL_NOT_VERIFIED") return next(Errors.googleEmailNotVerified());
    return next(e);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const schema = z.object({ refresh_token: z.string().min(1) });
    const body = parseBody(schema, req.body);
    const ctx = deviceContextFromReq(req);

    const result = await authService.refresh({
      refresh_token: body.refresh_token,
      device: {
        platform: ctx.platform,
        deviceName: ctx.deviceName,
        deviceType: ctx.deviceType,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        fingerprint: ctx.fingerprint,
      },
    });

    return ok(res, result, "Session refreshed.");
  } catch (e) {
    return next(e);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const schema = z.object({ refresh_token: z.string().min(1) });
    const body = parseBody(schema, req.body);
    await authService.logout({
      userId: req.user!.id,
      refresh_token: body.refresh_token,
      currentSessionId: req.session!.id,
      tokenExpEpochSeconds: req.token!.exp as number,
    });
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
});

router.post("/logout-all", async (req, res, next) => {
  try {
    await authService.logoutAll({ userId: req.user!.id, tokenExpEpochSeconds: req.token!.exp as number });
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
});

router.get("/me", async (req, res, next) => {
  try {
    if (!req.user) {
      return next(Errors.notAuthenticated());
    }
    const result = await authService.getMe(req.user!.id);
    return ok(res, result, "Profile loaded.");
  } catch (e) {
    return next(e);
  }
});

router.patch("/me", async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1).max(60).optional(),
      bio: z.string().max(500).optional(),
      avatar_url: z.string().url().nullable().optional(),
      locale: z.string().optional(),
      timezone: z.string().optional(),
    });
    const body = parseBody(schema, req.body);

    const result = await authService.updateMe({
      userId: req.user!.id,
      patch: {
        name: body.name,
        bio: body.bio,
        avatar_url: body.avatar_url === null ? null : body.avatar_url,
        locale: body.locale,
        timezone: body.timezone,
      },
    });

    return ok(res, result, "Profile updated.");
  } catch (e) {
    return next(e);
  }
});

router.post("/google/link", async (req, res, next) => {
  try {
    const schema = z.object({ id_token: z.string().min(1) });
    const body = parseBody(schema, req.body);
    const result = await authService.linkGoogle({ userId: req.user!.id, id_token: body.id_token });
    return ok(res, result, "Google linked.");
  } catch (e: any) {
    if (e?.code === "GOOGLE_ALREADY_LINKED") return next(Errors.googleAlreadyLinked());
    if (e?.code === "ALREADY_LINKED") return next(Errors.alreadyLinked());
    return next(e);
  }
});

router.delete("/google/link", async (req, res, next) => {
  try {
    await authService.unlinkGoogle({ userId: req.user!.id });
    return res.status(204).send();
  } catch (e: any) {
    if (e?.code === "LAST_SIGN_IN_METHOD") return next(Errors.lastSignInMethod());
    if (e?.code === "NOT_LINKED") return next(Errors.notFound("Google link"));
    return next(e);
  }
});

router.post("/password/change", async (req, res, next) => {
  try {
    const schema = z.object({ current_password: z.string().min(1), new_password: z.string().min(1) });
    const body = parseBody(schema, req.body);
    const ctx = deviceContextFromReq(req);
    const result = await authService.changePassword({
      userId: req.user!.id,
      current_password: body.current_password,
      new_password: body.new_password,
      device: ctx as any,
      sessionId: req.session!.id,
    });
    return ok(res, result, "Password changed.");
  } catch (e) {
    return next(e);
  }
});

router.post("/password/forgot", async (req, res, next) => {
  try {
    const schema = z.object({ email: z.string().min(1) });
    const body = parseBody(schema, req.body);

    const result = await authService.forgotPassword({
      email: body.email,
      ip: req.ip,
      platform: req.platform!,
      userAgent: req.headers["user-agent"] as string | undefined,
      acceptLanguage: req.headers["accept-language"] as string | undefined,
      deviceName: req.header("x-device-name") as string | undefined,
      deviceType: "unknown",
    });

    return ok(res, result, "Password reset request received.");
  } catch (e) {
    return next(e);
  }
});

router.post("/password/reset", async (req, res, next) => {
  try {
    const schema = z.object({ token: z.string().min(1), new_password: z.string().min(1) });
    const body = parseBody(schema, req.body);

    const result = await authService.resetPassword({
      token: body.token,
      new_password: body.new_password,
      platform: req.platform!,
      ip: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
      acceptLanguage: req.headers["accept-language"] as string | undefined,
      deviceName: req.header("x-device-name") as string | undefined,
      deviceType: "unknown",
    });

    return ok(res, result, "Password reset successful.");
  } catch (e) {
    return next(e);
  }
});

router.post("/email/verify/request", async (req, res, next) => {
  try {
    await authService.requestEmailVerify({
      userId: req.user!.id,
      ip: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
      acceptLanguage: req.headers["accept-language"] as string | undefined,
      deviceName: req.header("x-device-name") as string | undefined,
      deviceType: "unknown",
      platform: req.platform!,
    });
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
});

router.post("/email/verify/confirm", async (req, res, next) => {
  try {
    const schema = z.object({ token: z.string().min(1) });
    const body = parseBody(schema, req.body);
    const result = await authService.confirmEmailVerify({ token: body.token });
    return ok(res, result, "Email verified.");
  } catch (e) {
    return next(e);
  }
});

router.get("/sessions", async (req, res, next) => {
  try {
    const result = await authService.listSessions(req.user!.id, req.session!.id);
    return ok(res, result, "Sessions loaded.");
  } catch (e) {
    return next(e);
  }
});

router.delete("/sessions/:id", async (req, res, next) => {
  try {
    const sessionId = req.params.id;
    // Current access token exp needed for blacklist TTL mapping.
    await authService.revokeSession({
      userId: req.user!.id,
      sessionId,
      currentSessionId: req.session!.id,
      tokenExpEpochSeconds: req.token!.exp as number,
      reason: "logout",
    });
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
});

export const authRoutes = router;

