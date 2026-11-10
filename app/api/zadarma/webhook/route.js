import { NextResponse, after } from 'next/server';
import { query } from '@/lib/db';
import { fetchZadarmaRecordingUrl, normalizeZadarmaPhone } from '@/lib/zadarma';
import { processCallRecording } from '@/lib/ai/callAnalysis';

export const maxDuration = 120;

/**
 * GET /api/zadarma/webhook
 * Zadarma requires echoing `?zd_echo=<token>` when verifying the webhook URL in their dashboard.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const zdEcho = searchParams.get('zd_echo');
  if (zdEcho) {
    return new Response(zdEcho, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  return NextResponse.json({ ok: true, provider: 'zadarma-webhook' });
}

/**
 * POST /api/zadarma/webhook
 * Handles Zadarma PBX notifications (specifically NOTIFY_RECORD when a call recording MP3 is ready).
 */
export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let payload = {};
    if (contentType.includes('application/json')) {
      payload = await request.json();
    } else {
      const formData = await request.formData();
      for (const [k, v] of formData.entries()) {
        payload[k] = v;
      }
    }

    if (payload.zd_echo) {
      return new Response(String(payload.zd_echo), {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    const event = payload.event;
    const callIdWithRec = payload.call_id_with_rec || payload.pbx_call_id;
    const destination = payload.destination || payload.to || payload.caller_id || '';

    if (event === 'NOTIFY_RECORD' && callIdWithRec) {
      const recInfo = await fetchZadarmaRecordingUrl({
        callIdWithRec,
        phoneNumber: destination,
      }).catch(() => null);

      if (recInfo?.recordingUrl) {
        const cleanDest = normalizeZadarmaPhone(destination);
        const tail = cleanDest ? cleanDest.slice(-9) : '';

        // Match the most recent call in the last 30 minutes
        const callRows = tail
          ? await query(
              `SELECT c.id, c.campaign_id
               FROM calls c
               JOIN leads l ON l.id = c.lead_id
               WHERE regexp_replace(l.phone_number, '[^0-9]', '', 'g') LIKE $1
                 AND c.started_at > now() - interval '30 minutes'
               ORDER BY c.started_at DESC
               LIMIT 1`,
              [`%${tail}`]
            )
          : await query(
              `SELECT id, campaign_id
               FROM calls
               WHERE twilio_call_sid LIKE 'zadarma-%'
                 AND started_at > now() - interval '30 minutes'
               ORDER BY started_at DESC
               LIMIT 1`
            );

        if (callRows.length > 0) {
          const callData = callRows[0];
          await query(
            `UPDATE calls
             SET twilio_recording_sid = $1, recording_url = $2, recording_status = 'completed'
             WHERE id = $3`,
            [callIdWithRec, recInfo.recordingUrl, callData.id]
          );

          await query(
            `INSERT INTO qa_results (call_id, processing_status)
             VALUES ($1, 'pending')
             ON CONFLICT (call_id) DO NOTHING`,
            [callData.id]
          );

          after(() =>
            processCallRecording({
              callId: callData.id,
              recordingUrl: recInfo.recordingUrl,
              campaignId: callData.campaign_id,
            })
          );
        }
      }
    }

    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    console.error('Zadarma webhook error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
