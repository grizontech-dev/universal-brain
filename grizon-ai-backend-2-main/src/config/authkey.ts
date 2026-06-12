import { env } from "./env.js";
import type { NotificationJobPayload } from "../types/notificationJob.js";

/** Transactional emails configured in console.authkey.io — template IDs (`mid`). */
export const authkeyTransactionalEmailMids = {
  emailVerify: env.AUTHKEY_EMAIL_VERIFY_MID,
  passwordReset: env.AUTHKEY_PASSWORD_RESET_MID,
} as const;

const NOTIFY_MIDS: Record<NotificationJobPayload["template"], number | undefined> = {
  welcome: env.AUTHKEY_NOTIFY_WELCOME_MID,
  new_device: env.AUTHKEY_NOTIFY_NEW_DEVICE_MID,
  password_changed: env.AUTHKEY_NOTIFY_PASSWORD_CHANGED_MID,
  banned: env.AUTHKEY_NOTIFY_BANNED_MID,
  topup_succeeded: env.AUTHKEY_NOTIFY_TOPUP_SUCCEEDED_MID,
  rate_limit_flagged: env.AUTHKEY_NOTIFY_RATE_LIMIT_FLAGGED_MID,
};

export function authkeyMidForNotificationTemplate(
  template: NotificationJobPayload["template"],
): number | undefined {
  return NOTIFY_MIDS[template];
}
