import { NextResponse } from 'next/server';
import twilio from 'twilio';

/**
 * POST /api/twilio/token
 * Generates a Twilio AccessToken with a Voice grant for browser-based calling.
 * The agent's browser uses this token to initialize the Twilio Device (WebRTC).
 */
export async function POST(request) {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKeySid = process.env.TWILIO_API_KEY_SID;
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
    const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

    if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
      return NextResponse.json(
        { error: 'Twilio credentials not configured' },
        { status: 500 }
      );
    }

    const { AccessToken } = twilio.jwt;
    const { VoiceGrant } = AccessToken;

    // Create an access token (valid for 1 hour)
    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity: `agent-${Date.now()}`, // Unique identity per session
      ttl: 3600,
    });

    // Create a Voice grant for outbound calling
    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: false, // Outbound only for Phase 1
    });

    token.addGrant(voiceGrant);

    return NextResponse.json({ token: token.toJwt() });
  } catch (err) {
    console.error('Twilio token generation error:', err);
    return NextResponse.json(
      { error: 'Failed to generate token' },
      { status: 500 }
    );
  }
}
