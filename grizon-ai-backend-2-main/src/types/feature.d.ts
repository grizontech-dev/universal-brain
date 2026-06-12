export interface FeatureFlags {
  webSearch: boolean;
  smartSynthesizer: boolean;
  deepResearch: boolean;
  fileUpload: boolean;
  documentCreation: boolean;
  documentAnalysis: boolean;
  codeExecution: boolean;
  codeAgent: boolean;
  htmlPreview: boolean;
  uiGenerator: boolean;
  artifactVersioning: boolean;
  customSystemPrompt: boolean;
  temperatureControl: boolean;
  longTermMemory: boolean;
  conversationSummary: boolean;
  voiceMode: boolean;
  /** Yahoo Finance tool (Starter+) */
  stockData?: boolean;
  /** OpenWeatherMap tool (Free+) */
  weatherData?: boolean;
  /** SSRF-guarded URL fetch (Starter+) */
  webFetch?: boolean;
  /** Matplotlib chart generation (Pro+) */
  chartGenerate?: boolean;
  /** Vision describe / analyse uploaded images (Starter+) */
  imageAnalyse?: boolean;
}

export type FeatureLimitValue = {
  hourlyLimit?: number | null;
  dailyLimit?: number | null;
  monthlyLimit?: number | null;
};

export interface FeatureLimits {
  webSearch: {
    dailyLimit: number | null;
    monthlyLimit: number | null;
  } | null;
  codeExecution: {
    hourlyLimit: number | null;
    dailyLimit: number | null;
  } | null;
}

export type FeatureName = keyof FeatureLimits;

export type FeatureWindow = "hourly" | "daily" | "monthly";
