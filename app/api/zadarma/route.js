import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import {
  callZadarmaApi,
  getZadarmaConfig,
  getZadarmaWebRtcKey,
  normalizeZadarmaPhone,
  triggerZadarmaCallback,
} from '@/lib/zadarma';

/**
 * GET /api/zadarma
 * Returns Zadarma configuration status and optional WebRTC key / balance if server env vars are set.
 */
export async function GET() {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const cfg = getZadarmaConfig();
    if (!cfg.configured) {
      return NextResponse.json({
        configured: false,
        serverConfigured: false,
        sip: cfg.sip || '100',
      });
    }

    let balance = null;
    let currency = '';
    let webrtcKey = null;

    try {
      const balRes = await callZadarmaApi('/v1/info/balance/', {}, 'GET');
      if (balRes?.status === 'success') {
        balance = balRes.balance;
        currency = balRes.currency || 'USD';
      }
    } catch {}

    try {
      const keyRes = await getZadarmaWebRtcKey(cfg.sip);
      if (keyRes?.status === 'success' && keyRes.key) {
        webrtcKey = keyRes.key;
      }
    } catch {}

    return NextResponse.json({
      configured: true,
      serverConfigured: true,
      sip: cfg.webrtcSip || cfg.sip,
      balance,
      currency,
      webrtcKey,
    });
  } catch (err) {
    console.error('GET /api/zadarma error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/zadarma
 * Actions:
 * - { action: 'status', overrides } -> validates credentials, fetches balance + WebRTC key
 * - { action: 'call', leadId, callId, phoneNumber, fromExtension, overrides } -> triggers Zadarma click-to-call
 */
export async function POST(request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const {
      action = 'call',
      leadId,
      callId,
      phoneNumber,
      fromExtension,
      overrides = {},
    } = body;

    const cfg = getZadarmaConfig(overrides);

    if (action === 'status') {
      if (!cfg.configured) {
        return NextResponse.json({
          configured: false,
          error: 'Zadarma API Key and Secret are required.',
        });
      }

      const balRes = await callZadarmaApi('/v1/info/balance/', {}, 'GET', overrides);
      let webrtcKey = null;
      try {
        const keyRes = await getZadarmaWebRtcKey(fromExtension || cfg.sip, overrides);
        if (keyRes?.key) webrtcKey = keyRes.key;
      } catch {}

      const effCfg = getZadarmaConfig({ ...overrides, sip: fromExtension || cfg.sip });
      return NextResponse.json({
        configured: true,
        sip: effCfg.webrtcSip || effCfg.sip,
        balance: balRes?.balance ?? null,
        currency: balRes?.currency || 'USD',
        webrtcKey,
      });
    }

    // Default action: 'call' (Trigger Zadarma Click-to-Call / Callback)
    let rawPhone = phoneNumber;

    if (!rawPhone && leadId) {
      const rows = await query(
        `SELECT phone_number FROM leads WHERE id = $1 LIMIT 1`,
        [leadId]
      );
      if (rows.length > 0) {
        rawPhone = rows[0].phone_number;
      }
    }

    if (!rawPhone) {
      return NextResponse.json(
        { error: 'Could not find phone number for this attendee.' },
        { status: 400 }
      );
    }

    const targetFrom = (fromExtension || cfg.sip || '100').trim();
    const cleanTo = normalizeZadarmaPhone(rawPhone);

    const callbackRes = await triggerZadarmaCallback({
      from: targetFrom,
      to: cleanTo,
      sip: cfg.sip,
      overrides,
    });

    if (callId) {
      await query(
        `UPDATE calls SET twilio_call_sid = $1 WHERE id = $2`,
        [`zadarma-${Date.now()}`, callId]
      ).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      from: callbackRes.from || targetFrom,
      to: callbackRes.to || cleanTo,
      status: callbackRes.status || 'success',
    });
  } catch (err) {
    console.error('POST /api/zadarma error:', err);
    return NextResponse.json(
      { error: err.message || 'Zadarma call request failed' },
      { status: 500 }
    );
  }
}
