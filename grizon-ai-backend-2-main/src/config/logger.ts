import type { PrettyOptions } from "pino-pretty";

const LEVEL_ICONS = {
  trace: "🔍",
  debug: "🐛",
  info: "ℹ️ ",
  warn: "⚠️ ",
  error: "❌",
  fatal: "💥",
};

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  green: "\x1b[32m",
  gray: "\x1b[90m",
};

export function getPrettyOptions(): PrettyOptions {
  return {
    colorize: true,
    levelFirst: true,
    translateTime: "SYS:standard",
    ignore: "pid,hostname,service,version",
    hideObject: false,
    errorLikeObjectKeys: ["err", "error", "exception"],
    singleLine: false,
    colorizeObjects: true,
    sync: false,
    customPrettifiers: {
      level: (logLevel) => {
        const levelStr = String(logLevel).toLowerCase();
        const icon = LEVEL_ICONS[levelStr as keyof typeof LEVEL_ICONS] || "📝";
        const colors: Record<string, string> = {
          trace: COLORS.dim,
          debug: COLORS.cyan,
          info: COLORS.blue,
          warn: COLORS.yellow,
          error: COLORS.red,
          fatal: COLORS.magenta,
        };
        const color = colors[levelStr] || COLORS.reset;
        return `${color}${icon} ${levelStr.padEnd(5).toUpperCase()}${COLORS.reset}`;
      },
      time: () => {
        const now = new Date();
        const time = now.toISOString().split("T")[1]?.split(".")[0] || "";
        return `${COLORS.gray}[${time}]${COLORS.reset}`;
      },
      req_id: (val) => {
        if (!val) return "";
        return `${COLORS.blue}req:${val}${COLORS.reset}`;
      },
      user_id: (val) => {
        if (!val) return "";
        return `${COLORS.green}user:${val}${COLORS.reset}`;
      },
      duration_ms: (val) => {
        if (!val) return "";
        const duration = Number(val);
        let color = COLORS.green;
        if (duration > 1000) color = COLORS.red;
        else if (duration > 500) color = COLORS.yellow;
        return `${color}${duration}ms${COLORS.reset}`;
      },
      status: (val) => {
        if (!val) return "";
        const status = Number(val);
        let color = COLORS.green;
        if (status >= 500) color = COLORS.red;
        else if (status >= 400) color = COLORS.yellow;
        return `${color}${status}${COLORS.reset}`;
      },
    },
  };
}
