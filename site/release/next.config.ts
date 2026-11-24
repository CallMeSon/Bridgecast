import type { NextConfig } from 'next'

// Static export for GitHub Pages; the Pages workflow sets BASEPATH=/Bridgecast.
const nextConfig: NextConfig = {
  output: 'export',
  basePath: process.env.BASEPATH ?? '',
  images: { unoptimized: true },
  reactStrictMode: true,
  pageExtensions: ['js', 'jsx', 'ts', 'tsx']
}

export default nextConfig
