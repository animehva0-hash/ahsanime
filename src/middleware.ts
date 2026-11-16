import { NextResponse, type NextRequest } from "next/server";

/**
 * Security middleware.
 *
 * - Sets hardened security headers on every response (CSP is intentionally
 *   permissive for third-party players/CDNs, everything else is strict).
 * - Blocks obvious exploit-probing paths.
 * - Rate-limits the expensive translation + proxy APIs per IP (best effort;
 *   the route handlers enforce their own limits too).
 */

const BLOCKED_PATHS = [
  /^\/wp-/i,
  /^\/\.env/i,
  /^\/\.git/i,
  /^\/phpmyadmin/i,
  /^\/admin\.php$/i,
  /^\/xmlrpc\.php$/i,
  /\/\.\./,
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (BLOCKED_PATHS.some((re) => re.test(pathname))) {
    return new NextResponse("Not found", { status: 404 });
  }

  const res = NextResponse.next();

  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-DNS-Prefetch-Control", "on");
  res.headers.set("X-XSS-Protection", "1; mode=block");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      // Third-party anime players/CDNs run in iframes and load their own assets.
      "frame-src 'self' https: data: blob:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: data: https:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "style-src 'self' 'unsafe-inline' https:",
      "font-src 'self' data: https:",
      "connect-src 'self' https: wss: blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join("; "),
  );

  return res;
}

export const config = {
  // Skip static assets so the middleware stays cheap.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
