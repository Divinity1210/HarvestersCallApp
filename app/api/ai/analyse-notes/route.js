import { NextResponse } from 'next/server';
import { analyseNotes } from '@/lib/ai/callAnalysis';

export const maxDuration = 30;

/**
 * POST /api/ai/analyse-notes
 * Notes assistant for SIM/phone calls (no recording available):
 * turns a volunteer's rough notes into clean notes + pre-selected responses.
 *
 * Body: { notes: string, campaignId: string, attendeeName?: string }
 */
export async function POST(request) {
  try {
    const { notes, campaignId, attendeeName } = await request.json();

    if (!notes || String(notes).trim().length < 3) {
      return NextResponse.json({ error: 'Type a few words about the call first.' }, { status: 400 });
    }

    const result = await analyseNotes({ notes, campaignId, attendeeName });
    return NextResponse.json(result);
  } catch (err) {
    console.error('Analyse notes error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
