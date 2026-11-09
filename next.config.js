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
        // 🔒 T7.5: CSP انتقلت إلى middleware.ts (تحتاج nonce متغيّرًا لكل طلب،
        //     وترويسات next.config ثابتة تُجمَّد وقت البناء فلا تصلح لـnonce).
        //     السياسة نفسها في lib/security/csp.ts — مصدر واحد يفحصه CI.
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
  ],
};

module.exports = withPWA(nextConfig);
