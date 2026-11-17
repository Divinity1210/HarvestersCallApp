/**
 * Multi-Provider Free AI Engine (Gemini Multi-Key/Multi-Model Pool + Groq Whisper/LLM + OpenRouter Free).
 *
 * Supports both:
 *  1. Multimodal Audio + JSON (Twilio / Zadarma call recordings):
 *     - Google Gemini (`gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`, `gemini-3.5-flash`) across 1..N free API keys
 *     - Automatic failover to Groq Free STT (`whisper-large-v3-turbo` / `whisper-large-v3`) + Groq JSON LLM
 *  2. Fast Text + JSON ("✨ Fill in with AI" volunteer quick notes & script parser):
 *     - Groq ultra-low-latency JSON models (~0.3s) + Gemini Multi-Key/Multi-Model Pool + OpenRouter Free
 */
import { query } from '@/lib/db';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com';
const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

// Ordered from highest available free-tier quota & speed to fallback models.
// Note: Google AI Studio enforces Free Tier daily quotas PER PROJECT AND PER MODEL (500/day per model per project),
// so listing both 3.1-flash-lite and 3.5-flash-lite immediately doubles daily capacity even on a single key!
const GEMINI_CANDIDATE_MODELS = Array.from(
  new Set(
    [
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite',
      process.env.GEMINI_MODEL,
      'gemini-3.5-flash',
    ].filter(Boolean)
  )
);

const GROQ_TEXT_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'qwen/qwen3-32b',
];

const GROQ_WHISPER_MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3'];

/** Inline audio limit is ~20MB per request; above this we use the Files API. */
const INLINE_AUDIO_LIMIT_BYTES = 14 * 1024 * 1024;

// In-memory cooldown map for exhausted <provider:keySuffix:model> buckets
const cooldownUntil = new Map();
let roundRobinIdx = 0;

// Cached Neon DB `ai_config` (refreshed every 15s)
let cachedDbAiCfg = null;
let cachedDbAiAt = 0;

