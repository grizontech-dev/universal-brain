import type { FeatureName, FeatureWindow } from "../types/feature.js";

export const FEATURE_NAMES = ["webSearch", "codeExecution"] as const;

const WINDOW_CONFIG: Record<FeatureName, Partial<Record<FeatureWindow, { keySegment: string; ttlSeconds: number }>>> =
  {
    webSearch: {
      daily: { keySegment: "websearch", ttlSeconds: 86_400 },
      monthly: { keySegment: "websearch", ttlSeconds: 2_592_000 },
    },
    codeExecution: {
      hourly: { keySegment: "codeexec", ttlSeconds: 3_600 },
      daily: { keySegment: "codeexec", ttlSeconds: 86_400 },
    },
  };

export function windowsFor(feature: FeatureName): FeatureWindow[] {
  return Object.keys(WINDOW_CONFIG[feature]) as FeatureWindow[];
}

export function ttlFor(feature: FeatureName, window: FeatureWindow): number {
  const cfg = WINDOW_CONFIG[feature][window];
  if (!cfg) {
    throw new Error(`unsupported_feature_window:${feature}:${window}`);
  }
  return cfg.ttlSeconds;
}

export function keyFor(feature: FeatureName, window: FeatureWindow, userId: string): string {
  const cfg = WINDOW_CONFIG[feature][window];
  if (!cfg) {
    throw new Error(`unsupported_feature_window:${feature}:${window}`);
  }
  return `feature:${cfg.keySegment}:${window}:${userId}`;
}

export function headerNamesFor(feature: FeatureName, window: FeatureWindow): {
  limit: string;
  remaining: string;
} {
  const featureLabel = feature === "webSearch" ? "WebSearch" : "CodeExec";
  const windowLabel = window.charAt(0).toUpperCase() + window.slice(1);
  return {
    limit: `X-Feature-${featureLabel}-${windowLabel}-Limit`,
    remaining: `X-Feature-${featureLabel}-${windowLabel}-Remaining`,
  };
}
