import { env } from "../config/env.js";
import { registerTool } from "./registry.js";
import type { StreamContext } from "../types/router.js";

const BASE = "https://api.openweathermap.org/data/2.5";

export async function getWeather(
  params: { reason?: string; location: string; units?: "metric" | "imperial" },
  _ctx: StreamContext,
): Promise<unknown> {
  const apiKey = env.OPENWEATHERMAP_API_KEY;
  if (!apiKey?.trim()) {
    return { error: "Weather API not configured" };
  }
  const units = params.units ?? "metric";
  const encoded = encodeURIComponent(params.location);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);

  try {
    const currentRes = await fetch(`${BASE}/weather?q=${encoded}&units=${units}&appid=${apiKey}`, {
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!currentRes.ok) {
      const body = (await currentRes.json().catch(() => ({}))) as { message?: string };
      return { error: `Weather API error: ${body.message ?? currentRes.status}` };
    }
    const current = (await currentRes.json()) as {
      name?: string;
      sys?: { country?: string };
      weather?: Array<{ description?: string }>;
      main?: { temp?: number; feels_like?: number; humidity?: number };
      wind?: { speed?: number };
    };

    const forecastRes = await fetch(
      `${BASE}/forecast?q=${encoded}&units=${units}&cnt=8&appid=${apiKey}`,
      {
        signal: AbortSignal.timeout(8000),
      },
    );
    const forecast = forecastRes.ok ? ((await forecastRes.json()) as { list?: unknown[] }) : null;

    return {
      location: `${current.name ?? params.location}, ${current.sys?.country ?? ""}`.trim(),
      current: {
        condition: current.weather?.[0]?.description,
        temp: current.main?.temp,
        feelsLike: current.main?.feels_like,
        humidity: current.main?.humidity,
        windSpeed: current.wind?.speed,
      },
      forecast:
        forecast?.list?.map((raw: unknown) => {
          const f = raw as {
            dt_txt?: string;
            weather?: Array<{ description?: string }>;
            main?: { temp?: number };
          };
          return {
            time: f.dt_txt,
            condition: f.weather?.[0]?.description,
            temp: f.main?.temp,
          };
        }) ?? [],
      units,
    };
  } catch (err) {
    clearTimeout(t);
    return { error: String(err) };
  }
}

registerTool({
  name: "get_weather",
  description: "Current weather and short-range forecast for a location (OpenWeatherMap).",
  parallelSafe: true,
  estimatedLatencyMs: 2000,
  planRequired: "free",
  featureFlag: "weatherData",
  parametersSchema: {
    type: "object",
    properties: {
      reason: { type: "string" },
      location: { type: "string", description: 'City e.g. "London" or "Mumbai, IN"' },
      units: { type: "string", enum: ["metric", "imperial"] },
    },
    required: ["location"],
  },
  execute: async (params, ctx) => {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    const u = p.units === "imperial" || p.units === "metric" ? p.units : undefined;
    return getWeather(
      {
        reason: p.reason !== undefined ? String(p.reason) : undefined,
        location: String(p.location ?? ""),
        units: u,
      },
      ctx,
    );
  },
});
