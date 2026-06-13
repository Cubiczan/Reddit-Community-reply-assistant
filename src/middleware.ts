import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuthResponse } from '@/lib/resilience/auth';

/**
 * Fail-closed auth gate for the API surface.
 *
 * Every `/api/*` route requires a bearer token equal to API_SHARED_SECRET,
 * EXCEPT the public health endpoint at `/api` (src/app/api/route.ts).
 *
 * When API_SHARED_SECRET is unset the gate fails CLOSED: `requireAuthResponse`
 * returns a 503 (server misconfigured) rather than allowing the request through.
 */
export function middleware(request: NextRequest): NextResponse | Response {
  const { pathname } = request.nextUrl;

  // Public health endpoint — src/app/api/route.ts only (exactly `/api`).
  if (pathname === '/api' || pathname === '/api/') {
    return NextResponse.next();
  }

  const denied = requireAuthResponse(request, {
    token: process.env.API_SHARED_SECRET,
  });
  if (denied) return denied;

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
