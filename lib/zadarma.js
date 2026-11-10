import crypto from 'crypto';

function cleanVal(val, fallback = '') {
  return String(val || fallback).replace(/^['"\s]+|['"\s]+$/g, '').trim();
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

/**
 * Resolves Zadarma configuration from runtime overrides or environment variables.
 */
export function getZadarmaConfig(overrides = {}) {
  const apiKey = cleanVal(overrides.apiKey || process.env.ZADARMA_API_KEY);
  const apiSecret = cleanVal(overrides.apiSecret || process.env.ZADARMA_API_SECRET);
  const sip = cleanVal(overrides.sip || overrides.fromExtension || process.env.ZADARMA_SIP || '100');
  const callerId = cleanVal(overrides.callerId || process.env.ZADARMA_CALLER_ID);

  return {
    configured: Boolean(apiKey && apiSecret),
    apiKey,
    apiSecret,
    sip,
    callerId,
  };
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
  const cfg = getZadarmaConfig(overrides);
  if (!cfg.configured) {
    throw new Error(
      'Zadarma API Key and Secret are not configured. Click "⚙️ Zadarma Settings" in the dialer (or set ZADARMA_API_KEY and ZADARMA_API_SECRET in Vercel).'
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
  const cfg = getZadarmaConfig(overrides);
  const targetSip = cleanVal(sip || cfg.sip);
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
  const cfg = getZadarmaConfig(overrides);
  const cleanFrom = cleanVal(from || cfg.sip || '100');
  const cleanTo = normalizeZadarmaPhone(to);

  if (!cleanTo) {
    throw new Error(`Invalid destination phone number: "${to}"`);
  }

  const params = {
    from: cleanFrom,
    to: cleanTo,
  };
  const cleanSip = cleanVal(sip || cfg.sip);
  if (cleanSip) {
    params.sip = cleanSip;
  }
  if (predicted) {
    params.predicted = 'y';
  }

  return callZadarmaApi('/v1/request/callback/', params, 'GET', overrides);
}
