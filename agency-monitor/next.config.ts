import type { NextConfig } from 'next'

/** Explicit root when staging this independent app inside the NJSS repository. */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
}
export default nextConfig
