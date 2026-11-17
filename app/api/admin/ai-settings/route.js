import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getAiDbConfig, resolveAiKeys, saveAiDbConfig } from '@/lib/ai/gemini';

function maskKey(k) {
  const s = String(k || '').trim();
  if (s.length <= 10) return s ? '••••••••' : '';
  return `${s.slice(0, 6)}••••${s.slice(-4)}`;
}

/**
 * GET /api/admin/ai-settings
 * Returns active free AI key counts and current DB-saved keys (masked for display, plus raw count).
 */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const dbCfg = await getAiDbConfig();
    const resolved = await resolveAiKeys();

    return NextResponse.json({
      totalGroqKeys: resolved.groqKeys.length,
      totalGeminiKeys: resolved.geminiKeys.length,
      hasOpenRouter: Boolean(resolved.openrouterKey),
      maskedGroqKeys: resolved.groqKeys.map(maskKey),
      maskedGeminiKeys: resolved.geminiKeys.map(maskKey),
      dbGroqCount: (dbCfg.groqKeys || []).length,
      dbGeminiCount: (dbCfg.geminiKeys || []).length,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/ai-settings
 * Saves free Groq (`gsk_...`), Google AI Studio (`AIza...`), and/or OpenRouter keys into Neon DB.
 * If `append: true` (default), merges new keys with existing DB keys; if `replace: true`, overwrites.
 */
export async function POST(request) {
  try {
    const user = await getSessionUser();
    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const {
      groqKeys = '',
      geminiKeys = '',
      openrouterKey = '',
      replace = false,
    } = body;

    const parseList = val =>
      String(val || '')
        .split(/[\s,;]+/)
        .map(s => s.replace(/^["']|["']$/g, '').trim())
        .filter(Boolean);

    const newGroq = parseList(groqKeys);
    const newGemini = parseList(geminiKeys);
    const newOr = String(openrouterKey || '').trim();

    // Optional live sanity test on newly pasted Groq key(s)
    for (const gk of newGroq) {
      const testRes = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${gk}` },
        signal: AbortSignal.timeout(8000),
      });
      if (testRes.status === 401 || testRes.status === 403) {
        return NextResponse.json(
          { error: `Groq key ending in ${gk.slice(-4)} was rejected (Invalid API Key).` },
          { status: 400 }
        );
      }
    }

    // Optional live sanity test on newly pasted Gemini key(s)
    for (const ak of newGemini) {
      const testRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${ak}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (testRes.status === 400 || testRes.status === 403) {
        return NextResponse.json(
          { error: `Google AI Studio key ending in ${ak.slice(-4)} was rejected.` },
          { status: 400 }
        );
      }
    }

    const existing = replace ? {} : await getAiDbConfig();
    const mergedGroq = Array.from(new Set([...(existing.groqKeys || []), ...newGroq]));
    const mergedGemini = Array.from(new Set([...(existing.geminiKeys || []), ...newGemini]));
    const mergedOr = newOr || existing.openrouterKey || '';

    await saveAiDbConfig({
      groqKeys: mergedGroq,
      geminiKeys: mergedGemini,
      openrouterKey: mergedOr,
    });

    const resolved = await resolveAiKeys();
    return NextResponse.json({
      success: true,
      totalGroqKeys: resolved.groqKeys.length,
      totalGeminiKeys: resolved.geminiKeys.length,
      hasOpenRouter: Boolean(resolved.openrouterKey),
      maskedGroqKeys: resolved.groqKeys.map(maskKey),
      maskedGeminiKeys: resolved.geminiKeys.map(maskKey),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
