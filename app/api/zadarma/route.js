import { NextResponse, after } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import {
  callZadarmaApi,
  fetchZadarmaRecordingUrl,
  getZadarmaWebRtcKey,
  normalizeZadarmaPhone,
  resolveZadarmaConfig,
  saveZadarmaDbConfig,
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
 * Returns Zadarma configuration status, WebRTC key, and balance (loaded from Neon DB or env vars).
 */
export async function GET() {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const assignedSip = pickAgentExtension(session.id);
    const cfg = await resolveZadarmaConfig({ sip: assignedSip });
    if (!cfg.configured) {
      return NextResponse.json({
        configured: false,
        serverConfigured: false,
        sip: assignedSip,
        error:
          'Zadarma API Key needs to be refreshed. Open ⚙️ Zadarma Setup once and paste your Key & Secret from my.zadarma.com/marketplace/#tab-apiKeys (saved automatically for all volunteers).',
      });
    }

    let balance = null;
    let currency = '';
    let webrtcKey = null;
    let authError = '';

    try {
      const balRes = await callZadarmaApi('/v1/info/balance/', {}, 'GET');
      if (balRes?.status === 'success') {
        balance = balRes.balance;
        currency = balRes.currency || 'GBP';
      }
    } catch (e) {
      authError = e.message || 'Zadarma API authentication failed';
    }

    try {
      const keyRes = await getZadarmaWebRtcKey(assignedSip);
      if (keyRes?.status === 'success' && keyRes.key) {
        webrtcKey = keyRes.key;
      }
    } catch (e) {
      if (!authError) authError = e.message || 'Could not generate Zadarma WebRTC key';
    }

    if (!webrtcKey) {
      return NextResponse.json({
        configured: false,
        serverConfigured: false,
        sip: assignedSip,
        balance,
        currency,
        webrtcKey: null,
        error:
          authError ||
          'Zadarma could not issue a WebRTC audio key. Please paste a fresh API Key & Secret in ⚙️ Zadarma Setup.',
      });
    }

    return NextResponse.json({
      configured: true,
      serverConfigured: true,
      sip: assignedSip,
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
 * - { action: 'status', overrides } -> validates credentials, saves to Neon DB for all agents, fetches balance + WebRTC key
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

    const assignedSip = pickAgentExtension(session.id);
    const cfg = await resolveZadarmaConfig({
      ...overrides,
      sip: fromExtension || overrides.sip || assignedSip,
    });

    if (action === 'status') {
      if (!cfg.configured) {
        return NextResponse.json({
          configured: false,
          error:
            'Zadarma API Key and Secret are required. Paste your active Key & Secret from my.zadarma.com/marketplace/#tab-apiKeys.',
        });
      }

      const balRes = await callZadarmaApi('/v1/info/balance/', {}, 'GET', overrides);
      const targetSip = cfg.webrtcSip || assignedSip;
      const keyRes = await getZadarmaWebRtcKey(targetSip, overrides);
      const webrtcKey = keyRes?.key || null;

      if (!webrtcKey) {
        return NextResponse.json(
          {
            configured: false,
            error:
              'Zadarma API verified, but WebRTC key was empty. Ensure extension ' +
              targetSip +
              ' exists in My PBX -> Extensions.',
          },
          { status: 400 }
        );
      }

      // Persist valid credentials centrally in Neon PostgreSQL so ALL volunteers immediately work!
      if (overrides.apiKey && overrides.apiSecret) {
        await saveZadarmaDbConfig({
          apiKey: cfg.apiKey,
          apiSecret: cfg.apiSecret,
          pbxId: cfg.pbxId,
          callerId: cfg.callerId,
          sip: targetSip,
        }).catch(err => console.warn('Could not persist zadarma_config to DB:', err));
      }

      return NextResponse.json({
        configured: true,
        sip: targetSip,
        balance: balRes?.balance ?? null,
        currency: balRes?.currency || 'GBP',
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
