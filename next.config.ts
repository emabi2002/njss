import type { NextConfig } from "next";

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const nextConfig: NextConfig = {
  // Public release metadata only. Credentials must never be put in this object.
  env: {
    NEXT_PUBLIC_COMMIT_SHA: process.env.COMMIT_REF?.trim() || process.env.VERCEL_GIT_COMMIT_SHA?.trim() || process.env.NEXT_PUBLIC_COMMIT_SHA?.trim() || process.env.COMMIT_SHA?.trim() || 'Not Available',
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    unoptimized: true,
  },
  allowedDevOrigins: [
    '3000-ljoeqynohlashpwykwcjmsopjvlpkhis.preview.same-app.com',
    '*.preview.same-app.com',
    '*.same-app.com',
  ],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
};

export default nextConfig;
