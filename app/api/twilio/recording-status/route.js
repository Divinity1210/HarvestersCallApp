import { NextResponse, after } from 'next/server';
import { query } from '@/lib/db';
import { processCallRecording } from '@/lib/ai/callAnalysis';

export const maxDuration = 120;

/**
 * POST /api/twilio/recording-status
 * Called by Twilio when a call recording is complete.
 * Triggers the AI processing pipeline.
 */
export async function POST(request) {
  try {
    const formData = await request.formData();
    const callSid = formData.get('CallSid');
    const recordingSid = formData.get('RecordingSid');
    const recordingUrl = formData.get('RecordingUrl');
    const recordingStatus = formData.get('RecordingStatus');

    if (!callSid || !recordingSid) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const rows = await query(
      `UPDATE calls 
       SET twilio_recording_sid = $1, recording_url = $2, recording_status = $3 
       WHERE twilio_call_sid = $4 
       RETURNING id, campaign_id`,
      [recordingSid, recordingUrl, recordingStatus, callSid]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Call not found' }, { status: 404 });
    }

    const callData = rows[0];

    // Create a qa_results row with 'pending' status
    if (recordingStatus === 'completed') {
      await query(
        `INSERT INTO qa_results (call_id, processing_status) 
         VALUES ($1, 'pending') 
         ON CONFLICT (call_id) DO NOTHING`,
        [callData.id]
      );

      // Run the AI pipeline after responding to Twilio (keeps the serverless
      // function alive until it finishes — a bare fetch() could be cut off).
      after(() => processCallRecording({
        callId: callData.id,
        recordingUrl: `${recordingUrl}.mp3`,
        campaignId: callData.campaign_id,
      }));
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Recording status webhook error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
