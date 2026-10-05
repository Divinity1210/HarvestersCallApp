// Smoke test: proxy access control + invite → first sign-in → change password flow.
// Usage: node scripts/smoke-auth.mjs [baseUrl]
import fs from 'node:fs';
import * as jose from 'jose';
import { neon } from '@neondatabase/serverless';

const BASE = process.argv[2] || 'http://localhost:3055';
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const sql = neon(env.DATABASE_URL);
const secret = new TextEncoder().encode(env.JWT_SECRET || 'harvesters-secure-call-center-key-32-chars-min-2026');
const sign = (p) => new jose.SignJWT(p).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m').sign(secret);

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}${extra ? '  — ' + extra : ''}`); };
const call = async (path, { token, method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { cookie: `harvesters_auth_token=${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
};

const [admin] = await sql.query(`SELECT id, email, full_name, role FROM users WHERE role IN ('super_admin','admin') AND is_active LIMIT 1`);
const adminToken = await sign({ id: admin.id, email: admin.email, full_name: admin.full_name, role: admin.role });
const fakeAgentToken = await sign({ id: admin.id, email: 'x@x', full_name: 'x', role: 'agent' });

// ── Proxy rules
check('anon /api/auth/me → 401', (await call('/api/auth/me')).status === 401);
check('anon /api/agents → 401', (await call('/api/agents')).status === 401);
check('anon /api/export/calls → 401', (await call('/api/export/calls')).status === 401);
check('anon /api/app-version public', (await call('/api/app-version')).status === 200);
check('forged token → 401', (await call('/api/agents', { token: 'abc.def.ghi' })).status === 401);
check('agent /api/agents → 403', (await call('/api/agents', { token: fakeAgentToken })).status === 403);
check('agent DELETE campaign → 403', (await call('/api/campaigns/00000000-0000-0000-0000-000000000000', { token: fakeAgentToken, method: 'DELETE' })).status === 403);
check('agent GET campaigns ok', (await call('/api/campaigns', { token: fakeAgentToken })).status === 200);
check('admin /api/agents ok', (await call('/api/agents', { token: adminToken })).status === 200);

// ── Invite flow
const email = `smoke+${Date.now()}@test.local`;
const inv = await call('/api/agents/invite', { token: adminToken, method: 'POST', body: { email, fullName: 'Smoke Tester', role: 'agent' } });
check('invite returns credentials', inv.status === 200 && !!inv.json?.credentials?.tempPassword, JSON.stringify(inv.json)?.slice(0, 160));
const temp = inv.json?.credentials?.tempPassword;

if (temp) {
  const login = await call('/api/auth/login', { method: 'POST', body: { email, password: temp } });
  check('temp login ok + must_change_password', login.status === 200 && login.json?.profile?.must_change_password === true);
  const tok = login.setCookie?.match(/harvesters_auth_token=([^;]+)/)?.[1];
  check('login sets cookie', !!tok);

  const short = await call('/api/auth/change-password', { token: tok, method: 'POST', body: { currentPassword: temp, newPassword: 'short' } });
  check('short password rejected', short.status === 400);
  const ch = await call('/api/auth/change-password', { token: tok, method: 'POST', body: { currentPassword: temp, newPassword: 'MyNewPass123' } });
  check('change password ok', ch.status === 200, JSON.stringify(ch.json));
  const me = await call('/api/auth/me', { token: tok });
  check('/me flag cleared', me.json?.profile?.must_change_password === false);
  check('new agent blocked from /api/agents', (await call('/api/agents', { token: tok })).status === 403);
  check('old temp password no longer works', (await call('/api/auth/login', { method: 'POST', body: { email, password: temp } })).status === 401);

  const [u] = await sql.query(`SELECT id FROM users WHERE email = $1`, [email]);
  const rs = await call('/api/agents/reset-password', { token: adminToken, method: 'POST', body: { agentId: u.id } });
  check('admin reset-password returns new temp', rs.status === 200 && !!rs.json?.credentials?.tempPassword);
  const relog = await call('/api/auth/login', { method: 'POST', body: { email, password: rs.json?.credentials?.tempPassword } });
  check('login with reset password + flag set', relog.status === 200 && relog.json?.profile?.must_change_password === true);
}

// cleanup
await sql.query(`DELETE FROM users WHERE email = $1`, [email]).catch(e => console.log('cleanup:', e.message));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
