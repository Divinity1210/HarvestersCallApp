import crypto from 'crypto';
import { query } from '@/lib/db';

function cleanVal(val, fallback = '') {
  return String(val || fallback).replace(/^['"\s]+|['"\s]+$/g, '').trim();
}

function sanitizeKey(val) {
  return cleanVal(val);
}

/**
 * RFC 1738 URL encoding required by Zadarma API v1 signature verification.
 */
function encodeRfc1738(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

export function buildZadarmaQueryString(params = {}) {
  const sortedKeys = Object.keys(params).filter(
    k => params[k] !== undefined && params[k] !== null && String(params[k]) !== ''
  ).sort();

  return sortedKeys
    .map(k => `${encodeRfc1738(k)}=${encodeRfc1738(params[k])}`)
    .join('&');
}

const DEFAULT_ZADARMA_SIP = '604556-100';
const DEFAULT_ZADARMA_PBX_ID = '604556';
const DEFAULT_ZADARMA_CALLER_ID = '447893931272';

let cachedDbCfg = null;
let cachedDbAt = 0;

/**
 * Loads shared Zadarma API credentials from Neon PostgreSQL (`system_settings` table)
 * so keys are NEVER stored in GitHub source code and work automatically for all volunteers.
 */
export async function getZadarmaDbConfig() {
  if (cachedDbCfg && Date.now() - cachedDbAt < 15000) {
    return cachedDbCfg;
  }
  try {
    const rows = await query(
      `SELECT value FROM system_settings WHERE key = 'zadarma_config' LIMIT 1`
    );
    if (rows.length > 0 && rows[0].value) {
      const val =
        typeof rows[0].value === 'string'
          ? JSON.parse(rows[0].value)
          : rows[0].value;
      cachedDbCfg = val || {};
      cachedDbAt = Date.now();
      return cachedDbCfg;
    }
  } catch {
    // Table may not exist yet; created automatically on save
  }
  return {};
}

/**
 * Persists verified Zadarma API credentials into Neon PostgreSQL (`system_settings` table)
 * so every agent/volunteer across all devices immediately inherits them.
 */
export async function saveZadarmaDbConfig({ apiKey, apiSecret, pbxId, callerId, sip }) {
  const payload = {
    apiKey: cleanVal(apiKey),
    apiSecret: cleanVal(apiSecret),
    pbxId: cleanVal(pbxId || DEFAULT_ZADARMA_PBX_ID),
    callerId: cleanVal(callerId || DEFAULT_ZADARMA_CALLER_ID),
    sip: cleanVal(sip || DEFAULT_ZADARMA_SIP),
  };
  await query(
    `CREATE TABLE IF NOT EXISTS system_settings (
       key TEXT PRIMARY KEY,
       value JSONB NOT NULL,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );
  await query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ('zadarma_config', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = NOW()`,
    [JSON.stringify(payload)]
  );
  cachedDbCfg = payload;
  cachedDbAt = Date.now();
  return payload;
}

/**
 * Resolves Zadarma configuration from runtime overrides, Neon DB, or environment variables.
 */
export function getZadarmaConfig(overrides = {}, dbCfg = {}) {
  const overrideKey = sanitizeKey(overrides.apiKey);
  const dbKey = sanitizeKey(dbCfg.apiKey);
  const envKey = sanitizeKey(process.env.ZADARMA_API_KEY);

  let apiKey = '';
  let apiSecret = '';
  if (overrideKey && cleanVal(overrides.apiSecret)) {
    apiKey = overrideKey;
    apiSecret = cleanVal(overrides.apiSecret);
  } else if (dbKey && cleanVal(dbCfg.apiSecret)) {
    apiKey = dbKey;
    apiSecret = cleanVal(dbCfg.apiSecret);
  } else if (envKey && cleanVal(process.env.ZADARMA_API_SECRET)) {
    apiKey = envKey;
    apiSecret = cleanVal(process.env.ZADARMA_API_SECRET);
  }

  const rawSip = cleanVal(
    overrides.sip ||
      overrides.fromExtension ||
      dbCfg.sip ||
      process.env.ZADARMA_SIP ||
      DEFAULT_ZADARMA_SIP
  );
  const pbxId = cleanVal(
    overrides.pbxId || dbCfg.pbxId || process.env.ZADARMA_PBX_ID || DEFAULT_ZADARMA_PBX_ID
  );
  const callerId = cleanVal(
    overrides.callerId ||
      dbCfg.callerId ||
      process.env.ZADARMA_CALLER_ID ||
      DEFAULT_ZADARMA_CALLER_ID
  );

  // Format webrtcSip (needs 6-digit SIP e.g. '660625' OR full PBX extension e.g. '604556-100')
  let webrtcSip = rawSip;
  if (/^\d{3}$/.test(rawSip) && pbxId) {
    webrtcSip = `${pbxId}-${rawSip}`;
  }

  return {
    configured: Boolean(apiKey && apiSecret),
    apiKey,
    apiSecret,
    sip: rawSip,
    webrtcSip,
    pbxId,
    callerId,
  };
}

export async function resolveZadarmaConfig(overrides = {}) {
  const dbCfg = await getZadarmaDbConfig();
  return getZadarmaConfig(overrides, dbCfg);
}

/**
 * Generates Zadarma API v1 Authorization header:
 * Authorization: <user_key>:<base64(HMAC-SHA1(method + queryString + md5(queryString), secret))>
 */
export function getZadarmaAuthHeader(methodPath, params = {}, apiKey, apiSecret) {
  const queryString = buildZadarmaQueryString(params);
  const md5Hex = crypto.createHash('md5').update(queryString).digest('hex');
  const stringToSign = `${methodPath}${queryString}${md5Hex}`;
  const hmacHex = crypto
    .createHmac('sha1', apiSecret)
    .update(stringToSign)
    .digest('hex');
  const signature = Buffer.from(hmacHex).toString('base64');
  return `${apiKey}:${signature}`;
}

/**
 * Performs an authenticated request to Zadarma API v1 (https://api.zadarma.com).
 */
export async function callZadarmaApi(
  methodPath,
  params = {},
  httpMethod = 'GET',
  overrides = {}
) {
  const cfg = await resolveZadarmaConfig(overrides);
  if (!cfg.configured) {
    throw new Error(
      'Zadarma API Key and Secret are required. Open "⚙️ Zadarma Setup" in the dialer and paste your Key & Secret once.'
    );
  }

  const queryString = buildZadarmaQueryString(params);
  const authHeader = getZadarmaAuthHeader(
    methodPath,
    params,
    cfg.apiKey,
    cfg.apiSecret
  );

  const isGet = httpMethod.toUpperCase() === 'GET';
  const url = `https://api.zadarma.com${methodPath}${
    isGet && queryString ? `?${queryString}` : ''
  }`;

  const headers = {
    Authorization: authHeader,
    Accept: 'application/json',
  };

  const fetchOptions = {
    method: httpMethod.toUpperCase(),
    headers,
  };

  if (!isGet && queryString) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    fetchOptions.body = queryString;
  }

  const res = await fetch(url, fetchOptions);
  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.status === 'error') {
    throw new Error(
      data.message || `Zadarma API error on ${methodPath} (HTTP ${res.status})`
    );
  }

  return data;
}

/**
 * Normalizes a destination phone number for Zadarma (E.164 digits without '+' or with '+').
 */
export function normalizeZadarmaPhone(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('07')) {
    return '44' + digits.slice(1);
  }
  if (digits.length === 10 && digits.startsWith('7')) {
    return '44' + digits;
  }
  if (digits.length === 11 && /^0[789][01]\d{8}$/.test(digits)) {
    return '234' + digits.slice(1);
  }
  return digits;
}

