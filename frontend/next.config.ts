import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// "Without i18n routing" — locale resolved from cookie/Accept-Language in src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Pin the Turbopack workspace root to the repo root. A stray lockfile above the repo (e.g.
// ~/package-lock.json) otherwise makes Turbopack infer the *home directory* as root and scan all of
// it — which made `next dev` take minutes per route and OOM. We walk up to the nearest `.git` so it
// resolves correctly whether dev runs from `frontend/` or the demo's `demo/.web/` copy (whose
// node_modules symlinks into `frontend/` — both live under the repo root, so the symlink stays
// inside it and Turbopack accepts it). Dev-only; ignored by the production build.
function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    dir = dirname(dir);
  }
  return start;
}

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: findRepoRoot(process.cwd()),
  },
  // The app never uses next/image — all media is plain <img> served by nginx straight from
  // /uploads. This flag is a safety net so the Image optimizer is never invoked if one slips in.
  images: {
    unoptimized: true,
  },
  devIndicators: {
    position: "bottom-right",
  },
  experimental: {
    proxyClientMaxBodySize: 300 * 1024 * 1024, // 300 MB — matches backend max_upload_bytes
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
