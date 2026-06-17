import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// "Without i18n routing" — locale resolved from cookie/Accept-Language in src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  // The app never uses next/image — all media is plain <img> served by nginx straight from
  // /uploads. This flag is a safety net so the Image optimizer is never invoked if one slips in.
  images: {
    unoptimized: true,
  },
  devIndicators: {
    position: "bottom-right",
  },
  experimental: {
    proxyClientMaxBodySize: 250 * 1024 * 1024, // 250 MB — matches backend max_upload_bytes
  },
  async rewrites() {
    // In development: proxy /api and /uploads to the FastAPI backend
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000"}/api/:path*`,
      },
      {
        source: "/uploads/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000"}/uploads/:path*`,
      },
      {
        source: "/branding/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000"}/branding/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