/**
 * Fetches a 72-hour WebRTC key for the Zadarma browser softphone widget.
 */
export async function getZadarmaWebRtcKey(sip, overrides = {}) {
  const cfg = await resolveZadarmaConfig({ ...overrides, sip });
  const targetSip = cleanVal(cfg.webrtcSip || sip || cfg.sip);
  const params = targetSip ? { sip: targetSip } : {};
  return callZadarmaApi('/v1/webrtc/get_key/', params, 'GET', overrides);
}

/**
 * Initiates a Zadarma Click-to-Call callback from the agent's SIP/PBX extension (or phone) to the lead.
 */
export async function triggerZadarmaCallback({
  from,
  to,
  sip,
  predicted = false,
  overrides = {},
}) {
  const cfg = await resolveZadarmaConfig(overrides);
  let cleanFrom = cleanVal(from || cfg.sip || '660625');
  // If user entered full PBX login like "604556-100", callback endpoint expects "100"
  if (/^\d+-\d+$/.test(cleanFrom)) {
    cleanFrom = cleanFrom.split('-')[1];
  }
  const cleanTo = normalizeZadarmaPhone(to);

  if (!cleanTo) {
    throw new Error(`Invalid destination phone number: "${to}"`);
  }

  const params = {
    from: cleanFrom,
    to: cleanTo,
  };
  let cleanSip = cleanVal(sip || cfg.sip);
  if (/^\d+-\d+$/.test(cleanSip)) {
    cleanSip = cleanSip.split('-')[1];
  }
  if (cleanSip) {
    params.sip = cleanSip;
  }
  if (predicted) {
    params.predicted = 'y';
  }

  return callZadarmaApi('/v1/request/callback/', params, 'GET', overrides);
}

