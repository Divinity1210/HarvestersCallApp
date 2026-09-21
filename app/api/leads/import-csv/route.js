import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

function normalizePhoneNumber(raw) {
  if (!raw) return '';
  let clean = String(raw).trim().replace(/[\s\-\(\)\.]/g, '');
  if (clean.startsWith('+')) return clean;
  if (clean.startsWith('00')) return '+' + clean.slice(2);
  if (clean.startsWith('44') || clean.startsWith('234') || (clean.startsWith('1') && clean.length === 11)) {
    return '+' + clean;
  }
  if (clean.startsWith('07') && clean.length === 11) {
    return '+44' + clean.slice(1);
  }
  if (/^0[789][01]\d{8}$/.test(clean)) {
    return '+234' + clean.slice(1);
  }
  if (/^\d{9,15}$/.test(clean)) {
    return '+' + clean;
  }
  return clean;
}

/**
 * POST /api/leads/import-csv
 * Imports parsed leads from client CSV upload in high-speed batches.
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

    const validLeads = [];
    for (const lead of leads) {
      const name = (lead.full_name || '').trim();
      const rawPhone = (lead.phone_number || '').trim();
      const phone = normalizePhoneNumber(rawPhone);
      if (!name || !phone) continue;

      validLeads.push({
        name,
        phone,
        phoneHash: Buffer.from(phone).toString('base64'),
        metadata: lead.metadata || {},
      });
    }

    let imported = 0;
    const chunkSize = 100;

    for (let i = 0; i < validLeads.length; i += chunkSize) {
      const chunk = validLeads.slice(i, i + chunkSize);
      const valueRows = [];
      const params = [];
      let paramIdx = 1;

      for (const l of chunk) {
        valueRows.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, 'pending')`);
        params.push(
          campaignId,
          l.name,
          l.phone,
          l.phoneHash,
          JSON.stringify(l.metadata)
        );
      }

      const batchSql = `
        INSERT INTO leads (campaign_id, full_name, phone_number, phone_hash, metadata, status)
        VALUES ${valueRows.join(', ')}
        ON CONFLICT (campaign_id, phone_hash) DO NOTHING
      `;

      try {
        await query(batchSql, params);
        imported += chunk.length;
      } catch (err) {
        console.error('Batch insert CSV lead error:', err);
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
