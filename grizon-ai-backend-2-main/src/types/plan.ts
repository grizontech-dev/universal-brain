import type {} from "express";
import type { FeatureLimits } from "./feature.js";

export type BillingCycle = "monthly" | "annual";

export type SubscriptionStatus = "active" | "past_due" | "cancelled" | "paused";

export interface PlanPricing {
  monthly: number;
  annual: number;
  currency: "inr";
}

export interface PlanCredits {
  included: number;
  rollover: boolean;
  maxRollover: number | null;
  topupEnabled: boolean;
  topupPackages: Array<{ id?: string; credits: number; price: number }>;
  /** Multiplier applied with `creditCalculator` (1 = no discount). */
  creditDiscount?: number;
}

export interface PlanLimits {
  hourly: number;
  daily: number;
  weekly: number;
  monthly: number;
  maxMessageContentLength?: number;
  maxContextMessages: number;
  maxFileSize: number;
  maxFilesPerChat: number;
  maxArtifactVersions: number;
}

/** Catalog plan & frozen snapshot shape (camelCase in JSON/API). */
export interface Plan {
  id: string;
  name: string;
  slug: string;
  status: "active" | "archived";
  isPublic: boolean;
  isIntroductory: boolean;
  pricing: PlanPricing;
  credits: PlanCredits;
  limits: PlanLimits;
  agentAccess: string[];
  featureFlags: Record<string, boolean>;
  featureLimits?: FeatureLimits;
  createdAt: string;
  archivedAt: string | null;
  createdBy: string;
}

export interface SubscriptionPublic {
  id: string;
  planId: string;
  planSnapshot: Plan;
  billingCycle: BillingCycle;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  creditsGranted: number;
  creditsRolledOver: number;
  createdAt: string;
}

export interface SubscriptionAdmin extends SubscriptionPublic {
  pgProvider: "phonepe" | null;
  pgSubscriptionId: string | null;
  pgMerchantTransactionId: string | null;
  pgCustomerRef: string | null;
}

export type SubscriptionHistoryEvent =
  | "created"
  | "upgraded"
  | "renewed"
  | "cancel_scheduled"
  | "cancelled"
  | "paused"
  | "resumed"
  | "admin_adjusted";

declare global {
  namespace Express {
    interface Request {
      plan?: Plan;
      subscription?: SubscriptionPublic;
    }
  }
}
