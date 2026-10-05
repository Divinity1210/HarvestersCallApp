import { NextResponse } from 'next/server';
import * as jose from 'jose';

/**
 * proxy.js (Next.js 16 replacement for middleware.js)
 *
 * Central API access control. Before this existed every route handler was
 * publicly callable — including admin user creation and contact exports.
 *
 *  PUBLIC          login/logout, app-version, Twilio webhooks
 *  INTERNAL        /api/ai/process-call (cookie OR x-internal-secret header)
 *  ADMIN ONLY      /api/admin/*, /api/agents/*, /api/export/*, lead imports,
 *                  campaign writes (POST/PUT/PATCH/DELETE)
 *  AUTHENTICATED   everything else under /api
 */

const AUTH_COOKIE_NAME = 'harvesters_auth_token';
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'harvesters-secure-call-center-key-32-chars-min-2026'
);
const ADMIN_ROLES = new Set(['admin', 'super_admin']);

const PUBLIC_PREFIXES = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/app-version',
  '/api/twilio/voice',
  '/api/twilio/call-status',
  '/api/twilio/recording-status',
];

const ADMIN_PREFIXES = [
  '/api/admin/',
  '/api/agents',
  '/api/export/',
  '/api/leads/import-csv',
  '/api/leads/import-google-sheet',
];

function deny(status, error) {
  const res = NextResponse.json({ error }, { status });
  if (status === 401) res.headers.set('x-auth-required', '1');
  return res;
}

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  if (method === 'OPTIONS') return NextResponse.next();
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) return NextResponse.next();

  // Server-to-server AI processing (triggered by Twilio recording webhook)
  if (pathname.startsWith('/api/ai/process-call')) {
    const internal = request.headers.get('x-internal-secret');
    const expected = process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET || 'harvesters-internal';
    if (internal && internal === expected) return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return deny(401, 'Please sign in to continue.');

  let user;
  try {
    ({ payload: user } = await jose.jwtVerify(token, JWT_SECRET));
  } catch {
    return deny(401, 'Your session has expired. Please sign in again.');
  }

  const isAdmin = ADMIN_ROLES.has(user.role);
  const isCampaignWrite = pathname.startsWith('/api/campaigns') && method !== 'GET';

  if (!isAdmin && (isCampaignWrite || ADMIN_PREFIXES.some(p => pathname.startsWith(p)))) {
    return deny(403, 'Admin access required.');
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
