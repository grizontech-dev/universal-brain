import type { RequestHandler } from "express";
import { handleWebhook } from "../../services/payment/payment.service.js";
import { AppError, Errors } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";

export const phonePeWebhookController: RequestHandler = async (req, res) => {
  const rawBody = req.body as Buffer;
  const authHeader = req.header("Authorization") ?? "";

  try {
    await handleWebhook(rawBody, authHeader);
    res.status(200).json({ success: true });
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "WEBHOOK_SIGNATURE_INVALID") {
        logger.warn({ ip: req.ip }, "webhook_signature_invalid");
        res.status(401).json({ success: false, code: e.code });
        return;
      }
      if (e.code === "WEBHOOK_DUPLICATE") {
        res.status(200).json({ success: true, note: "duplicate" });
        return;
      }
    }
    logger.error({ err: e }, "webhook_processing_error");
    res.status(200).json({ success: true }); // Always 200 to avoid PhonePe retries on our bugs
  }
};