function splitKeys(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .flatMap(v => String(v || '').split(/[\s,;]+/))
      .map(s => s.replace(/^["']|["']$/g, '').trim())
      .filter(Boolean);
  }
  return String(raw)
    .split(/[\s,;]+/)
    .map(s => s.replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
}

export async function getAiDbConfig() {
  if (cachedDbAiCfg && Date.now() - cachedDbAiAt < 15000) {
    return cachedDbAiCfg;
  }
  try {
    const rows = await query(
      `SELECT value FROM system_settings WHERE key = 'ai_config' LIMIT 1`
    );
    if (rows.length > 0 && rows[0].value) {
      const parsed =
        typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
      cachedDbAiCfg = parsed || {};
      cachedDbAiAt = Date.now();
      return cachedDbAiCfg;
    }
  } catch {
    // system_settings table may not exist yet
  }
  return {};
}

export async function saveAiDbConfig({ groqKeys = [], geminiKeys = [], openrouterKey = '' }) {
  const payload = {
    groqKeys: splitKeys(groqKeys),
    geminiKeys: splitKeys(geminiKeys),
    openrouterKey: String(openrouterKey || '').replace(/^["']|["']$/g, '').trim(),
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
     VALUES ('ai_config', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = NOW()`,
    [JSON.stringify(payload)]
  );
  cachedDbAiCfg = payload;
  cachedDbAiAt = Date.now();
  return payload;
}

export async function resolveAiKeys() {
  const dbCfg = await getAiDbConfig();
  const geminiKeys = Array.from(
    new Set([...splitKeys(dbCfg.geminiKeys), ...splitKeys(process.env.GOOGLE_AI_API_KEY)])
  );
  const groqKeys = Array.from(
    new Set([...splitKeys(dbCfg.groqKeys), ...splitKeys(process.env.GROQ_API_KEY)])
  );
  const openrouterKey =
    String(dbCfg.openrouterKey || process.env.OPENROUTER_API_KEY || '')
      .replace(/^["']|["']$/g, '')
      .trim();

  return { geminiKeys, groqKeys, openrouterKey };
}

function isCoolingDown(bucketId) {
  const until = cooldownUntil.get(bucketId);
  if (!until) return false;
  if (Date.now() >= until) {
    cooldownUntil.delete(bucketId);
    return false;
  }
  return true;
}

function setCooldown(bucketId, ms) {
  cooldownUntil.set(bucketId, Date.now() + ms);
}

/** Convert Gemini OpenAPI-subset responseSchema into a concise JSON shape hint for Groq / OpenRouter. */
function schemaToShapeHint(schema) {
  if (!schema || typeof schema !== 'object') return 'any';
  const t = String(schema.type || '').toUpperCase();
  if (t === 'OBJECT') {
    const obj = {};
    for (const [k, v] of Object.entries(schema.properties || {})) {
      obj[k] = schemaToShapeHint(v);
    }
    return obj;
  }
  if (t === 'ARRAY') {
    return [schemaToShapeHint(schema.items)];
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.join(' | ');
  }
  if (t === 'INTEGER' || t === 'NUMBER') return 0;
  if (t === 'BOOLEAN') return true;
  return 'string';
}

function parseJsonResponse(text, providerName) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error(`${providerName} returned empty content`);
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`${providerName} returned invalid JSON`);
  }
}

/** Turn Google's verbose error payloads into something a volunteer/admin can act on. */
function friendlyError(status, bodyText) {
  if (bodyText.includes('API_KEY_SERVICE_BLOCKED')) {
    return 'Gemini blocked: the API key is restricted. In Google Cloud → Credentials, allow "Generative Language API" on this key.';
  }
  if (bodyText.includes('SERVICE_DISABLED')) {
    return 'Gemini blocked: enable the "Generative Language API" in Google Cloud.';
  }
  if (status === 429) {
    return 'Free AI daily/minute limit reached — add a free Groq key (console.groq.com) or extra Google AI Studio key in Admin → 🤖 Free AI Setup, or enter notes manually.';
  }
  if (status === 503 || bodyText.includes('high demand') || bodyText.includes('UNAVAILABLE')) {
    return 'AI model is experiencing temporary high demand. Please tap again in a few seconds or enter notes manually.';
  }
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed.error?.message) {
      return `AI error ${status}: ${parsed.error.message}`;
    }
  } catch {
    // ignore
  }
  return `AI error ${status}: ${bodyText.slice(0, 150)}`;
}

/**
 * Transcribe raw audio bytes via Groq Free Whisper (`whisper-large-v3-turbo` / `whisper-large-v3`).
 */
async function transcribeWithGroqWhisper(audioBuffer, mimeType, groqKeys) {
  let lastErr = null;
  for (const gKey of groqKeys) {
    const keyTag = gKey.slice(-6);
    for (const wModel of GROQ_WHISPER_MODELS) {
      const bucket = `groq-stt:${keyTag}:${wModel}`;
      if (isCoolingDown(bucket)) continue;
      try {
        const form = new FormData();
        const ext = mimeType.includes('wav') ? 'wav' : mimeType.includes('mp4') ? 'm4a' : 'mp3';
        form.append('file', new Blob([audioBuffer], { type: mimeType || 'audio/mpeg' }), `call.${ext}`);
        form.append('model', wModel);
        form.append('response_format', 'verbose_json');
        form.append('language', 'en');

        const res = await fetch(`${GROQ_API_BASE}/audio/transcriptions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${gKey}` },
          body: form,
          signal: AbortSignal.timeout(35000),
        });

        if (!res.ok) {
          const errTxt = await res.text();
          if (res.status === 429) setCooldown(bucket, 60 * 1000);
          if (res.status === 404 || res.status === 400) setCooldown(bucket, 15 * 60 * 1000);
          lastErr = new Error(`Groq Whisper (${wModel}) HTTP ${res.status}: ${errTxt.slice(0, 120)}`);
          continue;
        }

        const data = await res.json();
        if (Array.isArray(data.segments) && data.segments.length > 0) {
          return data.segments
            .map(s => `[${Math.round(s.start || 0)}s] ${String(s.text || '').trim()}`)
            .join('\n');
        }
        return String(data.text || '').trim();
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw lastErr || new Error('Groq Whisper transcription unavailable');
}

/**
 * Generate structured JSON using Groq Chat Completions (`response_format: { type: 'json_object' }`).
 */
async function generateWithGroqJSON(promptText, schema, groqKeys, { temperature = 0.1, maxOutputTokens = 4096 } = {}) {
  const shapeHint = schema ? JSON.stringify(schemaToShapeHint(schema), null, 2) : '{}';
  const systemMsg =
    'You are an accurate JSON extraction assistant. Respond ONLY with a valid JSON object matching this exact schema shape (keep exact property names and allowed enum values):\n' +
    shapeHint;

  let lastErr = null;
  const startKeyIdx = roundRobinIdx++ % groqKeys.length;
  const orderedKeys = [...groqKeys.slice(startKeyIdx), ...groqKeys.slice(0, startKeyIdx)];

  for (const gKey of orderedKeys) {
    const keyTag = gKey.slice(-6);
    for (const model of GROQ_TEXT_MODELS) {
      const bucket = `groq-llm:${keyTag}:${model}`;
      if (isCoolingDown(bucket)) continue;

      try {
        const res = await fetch(`${GROQ_API_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${gKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemMsg },
              { role: 'user', content: promptText },
            ],
            temperature,
            max_tokens: Math.min(maxOutputTokens, 4096),
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(20000),
        });

        if (!res.ok) {
          const errTxt = await res.text();
          if (res.status === 429) {
            setCooldown(bucket, 60 * 1000);
          } else if (res.status === 404 || res.status === 400) {
            // Model deprecated or unavailable on this tier
            setCooldown(bucket, 30 * 60 * 1000);
          }
          lastErr = new Error(`Groq (${model}) HTTP ${res.status}: ${errTxt.slice(0, 120)}`);
          continue;
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '';
        return parseJsonResponse(content, `Groq (${model})`);
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw lastErr || new Error('All Groq models exhausted');
}

/**
 * Optional OpenRouter Free Tier fallback (`openrouter/free`) for text JSON tasks.
 */
async function generateWithOpenRouterJSON(promptText, schema, openrouterKey, { temperature = 0.1 } = {}) {
  const shapeHint = schema ? JSON.stringify(schemaToShapeHint(schema), null, 2) : '{}';
  const res = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openrouter/free',
      messages: [
        {
          role: 'system',
          content:
            'Respond ONLY with a valid JSON object matching this exact schema:\n' + shapeHint,
        },
        { role: 'user', content: promptText },
      ],
      temperature,
    }),
    signal: AbortSignal.timeout(22000),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter HTTP ${res.status}`);
  }
  const data = await res.json();
  return parseJsonResponse(data.choices?.[0]?.message?.content || '', 'OpenRouter Free');
}

/**
 * Generate structured JSON across Gemini Multi-Key x Multi-Model pool.
 */
async function generateWithGeminiPool(parts, schema, geminiKeys, { temperature = 0.1, maxOutputTokens = 8192 } = {}) {
  let lastError = null;
  const startIdx = roundRobinIdx++ % geminiKeys.length;
  const orderedKeys = [...geminiKeys.slice(startIdx), ...geminiKeys.slice(0, startIdx)];

  // Clean internal non-enumerable or helper fields cleanly before JSON serialization
  const cleanParts = parts.map(p => {
    if (p.inlineData) return { inlineData: p.inlineData };
    if (p.fileData) return { fileData: p.fileData };
    return { text: p.text };
  });

  for (const apiKey of orderedKeys) {
    const keyTag = apiKey.slice(-6);
    for (const model of GEMINI_CANDIDATE_MODELS) {
      const bucket = `gemini:${keyTag}:${model}`;
      if (isCoolingDown(bucket)) continue;

      try {
        const res = await fetch(
          `${GEMINI_API_BASE}/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: cleanParts }],
              generationConfig: {
                temperature,
                maxOutputTokens,
                thinkingConfig: { thinkingBudget: 0 },
                responseMimeType: 'application/json',
                ...(schema ? { responseSchema: schema } : {}),
              },
            }),
            signal: AbortSignal.timeout(25000),
          }
        );

        if (!res.ok) {
          const errText = await res.text();
          if (res.status === 429) {
            const isDailyCap = errText.includes('PerDay') || errText.includes('free_tier_requests');
            setCooldown(bucket, isDailyCap ? 15 * 60 * 1000 : 45 * 1000);
            lastError = new Error(friendlyError(res.status, errText));
            continue;
          }
          if (res.status === 404) {
            setCooldown(bucket, 60 * 60 * 1000);
            lastError = new Error(friendlyError(res.status, errText));
            continue;
          }
          if (res.status >= 500) {
            lastError = new Error(friendlyError(res.status, errText));
            await new Promise(r => setTimeout(r, 350));
            continue;
          }
          throw new Error(friendlyError(res.status, errText));
        }

        const data = await res.json();
        const text =
          data.candidates?.[0]?.content?.parts
            ?.map(p => p.text || '')
            .join('') || '';
        if (!text) {
          const reason =
            data.promptFeedback?.blockReason ||
            data.candidates?.[0]?.finishReason ||
            'empty';
          throw new Error(`Gemini returned no content (${reason})`);
        }
        return parseJsonResponse(text, `Gemini (${model})`);
      } catch (err) {
        lastError = err;
      }
    }
  }

  throw lastError || new Error('All Gemini keys and models are currently rate-limited.');
}

