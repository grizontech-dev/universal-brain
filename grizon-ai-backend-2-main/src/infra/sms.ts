import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { authkeyGetRequest } from "./authkey.client.js";

export type AuthkeySmsTemplatePayload = {
  /** Local mobile number (no country code) — per Authkey `mobile` parameter */
  mobile: string;
  /** E.g. `91` for India — Authkey `country_code` */
  countryCode: string;
  /** SMS template id from Authkey console (`sid`) */
  sid: number;
  /** Dynamic placeholders — appended as query parameters */
  params?: Record<string, string>;
};

/**
 * Sends an SMS using an Authkey template (`sid`).
 * Requires `AUTHKEY_AUTH_KEY` and `MAIL_PROVIDER=authkey` is **not** required — SMS uses the same Authkey key.
 */
export const smsService = {
  async sendTemplate(payload: AuthkeySmsTemplatePayload): Promise<void> {
    const key = env.AUTHKEY_AUTH_KEY?.trim();
    if (!key) {
      logger.warn({}, "sms_authkey_missing_auth_key");
      return;
    }

    const query: Record<string, string> = {
      authkey: key,
      mobile: payload.mobile.trim(),
      country_code: payload.countryCode.trim(),
      sid: String(payload.sid),
      ...(payload.params ?? {}),
    };

    try {
      const res = await authkeyGetRequest(query);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        logger.warn({ status: res.status, body: body.slice(0, 300), sid: payload.sid }, "sms_authkey_http_error");
      }
    } catch (err) {
      logger.warn({ err, sid: payload.sid }, "sms_authkey_request_failed");
    }
  },
};
