import twilio from 'twilio';

const TITLES = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'pastor', 'pst',
  'rev', 'sister', 'sis', 'brother', 'bro', 'elder', 'deacon', 'deaconess',
]);

function toTitleCaseWord(word) {
  if (!word) return '';
  const clean = word.replace(/^[.,;:'"()[\]]+|[.,;:'"()[\]]+$/g, '');
  if (!clean) return '';
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

/**
 * Extracts a clean, friendly first name from a lead's full_name or metadata.
 */
export function extractFirstName(fullName, metadata = {}) {
  if (metadata?.first_name && String(metadata.first_name).trim().length > 1) {
    return toTitleCaseWord(String(metadata.first_name).trim().split(/\s+/)[0]);
  }

  if (!fullName || typeof fullName !== 'string') return 'there';
  let str = fullName.trim();
  if (!str) return 'there';

  // Handle "Lastname, Firstname" format
  if (str.includes(',')) {
    const parts = str.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      str = parts.slice(1).join(' ');
    }
  }

  const tokens = str.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 'there';

  // Skip honorifics/titles if followed by another name
  let idx = 0;
  const firstClean = tokens[0].replace(/[^a-zA-Z]/g, '').toLowerCase();
  if (tokens.length > 1 && TITLES.has(firstClean)) {
    idx = 1;
  }

  // If the chosen token is a single initial (e.g. "P Paulette"), use the next token if longer
  const candidate = tokens[idx].replace(/[^a-zA-Z'-]/g, '');
  if (candidate.length <= 1 && tokens[idx + 1]) {
    const nextCandidate = tokens[idx + 1].replace(/[^a-zA-Z'-]/g, '');
    if (nextCandidate.length > 1) {
      return toTitleCaseWord(nextCandidate);
    }
  }

  return toTitleCaseWord(candidate) || 'there';
}

/**
 * Normalizes a phone number into E.164 format (+44..., +234..., etc.).
 */
export function normalizeSmsPhone(raw) {
  if (!raw) return '';
  let str = String(raw).trim().replace(/^[='"\s]+|['"\s]+$/g, '');
  const hasPlus = str.startsWith('+');
  let digits = str.replace(/[^0-9]/g, '');

  if (!digits || digits.length < 7) return '';

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // UK mobile missing country code (10 digits starting with 7)
  if (digits.length === 10 && digits.startsWith('7')) {
    digits = '44' + digits;
  }
  // UK local mobile (11 digits starting with 07)
  else if (digits.length === 11 && digits.startsWith('07')) {
    digits = '44' + digits.slice(1);
  }
  // UK with extra 0 after 44 (4407...)
  else if (digits.length === 13 && digits.startsWith('4407')) {
    digits = '44' + digits.slice(3);
  }
  // Nigeria local mobile (11 digits starting with 07/08/09)
  else if (digits.length === 11 && /^0[789][01]\d{8}$/.test(digits)) {
    digits = '234' + digits.slice(1);
  }
  // Nigeria with extra 0 after 234
  else if (digits.length === 14 && digits.startsWith('2340')) {
    digits = '234' + digits.slice(4);
  }

  if (hasPlus || digits.length >= 10) {
    return '+' + digits;
  }
  return '+' + digits;
}

/**
 * Renders an SMS template with lead placeholders:
 * {{first_name}}, {{full_name}}, {{attendee_name}}, {{attendee_first_name}}
 */
export function renderSmsTemplate(template, lead = {}) {
  const firstName = extractFirstName(lead.full_name, lead.metadata);
  const fullName = (lead.full_name || '').trim() || firstName;

  return String(template || '')
    .replace(/\{\{\s*first_name\s*\}\}/gi, firstName)
    .replace(/\{\{\s*attendee_first_name\s*\}\}/gi, firstName)
    .replace(/\{\{\s*full_name\s*\}\}/gi, fullName)
    .replace(/\{\{\s*attendee_name\s*\}\}/gi, fullName)
    .trim();
}

function cleanEnv(val, fallback = '') {
  return String(val || fallback).replace(/^['"\s]+|['"\s]+$/g, '').trim();
}

/**
 * Active clean UK Twilio numbers for Automatic Multi-Number Caller ID Rotation.
 * Note: +447897011851 is placed in cooldown by default while carrier spam flags clear.
 */
export const DEFAULT_UK_CALLER_ID_POOL = [
  '+447576543020',
  '+447472125774',
  '+447447185340',
  '+447414129068',
];

const COOLDOWN_UK_NUMBERS = new Set(['+447897011851']);

let cachedTwilioPool = null;
let cachedTwilioPoolAt = 0;
let roundRobinCounter = 0;

/**
 * Returns the active list of UK Caller IDs for outbound rotation.
 * Combines TWILIO_CALLER_IDS (if configured), the 4 new UK numbers, and
 * auto-discovers any newly purchased +44 numbers on the Twilio account (cached 10m).
 */
export async function getUkCallerIdPool() {
  const includeCooldown =
    cleanEnv(process.env.TWILIO_INCLUDE_COOLDOWN_NUMBER).toLowerCase() === 'true';

  const envListRaw = cleanEnv(process.env.TWILIO_CALLER_IDS || '');
  const envNumbers = envListRaw
    ? envListRaw
        .split(/[\s,;]+/)
        .map(s => normalizeSmsPhone(s))
        .filter(n => n.startsWith('+44'))
    : [];

  const baseSet = new Set([...envNumbers, ...DEFAULT_UK_CALLER_ID_POOL]);

  const now = Date.now();
  if (cachedTwilioPool && now - cachedTwilioPoolAt < 10 * 60 * 1000) {
    for (const n of cachedTwilioPool) baseSet.add(n);
  } else {
    const accountSid = cleanEnv(process.env.TWILIO_ACCOUNT_SID);
    const authToken = cleanEnv(process.env.TWILIO_AUTH_TOKEN);
    if (accountSid && authToken) {
      try {
        const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PageSize=50`,
          {
            headers: { Authorization: `Basic ${auth}` },
            signal: AbortSignal.timeout(2500),
          }
        );
        if (res.ok) {
          const data = await res.json();
          const discovered = (data.incoming_phone_numbers || [])
            .filter(p => p.phone_number && p.phone_number.startsWith('+44') && p.capabilities?.voice !== false)
            .map(p => p.phone_number.trim());
          cachedTwilioPool = discovered;
          cachedTwilioPoolAt = now;
          for (const n of discovered) baseSet.add(n);
        }
      } catch {
        // Fallback to static pool if Twilio API check times out
      }
    }
  }

  const activePool = Array.from(baseSet).filter(
    num => includeCooldown || !COOLDOWN_UK_NUMBERS.has(num)
  );

  return activePool.length > 0 ? activePool : DEFAULT_UK_CALLER_ID_POOL;
}

/**
 * Selects a UK Caller ID from the active rotation pool:
 * - Evenly distributes calls across all active numbers using a hash of leadId
 * - Automatically shifts to the next number in the pool on retry rounds (retryRound > 0)
 *   so leads who missed an earlier call see a fresh number on the next attempt.
 */
export async function pickRotatingCallerId({ leadId = '', retryRound = 0 } = {}) {
  const pool = await getUkCallerIdPool();
  if (pool.length === 1) return pool[0];

  if (leadId) {
    let hash = 0;
    const str = String(leadId);
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    const idx = (hash + Math.max(0, Number(retryRound) || 0)) % pool.length;
    return pool[idx];
  }

  const idx = roundRobinCounter++ % pool.length;
  return pool[idx];
}

export function getTwilioConfig() {
  const accountSid = cleanEnv(process.env.TWILIO_ACCOUNT_SID);
  const authToken = cleanEnv(process.env.TWILIO_AUTH_TOKEN);
  const defaultPhone = DEFAULT_UK_CALLER_ID_POOL[roundRobinCounter++ % DEFAULT_UK_CALLER_ID_POOL.length];
  const defaultSenderId = cleanEnv(process.env.TWILIO_SENDER_ID, 'NLP UK');

  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN) are not configured.');
  }

  return {
    client: twilio(accountSid, authToken),
    defaultPhone,
    defaultSenderId,
  };
}

/**
 * Sends a single SMS via Twilio using the requested Sender ID (default: 'NLP UK').
 * If the destination country or carrier rejects an Alphanumeric Sender ID and
 * fallbackToNumber is true, automatically retries using the church's Twilio phone number.
 */
export async function sendTwilioSms({
  to,
  body,
  senderId = 'NLP UK',
  fallbackToNumber = true,
  existingClient = null,
}) {
  const config = existingClient || getTwilioConfig();
  const { client, defaultPhone } = config;

  const toPhone = normalizeSmsPhone(to);
  if (!toPhone) {
    throw new Error(`Invalid phone number: "${to}"`);
  }

  const requestedFrom = cleanEnv(senderId, 'NLP UK');
  const isAlphanumeric = !requestedFrom.startsWith('+');

  try {
    const msg = await client.messages.create({
      from: requestedFrom,
      to: toPhone,
      body: body.trim(),
    });
    return {
      sid: msg.sid,
      fromUsed: requestedFrom,
      to: toPhone,
      fallbackUsed: false,
    };
  } catch (err) {
    // Check if the error is due to Alphanumeric Sender ID restrictions
    const errMsg = String(err?.message || '').toLowerCase();
    const errCode = Number(err?.code || 0);
    const isSenderError =
      isAlphanumeric &&
      fallbackToNumber &&
      defaultPhone &&
      requestedFrom !== defaultPhone &&
      (
        [21612, 21606, 21211, 21212, 21659, 21408].includes(errCode) ||
        errMsg.includes('alphanumeric') ||
        errMsg.includes('from') ||
        errMsg.includes('sender')
      );

    if (isSenderError) {
      const fallbackMsg = await client.messages.create({
        from: defaultPhone,
        to: toPhone,
        body: body.trim(),
      });
      return {
        sid: fallbackMsg.sid,
        fromUsed: defaultPhone,
        to: toPhone,
        fallbackUsed: true,
      };
    }

    throw err;
  }
}
