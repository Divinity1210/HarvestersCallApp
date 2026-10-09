import { NextResponse } from 'next/server';
import { generateJSON } from '@/lib/ai/gemini';
import { getSessionUser } from '@/lib/auth';

export const maxDuration = 30;

const PARSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    formattedScript: {
      type: 'STRING',
      description: 'The polished script structured with ## Section headers, SAY: for agent spoken lines, ASK: for questions, NOTE: for tips, ACTION: for agent tasks, and {{attendee_name}} / {{agent_name}} tags.'
    },
    questions: {
      type: 'ARRAY',
      description: 'Structured questions that the caller must capture responses for.',
      items: {
        type: 'OBJECT',
        properties: {
          question: { type: 'STRING' },
          options: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['question', 'options']
      }
    },
    actions: {
      type: 'ARRAY',
      description: 'Standalone checklist actions to capture (e.g. Registration link sent via SMS)',
      items: { type: 'STRING' }
    },
    eventLogistics: {
      type: 'OBJECT',
      properties: {
        eventName: { type: 'STRING' },
        date: { type: 'STRING' },
        time: { type: 'STRING' },
        venue: { type: 'STRING' },
        address: { type: 'STRING' }
      }
    },
    recommendedSms: {
      type: 'STRING',
      description: 'Suggested SMS template with event details and registration link for follow-up'
    }
  },
  required: ['formattedScript', 'questions']
};

/**
 * POST /api/ai/parse-script
 * Analyzes raw script text with Gemini to format the script into intuitive sections
 * and automatically extract interactive question buttons and actions.
 */
export async function POST(request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { script, campaignName } = await request.json();
    if (!script || String(script).trim().length < 10) {
      return NextResponse.json({ error: 'Please enter a script to analyze' }, { status: 400 });
    }

    const prompt = `You are an elite call-center script designer and UX specialist for church and community outreach campaigns.

Analyze this call script for campaign "${campaignName || 'Harvesters Outreach'}":

---
${script.trim()}
---

Instructions:
1. FORMAT SCRIPT:
   - Organize into logical, easy-to-read sections with markdown headers:
     ## 1. Greeting & Introduction
     ## 2. Personal Invitation & Event Details
     ## 3. Quick Confirmation Questions
     ## 4. Registration & Closing
   - Prefix spoken dialog with "SAY:"
   - Prefix interactive questions with "ASK:"
   - Prefix instructions/listening cues with "NOTE:"
   - Prefix operational steps (like sending SMS) with "ACTION:"
   - Replace person/attendee placeholders ([Name], [Attendee], etc.) with {{attendee_name}}
   - Replace caller/agent placeholders ([Caller's Name], [Agent], etc.) with {{agent_name}}
   - Highlight event logistics (dates, times, venues) with **bold** text.
   - Separate every section and dialogue line with a clear newline.

2. EXTRACT FEEDBACK BUTTONS / QUESTIONS:
   - Identify every question where the caller MUST capture an answer (e.g., Attendance, Volunteering, Bus/Transport, Prayer needs).
   - Provide clean, standardized answer choices (e.g. ["Yes", "No", "Not sure yet"] or ["Yes", "No"]).
   - Identify any standalone checklist action (e.g. "Registration link sent via SMS").

3. EXTRACT EVENT LOGISTICS & SMS:
   - Extract event name, date, time, venue, address.
   - Craft a warm, concise SMS follow-up message with the details and a registration link placeholder.
`;

    const aiResult = await generateJSON([{ text: prompt }], PARSE_SCHEMA, { temperature: 0.1 });

    // Build the flat next_steps_options array format used by the app
    const flatOptions = [];
    (aiResult.questions || []).forEach(q => {
      flatOptions.push(q.question.trim());
      (q.options || []).forEach(opt => flatOptions.push(opt.trim()));
    });
    (aiResult.actions || []).forEach(act => {
      flatOptions.push(act.trim());
    });

    return NextResponse.json({
      success: true,
      formattedScript: aiResult.formattedScript,
      questions: aiResult.questions || [],
      actions: aiResult.actions || [],
      flatOptions,
      eventLogistics: aiResult.eventLogistics || null,
      recommendedSms: aiResult.recommendedSms || null
    });
  } catch (err) {
    console.error('Parse script error:', err);
    return NextResponse.json({ error: err.message || 'Failed to parse script' }, { status: 500 });
  }
}