/**
 * Unified entry point for both Text JSON ("✨ Fill in with AI", Script Parser)
 * and Audio+JSON (Call Recording QA).
 */
export async function generateJSON(parts, schema, options = {}) {
  const { geminiKeys, groqKeys, openrouterKey } = await resolveAiKeys();
  if (geminiKeys.length === 0 && groqKeys.length === 0 && !openrouterKey) {
    throw new Error(
      'No AI API keys configured. Open Admin → 🤖 Free AI Setup to add a free Groq or Google AI Studio key.'
    );
  }

  const audioItem = parts.find(p => p.inlineData || p.fileData || p._buffer);
  const textPrompt = parts
    .filter(p => typeof p.text === 'string')
    .map(p => p.text)
    .join('\n\n');

  // CASE A: Text-only JSON ("✨ Fill in with AI" quick notes & script parser)
  // Prefer Groq first if configured (~0.3s response + huge free daily allowance), then Gemini Pool, then OpenRouter Free!
  if (!audioItem) {
    let lastErr = null;
    if (groqKeys.length > 0) {
      try {
        return await generateWithGroqJSON(textPrompt, schema, groqKeys, options);
      } catch (err) {
        console.warn('[AI Router] Groq text JSON failed, falling back to Gemini pool:', err.message);
        lastErr = err;
      }
    }
    if (geminiKeys.length > 0) {
      try {
        return await generateWithGeminiPool(parts, schema, geminiKeys, options);
      } catch (err) {
        console.warn('[AI Router] Gemini text JSON failed:', err.message);
        lastErr = err;
      }
    }
    if (openrouterKey) {
      try {
        return await generateWithOpenRouterJSON(textPrompt, schema, openrouterKey, options);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('All AI providers are temporarily rate-limited.');
  }

  // CASE B: Audio Call Recording + JSON QA
  // 1. Try Gemini native multimodal audio pool first (dual-channel speaker awareness)
  let lastAudioErr = null;
  if (geminiKeys.length > 0) {
    try {
      return await generateWithGeminiPool(parts, schema, geminiKeys, options);
    } catch (err) {
      console.warn('[AI Router] Gemini audio QA failed, failing over to Groq Whisper + LLM:', err.message);
      lastAudioErr = err;
    }
  }

  // 2. Automatic failover to Groq Free Whisper (`whisper-large-v3-turbo`) + Groq/Gemini Text LLM!
  if (groqKeys.length > 0) {
    const rawBuffer =
      audioItem._buffer ||
      (audioItem.inlineData?.data ? Buffer.from(audioItem.inlineData.data, 'base64') : null);
    const mimeType =
      audioItem.inlineData?.mimeType || audioItem.fileData?.mimeType || 'audio/mpeg';

    if (rawBuffer) {
      const rawTranscript = await transcribeWithGroqWhisper(rawBuffer, mimeType, groqKeys);
      const combinedPrompt = `${textPrompt}\n\n## Raw Call Audio Transcript (transcribed via Whisper)\n"""\n${
        rawTranscript || '(Silence / no speech detected in recording)'
      }\n"""\n\nInfer speaker turns ("agent" vs "attendee") from the script vs responses and return the JSON object.`;

      return await generateWithGroqJSON(combinedPrompt, schema, groqKeys, options);
    }
  }

  throw lastAudioErr || new Error('Audio AI processing failed — add a free Groq API key in Admin → 🤖 Free AI Setup.');
}

/**
 * Build an audio content part. Small files (<14MB) are inlined; larger recordings
 * use Gemini's Files API if a Gemini key is present, while preserving `_buffer`
 * (non-enumerable) so Groq Whisper failover always works too.
 */
export async function audioPart(buffer, mimeType = 'audio/mpeg') {
  if (buffer.byteLength <= INLINE_AUDIO_LIMIT_BYTES) {
    const part = {
      inlineData: { mimeType, data: Buffer.from(buffer).toString('base64') },
    };
    Object.defineProperty(part, '_buffer', { value: buffer, enumerable: false });
    return part;
  }

  const { geminiKeys } = await resolveAiKeys();
  if (geminiKeys.length === 0) {
    const part = { inlineData: { mimeType, data: '' } };
    Object.defineProperty(part, '_buffer', { value: buffer, enumerable: false });
    return part;
  }

  const key = geminiKeys[0];
  const start = await fetch(`${GEMINI_API_BASE}/upload/v1beta/files?key=${key}`, {
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

  for (let i = 0; i < 15 && file.state === 'PROCESSING'; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const check = await fetch(`${GEMINI_API_BASE}/v1beta/${file.name}?key=${key}`);
    file = await check.json();
  }
  if (file.state !== 'ACTIVE') throw new Error(`Audio upload not ready (${file.state})`);

  const part = { fileData: { mimeType, fileUri: file.uri } };
  Object.defineProperty(part, '_buffer', { value: buffer, enumerable: false });
  return part;
}
