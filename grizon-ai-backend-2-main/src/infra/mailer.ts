import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { authkeyGetRequest } from "./authkey.client.js";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Authkey console email template id (`mid`). Required for Authkey sends when using templates. */
  authkeyMid?: number;
  /** Dynamic fields — passed as query params; match `{#name#}` placeholders in the Authkey template. */
  authkeyParams?: Record<string, string>;
};

export interface MailerService {
  send(message: MailMessage): Promise<void>;
  sendHtml(opts: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    authkeyMid?: number;
    authkeyParams?: Record<string, string>;
  }): Promise<void>;
}

class LoggingMailerService implements MailerService {
  async send(message: MailMessage): Promise<void> {
    // Phase 1: keep mailer side-effects minimal.
    // eslint-disable-next-line no-console
    console.info(
      {
        provider: env.MAIL_PROVIDER,
        subject: message.subject,
        hasHtml: Boolean(message.html),
        textChars: message.text.length,
        authkeyMid: message.authkeyMid,
      },
      "mail_send",
    );
  }

  async sendHtml(opts: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    authkeyMid?: number;
    authkeyParams?: Record<string, string>;
  }): Promise<void> {
    await this.send({
      to: opts.to,
      subject: opts.subject,
      text: opts.text ?? "(HTML email)",
      html: opts.html,
      authkeyMid: opts.authkeyMid,
      authkeyParams: opts.authkeyParams,
    });
  }
}

class AuthkeyMailerService implements MailerService {
  constructor(private readonly fallback: LoggingMailerService) {}

  async send(message: MailMessage): Promise<void> {
    const key = env.AUTHKEY_AUTH_KEY?.trim();
    const mid = message.authkeyMid;

    if (!key) {
      logger.warn({}, "authkey_mailer_missing_auth_key_fallback");
      await this.fallback.send(message);
      return;
    }

    if (mid === undefined || mid <= 0) {
      logger.warn({ to: message.to }, "authkey_mailer_missing_mid_fallback");
      await this.fallback.send(message);
      return;
    }

    const query: Record<string, string> = {
      authkey: key,
      email: message.to,
      mid: String(mid),
      ...(message.authkeyParams ?? {}),
    };

    try {
      const res = await authkeyGetRequest(query);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        logger.warn(
          { status: res.status, body: body.slice(0, 300), to: message.to, mid },
          "authkey_email_http_error",
        );
      }
    } catch (err) {
      logger.warn({ err, to: message.to, mid }, "authkey_email_request_failed");
    }
  }

  async sendHtml(opts: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    authkeyMid?: number;
    authkeyParams?: Record<string, string>;
  }): Promise<void> {
    await this.send({
      to: opts.to,
      subject: opts.subject,
      text: opts.text ?? "",
      html: opts.html,
      authkeyMid: opts.authkeyMid,
      authkeyParams: opts.authkeyParams,
    });
  }
}

const loggingMailer = new LoggingMailerService();

export const mailerService: MailerService =
  env.MAIL_PROVIDER === "authkey" ? new AuthkeyMailerService(loggingMailer) : loggingMailer;
