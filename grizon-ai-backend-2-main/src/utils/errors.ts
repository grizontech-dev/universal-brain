import { z } from "zod";

export type ErrorDetails = Record<string, unknown> | undefined;

export type FieldError = {
  path: string;
  code: string;
  message: string;
};

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly userMessage: string;
  readonly details?: ErrorDetails;
  readonly cause?: unknown;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    details?: ErrorDetails;
    cause?: unknown;
    logMessage?: string;
  }) {
    super(opts.logMessage ?? opts.message);
    this.status = opts.status;
    this.code = opts.code;
    this.userMessage = opts.message;
    this.details = opts.details;
    this.cause = opts.cause;
  }
}

export const Errors = {
  validation: (fields: FieldError[]) =>
    new AppError({
      status: 400,
      code: "VALIDATION_FAILED",
      message: "Please fix the highlighted fields.",
      details: { fields },
    }),
  notAuthenticated: () =>
    new AppError({
      status: 401,
      code: "NOT_AUTHENTICATED",
      message: "Please sign in to continue.",
    }),
  invalidToken: () =>
    new AppError({
      status: 401,
      code: "INVALID_TOKEN",
      message: "Your session has expired or is invalid. Please sign in again.",
    }),
  tokenExpired: () =>
    new AppError({
      status: 401,
      code: "TOKEN_EXPIRED",
      message: "Your session has expired. Please sign in again.",
    }),
  tokenReused: () =>
    new AppError({
      status: 401,
      code: "TOKEN_REUSED",
      message: "Your session has been revoked. Please sign in again.",
    }),
  tokenRevoked: () =>
    new AppError({
      status: 401,
      code: "TOKEN_REVOKED",
      message: "Your session has been revoked. Please sign in again.",
    }),
  adminRequired: () =>
    new AppError({
      status: 403,
      code: "ADMIN_REQUIRED",
      message: "You don't have permission to perform this action.",
    }),
  superadminRequired: () =>
    new AppError({
      status: 403,
      code: "SUPERADMIN_REQUIRED",
      message: "Superadmin privileges are required for this action.",
    }),
  notFound: (label: string) =>
    new AppError({
      status: 404,
      code: "NOT_FOUND",
      message: `${label} not found.`,
    }),
  internal: (cause: unknown) =>
    new AppError({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Something went wrong on our side. We have been notified.",
      cause,
    }),

  platformMismatch: () =>
    new AppError({
      status: 400,
      code: "PLATFORM_MISMATCH",
      message: "The request platform does not match this endpoint.",
    }),

  captchaRequired: () =>
    new AppError({
      status: 403,
      code: "CAPTCHA_REQUIRED",
      message: "Please complete the captcha challenge to continue.",
    }),

  invalidEmail: () =>
    new AppError({
      status: 400,
      code: "INVALID_EMAIL",
      message: "Enter a valid email address.",
    }),

  tooManyRequests: () =>
    new AppError({
      status: 429,
      code: "TOO_MANY_REQUESTS",
      message: "You're sending requests too fast. Please wait and try again.",
    }),

  rateLimitExceeded: (details: {
    limitType: "hourly" | "daily" | "weekly" | "monthly";
    limit: number;
    resetAt: string;
    retryAfterSeconds: number;
  }) =>
    new AppError({
      status: 429,
      code: "RATE_LIMIT_EXCEEDED",
      message: "You're sending requests too fast. Please wait a moment and try again.",
      details,
    }),

  rateLimitCooldown: (details: {
    cooldownUntil: string;
    retryAfterSeconds: number;
    reason: string;
  }) =>
    new AppError({
      status: 429,
      code: "RATE_LIMIT_COOLDOWN",
      message: "You've been temporarily slowed down due to repeated bursts. Try again in a few minutes.",
      details,
    }),

  insufficientCredits: (details: {
    creditsNeeded: number;
    creditsAvailable: number;
    topupUrl: string;
  }) =>
    new AppError({
      status: 402,
      code: "INSUFFICIENT_CREDITS",
      message: "You don't have enough credits for this request.",
      details,
    }),

  invalidPackage: () =>
    new AppError({
      status: 400,
      code: "INVALID_PACKAGE",
      message: "Selected top-up package is invalid.",
    }),

  topupsDisabledOnPlan: () =>
    new AppError({
      status: 403,
      code: "TOPUPS_DISABLED_ON_PLAN",
      message: "Top-ups are not enabled on your current plan.",
    }),

  zeroDelta: () =>
    new AppError({
      status: 400,
      code: "ZERO_DELTA",
      message: "Adjustment delta cannot be zero.",
    }),

  negativeBalanceRequiresForce: () =>
    new AppError({
      status: 400,
      code: "NEGATIVE_BALANCE_REQUIRES_FORCE",
      message: "This adjustment would make the balance negative. Use force with superadmin access.",
    }),

  walletNotFound: () =>
    new AppError({
      status: 404,
      code: "WALLET_NOT_FOUND",
      message: "Wallet not found.",
    }),

  upstream: (provider: string, cause: unknown) =>
    new AppError({
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      message: "A service we depend on is temporarily unavailable. Please try again shortly.",
      details: { provider },
      cause,
    }),

  featureNotAvailable: (feature: string) =>
    new AppError({
      status: 403,
      code: "FEATURE_NOT_AVAILABLE",
      message: `${feature} is not available on your current plan.`,
      details: { feature, upgradeUrl: "/pricing" },
    }),

  featureLimitExceeded: (details: {
    feature: string;
    window: string;
    limit: number;
    used: number;
    resetAt: string;
  }) =>
    new AppError({
      status: 429,
      code: "FEATURE_LIMIT_EXCEEDED",
      message: `${details.window[0]?.toUpperCase() ?? ""}${details.window.slice(1)} ${details.feature} limit reached.`,
      details: { ...details, upgradeUrl: "/pricing" },
    }),

  emailTaken: () =>
    new AppError({
      status: 409,
      code: "EMAIL_TAKEN",
      message: "An account with this email already exists.",
    }),

  invalidGoogleToken: () =>
    new AppError({
      status: 400,
      code: "INVALID_GOOGLE_TOKEN",
      message: "Google sign-in failed. Please try again.",
    }),

  invalidCredentials: () =>
    new AppError({
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "Email or password is incorrect.",
    }),

  accountLocked: (lockedUntilIso: string) =>
    new AppError({
      status: 423,
      code: "ACCOUNT_LOCKED",
      message: "Your account is temporarily locked due to too many failed attempts.",
      details: { locked_until: lockedUntilIso },
    }),

  userBanned: () =>
    new AppError({
      status: 403,
      code: "USER_BANNED",
      message: "Your account is not allowed to sign in.",
    }),

  userNotFound: () =>
    new AppError({
      status: 404,
      code: "USER_NOT_FOUND",
      message: "User not found.",
    }),

  googleEmailNotVerified: () =>
    new AppError({
      status: 400,
      code: "GOOGLE_EMAIL_NOT_VERIFIED",
      message: "Google account email is not verified.",
    }),

  googleAlreadyLinked: () =>
    new AppError({
      status: 409,
      code: "GOOGLE_ALREADY_LINKED",
      message: "This Google account is linked to a different user.",
    }),

  alreadyLinked: () =>
    new AppError({
      status: 409,
      code: "ALREADY_LINKED",
      message: "Your account already has Google linked.",
    }),

  lastSignInMethod: () =>
    new AppError({
      status: 400,
      code: "LAST_SIGN_IN_METHOD",
      message: "You can't unlink the last sign-in method. Set a password first.",
    }),

  passwordTooWeak: () =>
    new AppError({
      status: 400,
      code: "PASSWORD_TOO_WEAK",
      message: "Your password does not meet the requirements.",
    }),

  invalidCurrentPassword: () =>
    new AppError({
      status: 401,
      code: "INVALID_CURRENT_PASSWORD",
      message: "Current password is incorrect.",
    }),

  invalidOrExpiredToken: () =>
    new AppError({
      status: 400,
      code: "INVALID_OR_EXPIRED_TOKEN",
      message: "That token is invalid or has expired.",
    }),

  emailNotVerified: () =>
    new AppError({
      status: 403,
      code: "EMAIL_NOT_VERIFIED",
      message: "Please verify your email address to continue.",
    }),

  cannotBanSuperadmin: () =>
    new AppError({
      status: 403,
      code: "CANNOT_BAN_SUPERADMIN",
      message: "Banning a superadmin requires another superadmin.",
    }),

  cannotDemoteSelf: () =>
    new AppError({
      status: 400,
      code: "CANNOT_DEMOTE_SELF",
      message: "You cannot demote your own role.",
    }),

  impersonationNotAllowed: () =>
    new AppError({
      status: 403,
      code: "IMPERSONATION_NOT_ALLOWED",
      message: "Impersonation is not allowed for that target.",
    }),

  reasonRequired: () =>
    new AppError({
      status: 400,
      code: "REASON_REQUIRED",
      message: "A reason is required for this action.",
    }),

  planNotFound: () =>
    new AppError({
      status: 404,
      code: "PLAN_NOT_FOUND",
      message: "That plan does not exist.",
    }),

  planArchived: () =>
    new AppError({
      status: 410,
      code: "PLAN_ARCHIVED",
      message: "This plan is archived and cannot be subscribed to.",
    }),

  planNotPublic: () =>
    new AppError({
      status: 403,
      code: "PLAN_NOT_PUBLIC",
      message: "This plan is not available for self-service signup.",
    }),

  planFieldImmutable: (fields: string[]) =>
    new AppError({
      status: 400,
      code: "PLAN_FIELD_IMMUTABLE",
      message: "These plan fields cannot be changed in place.",
      details: { fields },
    }),

  invalidBillingCycle: () =>
    new AppError({
      status: 400,
      code: "INVALID_BILLING_CYCLE",
      message: "Billing cycle must be monthly or annual.",
    }),

  invalidUpgradeTarget: () =>
    new AppError({
      status: 400,
      code: "INVALID_UPGRADE_TARGET",
      message: "You cannot upgrade to the free plan. Use cancel instead.",
    }),

  alreadyOnPlan: () =>
    new AppError({
      status: 409,
      code: "ALREADY_ON_PLAN",
      message: "You are already on this plan and billing cycle.",
    }),

  subscriptionNotFound: () =>
    new AppError({
      status: 404,
      code: "SUBSCRIPTION_NOT_FOUND",
      message: "No subscription was found.",
    }),

  cannotCancelFreePlan: () =>
    new AppError({
      status: 400,
      code: "CANNOT_CANCEL_FREE_PLAN",
      message: "The free plan cannot be cancelled.",
    }),

  subscriptionConflict: () =>
    new AppError({
      status: 409,
      code: "SUBSCRIPTION_CONFLICT",
      message: "Subscription changed while processing. Please retry.",
    }),

  planIdTaken: () =>
    new AppError({
      status: 409,
      code: "PLAN_ID_TAKEN",
      message: "A plan with this id already exists.",
    }),

  planSlugTaken: () =>
    new AppError({
      status: 409,
      code: "PLAN_SLUG_TAKEN",
      message: "A plan with this slug already exists.",
    }),

  notImplemented: (feature: string) =>
    new AppError({
      status: 501,
      code: "NOT_IMPLEMENTED",
      message: `${feature} is not implemented yet.`,
    }),

  // Payment errors
  paymentOrderNotFound: () =>
    new AppError({
      status: 404,
      code: "PAYMENT_ORDER_NOT_FOUND",
      message: "Payment order not found.",
    }),

  paymentOrderExpired: () =>
    new AppError({
      status: 410,
      code: "PAYMENT_ORDER_EXPIRED",
      message: "This payment order has expired.",
    }),

  paymentAlreadyCompleted: () =>
    new AppError({
      status: 409,
      code: "PAYMENT_ALREADY_COMPLETED",
      message: "This payment has already been completed.",
    }),

  subscriptionAlreadyActive: () =>
    new AppError({
      status: 409,
      code: "SUBSCRIPTION_ALREADY_ACTIVE",
      message: "You already have an active paid subscription.",
    }),

  subscriptionNotManagedByPG: () =>
    new AppError({
      status: 400,
      code: "SUBSCRIPTION_NOT_MANAGED_BY_PG",
      message: "This subscription is not managed by a payment gateway.",
    }),

  webhookSignatureInvalid: () =>
    new AppError({
      status: 401,
      code: "WEBHOOK_SIGNATURE_INVALID",
      message: "Webhook signature verification failed.",
    }),

  webhookDuplicate: () =>
    new AppError({
      status: 200,
      code: "WEBHOOK_DUPLICATE",
      message: "Duplicate webhook event; already processed.",
    }),

  conversationNotFound: () =>
    new AppError({
      status: 404,
      code: "CONVERSATION_NOT_FOUND",
      message: "Conversation not found.",
    }),

  messageNotFound: () =>
    new AppError({
      status: 404,
      code: "MESSAGE_NOT_FOUND",
      message: "Message not found.",
    }),

  fileTooLarge: (args: number | { max: number; maxBytes?: number }) =>
    new AppError({
      status: 400,
      code: "FILE_TOO_LARGE",
      message: "That file is larger than your plan allows.",
      details:
        typeof args === "number"
          ? { maxBytes: args, max: args }
          : { max: args.max, maxBytes: args.maxBytes ?? args.max },
    }),

  fileTypeNotAllowed: (args: string[] | { allowed: string[] }) =>
    new AppError({
      status: 400,
      code: "FILE_TYPE_NOT_ALLOWED",
      message: "We don't accept that file type yet.",
      details: { allowed: Array.isArray(args) ? args : args.allowed },
    }),

  fileLimitPerChat: (max: number) =>
    new AppError({
      status: 400,
      code: "FILE_LIMIT_PER_CHAT",
      message: "File limit per conversation reached.",
      details: { max },
    }),

  fileNotReady: () =>
    new AppError({
      status: 409,
      code: "FILE_NOT_READY",
      message: "File is not ready yet.",
    }),

  fileTypeMismatch: (details: { mime: string; ext?: string }) =>
    new AppError({
      status: 400,
      code: "FILE_TYPE_MISMATCH",
      message: "The file's extension and content don't match.",
      details,
    }),

  messageTooLong: (details: { length: number; max: number }) =>
    new AppError({
      status: 400,
      code: "MESSAGE_TOO_LONG",
      message: "Your message is longer than this plan allows. Upgrade for more room.",
      details: { ...details, upgradeUrl: "/pricing" },
    }),

  promptInjectionRejected: () =>
    new AppError({
      status: 400,
      code: "PROMPT_INJECTION_REJECTED",
      message: "Your message looked like a prompt-injection attempt.",
    }),

  repeatMessage: () =>
    new AppError({
      status: 409,
      code: "REPEAT_MESSAGE",
      message: "You're sending the same message too quickly. Please wait a moment.",
    }),

  artifactNotFound: () =>
    new AppError({
      status: 404,
      code: "ARTIFACT_NOT_FOUND",
      message: "Artifact not found.",
    }),

  artifactVersionLimit: (max: number) =>
    new AppError({
      status: 400,
      code: "ARTIFACT_VERSION_LIMIT",
      message: "Artifact version limit reached.",
      details: { max },
    }),

  attachedFileNotReady: () =>
    new AppError({
      status: 409,
      code: "ATTACHED_FILE_NOT_READY",
      message: "Attached file is not ready yet.",
    }),

  agentNotAllowed: (details?: { agentSlug?: string; planId?: string }) =>
    new AppError({
      status: 403,
      code: "AGENT_NOT_ALLOWED",
      message: "Selected agent is not allowed on your current plan.",
      details,
    }),

  modelNotAllowed: (details?: { modelId?: string; agentSlug?: string; planId?: string; tier?: string }) =>
    new AppError({
      status: 403,
      code: "MODEL_NOT_ALLOWED",
      message: "No model is configured for this agent on your current plan.",
      details,
    }),

  providerExhausted: (details?: { providers?: string[] }) =>
    new AppError({
      status: 503,
      code: "PROVIDER_EXHAUSTED",
      message: "All model providers are temporarily unavailable. Please try again shortly.",
      details,
    }),

  /** Logged-only helper — do not throw to HTTP from router classifier fallback. */
  classificationFailed: (cause: unknown) =>
    new AppError({
      status: 500,
      code: "CLASSIFICATION_FAILED",
      message: "Classifier failed.",
      cause,
      logMessage: String(cause),
    }),

  contextOverflow: (details?: { tokens?: number; contextWindow?: number }) =>
    new AppError({
      status: 413,
      code: "CONTEXT_OVERFLOW",
      message: "This conversation is too long for the selected model.",
      details,
    }),

  jobEnqueueFailed: (cause: unknown) =>
    new AppError({
      status: 500,
      code: "JOB_ENQUEUE_FAILED",
      message: "Unable to enqueue chat job right now. Please try again.",
      cause,
    }),

  jobNotFound: () =>
    new AppError({
      status: 404,
      code: "JOB_NOT_FOUND",
      message: "Job not found.",
    }),

  jobNotOwned: () =>
    new AppError({
      status: 403,
      code: "JOB_NOT_OWNED",
      message: "You do not have access to this job.",
    }),

  noActiveJob: () =>
    new AppError({
      status: 404,
      code: "NO_ACTIVE_JOB",
      message: "No active job found for this conversation.",
    }),

  invalidQueueName: () =>
    new AppError({
      status: 400,
      code: "INVALID_QUEUE_NAME",
      message: "Queue name is invalid.",
    }),
};

function mapZodCode(issueCode: z.ZodIssue["code"]) {
  switch (issueCode) {
    case "invalid_type":
      return "INVALID_TYPE";
    case "invalid_format":
      return "INVALID_VALUE";
    case "too_small":
      return "VALUE_TOO_SMALL";
    case "too_big":
      return "VALUE_TOO_BIG";
    default:
      return "INVALID_VALUE";
  }
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const fields: FieldError[] = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: mapZodCode(issue.code),
      message: issue.message,
    }));
    throw Errors.validation(fields);
  }
  return parsed.data;
}

export function parseQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  return parseBody(schema, query);
}
