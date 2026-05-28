import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

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
    const recordingDuration = formData.get('RecordingDuration');

    if (!callSid || !recordingSid) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Update call with recording info
    const { data: callData, error: updateError } = await supabase
      .from('calls')
      .update({
        twilio_recording_sid: recordingSid,
        recording_url: recordingUrl,
        recording_status: recordingStatus,
      })
      .eq('twilio_call_sid', callSid)
      .select('id, campaign_id')
      .single();

    if (updateError) {
      console.error('Recording update error:', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Create a qa_results row with 'pending' status
    if (callData && recordingStatus === 'completed') {
      await supabase
        .from('qa_results')
        .upsert({
          call_id: callData.id,
          processing_status: 'pending',
        });

      // Trigger async AI processing
      // In production, this would be a background job
      // For now, we fire-and-forget to our process-call endpoint
      const baseUrl = new URL(request.url);
      fetch(`${baseUrl.protocol}//${baseUrl.host}/api/ai/process-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId: callData.id,
          recordingUrl: `${recordingUrl}.mp3`,
          campaignId: callData.campaign_id,
        }),
      }).catch(err => console.error('AI processing trigger error:', err));
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Recording status webhook error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
