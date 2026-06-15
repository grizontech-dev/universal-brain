import type { NextConfig } from "next";
import path from "path";

const brainApiTarget = process.env.BRAIN_API_PROXY_TARGET || process.env.NEXT_PUBLIC_BRAIN_API_URL || "http://127.0.0.1:8001";

const nextConfig: NextConfig = {
  // Allow cross-origin requests for WebSocket connections
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  
  turbopack: {
    root: path.resolve(__dirname),
  },
  async rewrites() {
    return [
      {
        source: "/api/brain/:path*",
        destination: `${brainApiTarget}/brain/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/brain/:path*",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        // Apply these headers to all routes
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
          {
            key: "Cross-Origin-Resource-Policy",
            value: "cross-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
