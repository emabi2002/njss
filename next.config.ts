import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
