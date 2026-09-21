import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * POST /api/leads/import-csv
 * Imports parsed leads from client CSV upload.
 */
export async function POST(request) {
  try {
    const { campaignId, leads } = await request.json();

    if (!campaignId || !Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json(
        { error: 'campaignId and non-empty leads array are required' },
        { status: 400 }
      );
    }

    let imported = 0;
    for (const lead of leads) {
      const name = (lead.full_name || '').trim();
      const phone = (lead.phone_number || '').trim();
      if (!name || !phone) continue;

      const phoneHash = Buffer.from(phone).toString('base64');
      const metadata = lead.metadata || {};

      try {
        await query(
          `INSERT INTO leads (campaign_id, full_name, phone_number, phone_hash, metadata, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')
           ON CONFLICT (campaign_id, phone_hash) DO NOTHING`,
          [campaignId, name, phone, phoneHash, JSON.stringify(metadata)]
        );
        imported++;
      } catch (err) {
        console.error('Error inserting CSV lead:', err);
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      message: `✅ Successfully imported ${imported} leads!`,
    });
  } catch (err) {
    console.error('CSV import error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
