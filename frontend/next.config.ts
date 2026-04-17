import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const securityHeaders = [
  // Prevent clickjacking — stops the site being embedded in iframes
  { key: "X-Frame-Options", value: "DENY" },
  // Prevent MIME-type sniffing attacks
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Limit referrer info sent to third-party domains
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable browser features the site doesn't use
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Enforce HTTPS in production (2-year max-age)
  ...(!isDev
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
  // Content Security Policy
  // Note: 'unsafe-inline' is required by Next.js for hydration scripts.
  // For a stricter CSP, migrate to nonce-based scripts (next.config nonce support).
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js hydration needs unsafe-inline; dev HMR additionally needs unsafe-eval
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://pagead2.googlesyndication.com https://partner.googleadservices.com`,
      "style-src 'self' 'unsafe-inline'",
      // Allow images from HTTPS and data URIs (favicons, inline SVG)
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      // API connections: Supabase + geocoding services
      "connect-src 'self' https://*.supabase.co https://geocoding.geo.census.gov https://nominatim.openstreetmap.org",
      // Stripe checkout is a full-page redirect, but stripe.js needs frame access
      "frame-src https://js.stripe.com https://checkout.stripe.com",
      // Block plugins (Flash, etc.)
      "object-src 'none'",
      // Prevent base-tag hijacking
      "base-uri 'self'",
      // Restrict where forms can submit
      "form-action 'self' https://checkout.stripe.com",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
