import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default withBundleAnalyzer({
  distDir: process.env.VELA_PUBLIC_MODE === 'true' ? '.next-public' : '.next',
  productionBrowserSourceMaps: false,
  allowedDevOrigins: [
    '127.0.0.1',
    ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => new URL(origin).hostname),
  ],
  reactStrictMode: false,
  experimental: {
    optimizePackageImports: ['@mantine/core', '@mantine/hooks'],
  },
});
