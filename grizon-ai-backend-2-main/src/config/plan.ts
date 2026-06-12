import { z } from "zod";

const schema = z.object({
  FREE_PLAN_ID: z.string().optional(),
  PLAN_ROLLOVER_GRACE_PERIOD_DAYS: z.coerce.number().int().nonnegative().optional(),
  PHONEPE_MERCHANT_ID: z.string().optional(),
  PHONEPE_SALT_KEY: z.string().optional(),
  PHONEPE_SALT_INDEX: z.string().optional(),
  PHONEPE_BASE_URL: z.string().optional(),
});

const env = schema.safeParse(process.env);
if (!env.success) {
  throw new Error(`Invalid plan-related env: ${env.error.message}`);
}

export const planConfig = {
  freePlanId: env.data.FREE_PLAN_ID ?? "plan_free_v1",
  currency: "inr" as const,
  defaultBillingCycle: "monthly" as const,
  rolloverGracePeriodDays: env.data.PLAN_ROLLOVER_GRACE_PERIOD_DAYS ?? 7,
  phonepe: {
    merchantId: env.data.PHONEPE_MERCHANT_ID ?? "",
    saltKey: env.data.PHONEPE_SALT_KEY ?? "",
    saltIndex: env.data.PHONEPE_SALT_INDEX ?? "",
    baseUrl: env.data.PHONEPE_BASE_URL ?? "https://api.phonepe.com/apis/hermes",
  },
};
