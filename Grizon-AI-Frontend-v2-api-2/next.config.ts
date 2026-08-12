import type { NextConfig } from "next";
import path from "path";

const brainApiTarget = process.env.BRAIN_API_PROXY_TARGET || process.env.NEXT_PUBLIC_BRAIN_API_URL || "http://127.0.0.1:8001";

const nextConfig: NextConfig = {
  // Allow cross-origin requests for WebSocket connections
  allowedDevOrigins: ['localhost', '127.0.0.1'],

  turbopack: {
    root: path.resolve(__dirname),
  },
  async redirects() {
    return [
      {
        source: '/chat',
        destination: '/brain',
        permanent: false,
      },
      {
        source: '/chat/:path*',
        destination: '/brain/:path*',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    const backendTarget = process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:4000";
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendTarget}/api/v1/:path*`,
      },
      {
        source: "/api/brain/:path*",
        destination: `${brainApiTarget}/brain/:path*`,
      },
    ];
  },
  async headers() {
    return [];
  },
};

export default nextConfig;
