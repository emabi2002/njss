import type { NextConfig } from 'next'

/** Explicit root is essential when this independent product is staged in a subdirectory
 * of the existing NJSS repository; it prevents bundling NJSS's proxy or dependencies.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
}
export default nextConfig