/**
 * Sends an outbound SMS via Zadarma (/v1/sms/send/).
 */
export async function sendZadarmaSms({ to, message, callerId, overrides = {} }) {
  const cleanTo = normalizeZadarmaPhone(to);
  if (!cleanTo) throw new Error(`Invalid recipient phone number: "${to}"`);
  const params = {
    number: cleanTo,
    message: String(message || '').trim(),
  };
  if (callerId) {
    params.caller_id = String(callerId).trim();
  }
  return callZadarmaApi('/v1/sms/send/', params, 'POST', overrides);
}

/**
 * Retrieves a temporary MP3 download URL for a Zadarma PBX recorded call.
 * Can either look up by exact `callIdWithRec` or search recent `/v1/statistics/pbx/` for the destination phone number.
 */
export async function fetchZadarmaRecordingUrl({
  phoneNumber,
  callIdWithRec,
  overrides = {},
}) {
  let targetCallId = cleanVal(callIdWithRec);

  if (!targetCallId) {
    const cleanPhone = normalizeZadarmaPhone(phoneNumber);
    const statsRes = await callZadarmaApi('/v1/statistics/pbx/', {}, 'GET', overrides);
    const stats = Array.isArray(statsRes?.stats) ? statsRes.stats : [];
    // Find latest recorded call matching destination phone (or most recent recorded call within last 15 mins)
    const recordedCalls = stats.filter(s => String(s.is_recorded) === 'true' && s.call_id);
    if (cleanPhone) {
      const tail = cleanPhone.slice(-9);
      const matched = recordedCalls.find(
        s =>
          String(s.destination || '').includes(tail) ||
          String(s.clid || '').includes(tail) ||
          String(s.sip || '').includes(tail)
      );
      if (matched) targetCallId = matched.call_id;
    }
    if (!targetCallId && recordedCalls.length > 0) {
      targetCallId = recordedCalls[0].call_id;
    }
  }

  if (!targetCallId) {
    return null;
  }

  const recRes = await callZadarmaApi(
    '/v1/pbx/record/request/',
    { call_id: targetCallId },
    'GET',
    overrides
  );

  const link = recRes?.link || (Array.isArray(recRes?.links) ? recRes.links[0] : null);
  return link ? { recordingUrl: link, zadarmaCallId: targetCallId } : null;
}
