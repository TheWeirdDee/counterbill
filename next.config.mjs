/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['pg', '@mozaik-ai/core', 'unpdf', 'pdf-lib', '@pdf-lib/fontkit', 'embedded-postgres'],
  // The product used to call these pages "demo". Old links keep working.
  async redirects() {
    return [
      { source: '/demo', destination: '/examples', permanent: true },
      { source: '/demo/:path*', destination: '/examples/:path*', permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default nextConfig;
