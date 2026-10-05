import { NextResponse } from 'next/server';
import { processCallRecording } from '@/lib/ai/callAnalysis';

export const maxDuration = 120;

/**
 * POST /api/ai/process-call
 * Re-runs the AI pipeline for a recorded call (manual retry / internal use).
 * The normal path is triggered from /api/twilio/recording-status via after().
 */
export async function POST(request) {
  const { callId, recordingUrl, campaignId } = await request.json();

  if (!callId || !recordingUrl) {
    return NextResponse.json({ error: 'callId and recordingUrl required' }, { status: 400 });
  }

  const result = await processCallRecording({ callId, recordingUrl, campaignId });
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
