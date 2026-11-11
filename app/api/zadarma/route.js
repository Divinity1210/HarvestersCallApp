import { NextResponse, after } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import {
  callZadarmaApi,
  fetchZadarmaRecordingUrl,
  getZadarmaConfig,
  getZadarmaWebRtcKey,
  normalizeZadarmaPhone,
  triggerZadarmaCallback,
} from '@/lib/zadarma';
import { processCallRecording } from '@/lib/ai/callAnalysis';

const PBX_EXTENSIONS = ['604556-100', '604556-101', '604556-102'];

function pickAgentExtension(userId) {
  if (!userId) return PBX_EXTENSIONS[0];
  let hash = 0;
  const s = String(userId);
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return PBX_EXTENSIONS[hash % PBX_EXTENSIONS.length];
}

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

    const assignedSip = pickAgentExtension(session.id);
    const cfg = getZadarmaConfig({ sip: assignedSip });
    if (!cfg.configured) {
      return NextResponse.json({
        configured: false,
        serverConfigured: false,
        sip: cfg.sip || '604556-100',
      });
    }

    let balance = null;
    let currency = '';
    let webrtcKey = null;

    try {
      const balRes = await callZadarmaApi('/v1/info/balance/', {}, 'GET');
      if (balRes?.status === 'success') {
        balance = balRes.balance;
        currency = balRes.currency || 'GBP';
      }
    } catch {}

    try {
      const keyRes = await getZadarmaWebRtcKey(cfg.webrtcSip || cfg.sip);
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

    if (action === 'webrtc-log') {
      let rawPhone = phoneNumber;
      if (!rawPhone && leadId) {
        const rows = await query(
          `SELECT phone_number FROM leads WHERE id = $1 LIMIT 1`,
          [leadId]
        );
        if (rows.length > 0) rawPhone = rows[0].phone_number;
      }
      const cleanTo = normalizeZadarmaPhone(rawPhone);
      if (callId) {
        await query(
          `UPDATE calls SET twilio_call_sid = $1 WHERE id = $2`,
          [`zadarma-${Date.now()}`, callId]
        ).catch(() => {});
      }
      return NextResponse.json({
        success: true,
        to: cleanTo,
        sip: cfg.webrtcSip || cfg.sip,
      });
    }

    if (action === 'process-recording') {
      if (!callId) {
        return NextResponse.json({ recorded: false, reason: 'No callId provided' });
      }
      const callRows = await query(
        `SELECT c.id, c.campaign_id, l.phone_number
         FROM calls c
         LEFT JOIN leads l ON l.id = c.lead_id
         WHERE c.id = $1 LIMIT 1`,
        [callId]
      );
      if (callRows.length === 0) {
        return NextResponse.json({ recorded: false, reason: 'Call not found' });
      }
      const callRow = callRows[0];
      const recInfo = await fetchZadarmaRecordingUrl({
        phoneNumber: phoneNumber || callRow.phone_number,
        overrides,
      }).catch(() => null);

      if (!recInfo?.recordingUrl) {
        return NextResponse.json({ recorded: false });
      }

      await query(
        `UPDATE calls
         SET twilio_recording_sid = $1, recording_url = $2, recording_status = 'completed'
         WHERE id = $3`,
        [recInfo.zadarmaCallId, recInfo.recordingUrl, callRow.id]
      );

      await query(
        `INSERT INTO qa_results (call_id, processing_status)
         VALUES ($1, 'pending')
         ON CONFLICT (call_id) DO NOTHING`,
        [callRow.id]
      );

      after(() =>
        processCallRecording({
          callId: callRow.id,
          recordingUrl: recInfo.recordingUrl,
          campaignId: callRow.campaign_id,
        })
      );

      return NextResponse.json({
        recorded: true,
        zadarmaCallId: recInfo.zadarmaCallId,
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
