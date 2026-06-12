import { env } from "../config/env.js";
import { registerTool } from "./registry.js";

/** Judge0 language IDs — see LAYER3 P3 infrastructure plan. */
const LANG_IDS: Record<string, number> = {
  python: 71,
  javascript: 63,
  typescript: 74,
  c: 50,
  cpp: 54,
  java: 62,
  go: 60,
  rust: 73,
  bash: 46,
};

export const SUPPORTED_CODE_LANGUAGES = Object.keys(LANG_IDS).sort();

export function normaliseJudge0Language(raw: string): string | null {
  const lang = raw.toLowerCase().trim();
  if (lang === "c++") return "cpp";
  if (lang in LANG_IDS) return lang;
  return null;
}

const LANG_LIST_DESC =
  "python, javascript, typescript, c, cpp (or c++), java, go, rust, bash";

export async function codeExecution(args: {
  language: string;
  source: string;
}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  if (!env.JUDGE0_URL?.trim()) {
    return { stdout: "", stderr: "Judge0 is not configured.", exitCode: null };
  }
  const canonical = normaliseJudge0Language(args.language);
  if (!canonical) {
    return {
      stdout: "",
      stderr: `Unsupported language: ${args.language}. Supported: ${SUPPORTED_CODE_LANGUAGES.join(", ")}, c++.`,
      exitCode: null,
    };
  }
  const languageId = LANG_IDS[canonical];

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10_000);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (env.JUDGE0_API_KEY) {
      headers["X-Auth-Token"] = env.JUDGE0_API_KEY;
    }
    const res = await fetch(`${env.JUDGE0_URL.replace(/\/$/, "")}/submissions?base64_encoded=false&wait=true`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        source_code: args.source,
        language_id: languageId,
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      return { stdout: "", stderr: `Judge0 HTTP ${res.status}`, exitCode: null };
    }
    const data = (await res.json()) as {
      stdout?: string | null;
      stderr?: string | null;
      exit_status?: number | null;
    };
    return {
      stdout: data.stdout ?? "",
      stderr: data.stderr ?? "",
      exitCode: data.exit_status ?? null,
    };
  } catch (err) {
    return { stdout: "", stderr: String(err), exitCode: null };
  }
}

registerTool({
  name: "code_execution",
  description: `Execute code in a sandbox (Judge0). Supported languages: ${LANG_LIST_DESC}. Returns stdout, stderr, exit code.`,
  parallelSafe: false,
  estimatedLatencyMs: 5000,
  planRequired: "starter",
  featureFlag: "codeExecution",
  parametersSchema: {
    type: "object",
    properties: {
      language: { type: "string", description: LANG_LIST_DESC },
      source: { type: "string", description: "Source code" },
    },
    required: ["language", "source"],
  },
  execute: async (params) => {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    return codeExecution({
      language: String(p.language ?? "python"),
      source: String(p.source ?? ""),
    });
  },
});
