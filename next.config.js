/** @type {import('next').NextConfig} */
// ✅ إصلاح: next-pwa@5.6.0 يصدّر الدالة مباشرة — لا يوجد .default
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
      handler: 'NetworkFirst',
      options: { cacheName: 'supabase', expiration: { maxEntries: 64, maxAgeSeconds: 60 * 5 } }
    }
  ]
});

const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.supabase.co' }],
  },
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none';" },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
  ],
};

module.exports = withPWA(nextConfig);
