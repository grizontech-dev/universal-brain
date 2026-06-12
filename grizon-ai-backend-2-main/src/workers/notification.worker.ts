import { Worker } from "bullmq";

import { authkeyMidForNotificationTemplate } from "../config/authkey.js";
import { env } from "../config/env.js";
import { QUEUE_NAMES, WORKER_CONCURRENCY } from "../config/queue.js";
import { mailerService } from "../infra/mailer.js";
import {
  bannedTemplate,
  newDeviceTemplate,
  passwordChangedTemplate,
  rateLimitFlaggedTemplate,
  topupSucceededTemplate,
  welcomeTemplate,
} from "../notifications/templates.js";
import type { NotificationJobPayload } from "../types/notificationJob.js";
import { logger } from "../utils/logger.js";

const templateFns: Record<
  NotificationJobPayload["template"],
  (vars: NotificationJobPayload["vars"]) => { subject: string; html: string; text: string }
> = {
  welcome: welcomeTemplate,
  new_device: newDeviceTemplate,
  password_changed: passwordChangedTemplate,
  banned: bannedTemplate,
  topup_succeeded: topupSucceededTemplate,
  rate_limit_flagged: rateLimitFlaggedTemplate,
};

function varsToAuthkeyParams(vars: NotificationJobPayload["vars"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(vars)) {
    out[key] = String(val);
  }
  return out;
}

export function startNotificationWorker() {
  return new Worker<NotificationJobPayload>(
    QUEUE_NAMES.notification,
    async (job) => {
      const channels = job.data.channels ?? [];
      const sendEmail = channels.length === 0 || channels.includes("email");
      if (!sendEmail) {
        return;
      }

      const fn = templateFns[job.data.template];
      if (!fn) {
        logger.warn({ template: job.data.template }, "notification_unknown_template");
        return;
      }

      const to = String(job.data.vars.email ?? "").trim();
      if (!to) {
        logger.warn({ jobId: job.id, template: job.data.template }, "notification_missing_email");
        return;
      }

      const { subject, html, text } = fn(job.data.vars);
      const authkeyMid = authkeyMidForNotificationTemplate(job.data.template);
      await mailerService.send({
        to,
        subject,
        text,
        html,
        authkeyMid,
        authkeyParams: varsToAuthkeyParams(job.data.vars),
      });
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: WORKER_CONCURRENCY.notification,
    },
  );
}
