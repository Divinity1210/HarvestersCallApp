/**
 * Thin Gemini REST client (no SDK dependency).
 *
 * Gemini accepts audio natively, so call recordings go straight to the model
 * for transcription + analysis in ONE request — no separate speech-to-text
 * provider (Deepgram) is required.
 */

const API_BASE = 'https://generativelanguage.googleapis.com';
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

const CANDIDATE_MODELS = Array.from(new Set([
  process.env.GEMINI_MODEL,
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-3-flash-preview',
].filter(Boolean)));

/** Inline audio limit is ~20MB per request; above this we use the Files API. */
const INLINE_AUDIO_LIMIT_BYTES = 14 * 1024 * 1024;

function getApiKey() {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error('GOOGLE_AI_API_KEY not configured');
  return key.replace(/^["']|["']$/g, '').trim();
}

/** Turn Google's verbose error payloads into something a volunteer/admin can act on. */
function friendlyError(status, bodyText) {
  if (bodyText.includes('API_KEY_SERVICE_BLOCKED')) {
    return 'Gemini blocked: the API key is restricted. In Google Cloud → Credentials, allow "Generative Language API" on this key.';
  }
  if (bodyText.includes('SERVICE_DISABLED')) {
    return 'Gemini blocked: enable the "Generative Language API" in Google Cloud.';
  }
  if (status === 429) return 'Gemini rate limit reached — please try again in a moment or enter notes manually.';
  if (status === 503 || bodyText.includes('high demand') || bodyText.includes('UNAVAILABLE')) {
    return 'Gemini is temporarily experiencing high demand. Please try again or enter notes manually.';
  }
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed.error?.message) {
      return `Gemini error ${status}: ${parsed.error.message}`;
    }
  } catch {
    // ignore
  }
  return `Gemini error ${status}: ${bodyText.slice(0, 150)}`;
}

/**
 * Call generateContent and return parsed JSON.
 * Automatically tries candidate models if one encounters temporary capacity/503 issues.
 * @param {Array} parts   Gemini content parts (text / inlineData / fileData)
 * @param {object} schema Gemini responseSchema (OpenAPI subset)
 */
export async function generateJSON(parts, schema, { temperature = 0.1, maxOutputTokens = 8192 } = {}) {
  const apiKey = getApiKey();
  let lastError = null;

  for (const model of CANDIDATE_MODELS) {
    try {
      const res = await fetch(
        `${API_BASE}/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: {
              temperature,
              maxOutputTokens,
              responseMimeType: 'application/json',
              ...(schema ? { responseSchema: schema } : {}),
            },
          }),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        // If 5xx (server error / high demand), 429 (rate limit), or 404 (model not found/deprecated), fallback to next model
        if (res.status >= 500 || res.status === 404 || res.status === 429) {
          console.warn(`[Gemini] Model ${model} returned ${res.status}. Falling back to next model...`);
          lastError = new Error(friendlyError(res.status, errText));
          await new Promise(r => setTimeout(r, 400));
          continue;
        }
        throw new Error(friendlyError(res.status, errText));
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
      if (!text) {
        const reason = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason || 'empty';
        throw new Error(`Gemini returned no content (${reason})`);
      }

      try {
        return JSON.parse(text);
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error('Gemini returned invalid JSON');
      }
    } catch (err) {
      lastError = err;
      if (err.message && (
        err.message.includes('503') ||
        err.message.includes('500') ||
        err.message.includes('rate limit') ||
        err.message.includes('404') ||
        err.message.includes('high demand') ||
        err.message.includes('UNAVAILABLE')
      )) {
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('All candidate Gemini models failed');
}


/**
 * Build a Gemini content part for an audio buffer. Small files are inlined;
 * long calls are uploaded via the Files API (auto-deleted by Google after 48h).
 */
export async function audioPart(buffer, mimeType = 'audio/mpeg') {
  if (buffer.byteLength <= INLINE_AUDIO_LIMIT_BYTES) {
    return { inlineData: { mimeType, data: Buffer.from(buffer).toString('base64') } };
  }

  const key = getApiKey();
  const start = await fetch(`${API_BASE}/upload/v1beta/files?key=${key}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(buffer.byteLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: `call-${Date.now()}` } }),
  });
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!start.ok || !uploadUrl) throw new Error(friendlyError(start.status, await start.text()));

  const upload = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(buffer.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: Buffer.from(buffer),
  });
  if (!upload.ok) throw new Error(friendlyError(upload.status, await upload.text()));
  let { file } = await upload.json();

  // Wait for processing (audio is usually ACTIVE within a few seconds)
  for (let i = 0; i < 15 && file.state === 'PROCESSING'; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const check = await fetch(`${API_BASE}/v1beta/${file.name}?key=${key}`);
    file = await check.json();
  }
  if (file.state !== 'ACTIVE') throw new Error(`Audio upload not ready (${file.state})`);

  return { fileData: { mimeType, fileUri: file.uri } };
}
