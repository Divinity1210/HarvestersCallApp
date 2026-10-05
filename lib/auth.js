import * as jose from 'jose';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'harvesters-secure-call-center-key-32-chars-min-2026'
);

export const AUTH_COOKIE_NAME = 'harvesters_auth_token';

/**
 * Hashes a plaintext password using bcrypt.
 */
export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

/**
 * Compares plaintext password to a bcrypt hash.
 */
export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Creates a signed JWT valid for 7 days.
 */
export async function createToken(payload) {
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);
}

/**
 * Verifies a signed JWT token and returns payload, or null if invalid.
 */
export async function verifyToken(token) {
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET);
    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Server-side helper to get authenticated user from incoming cookie.
 */
export async function getSessionUser() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    if (!token) return null;
    return await verifyToken(token);
  } catch {
    return null;
  }
}

/** True for admin and super_admin roles. */
export function isAdminRole(role) {
  return role === 'admin' || role === 'super_admin';
}

/**
 * Generates an easy-to-read-aloud temporary password, e.g. "Grace-4827-Lamp".
 * Unique per user (unlike the old shared "Welcome2026!").
 */
export function generateTempPassword() {
  const words = [
    'Grace', 'Faith', 'Hope', 'Light', 'River', 'Harvest', 'Shine', 'Peace',
    'Lamp', 'Crown', 'Dove', 'Rock', 'Bread', 'Seed', 'Vine', 'Star',
  ];
  const bytes = new Uint32Array(3);
  globalThis.crypto.getRandomValues(bytes);
  const w1 = words[bytes[0] % words.length];
  const w2 = words[bytes[1] % words.length];
  const num = String(1000 + (bytes[2] % 9000));
  return `${w1}-${num}-${w2}`;
}
