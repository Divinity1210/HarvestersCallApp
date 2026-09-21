import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import Papa from 'papaparse';

/**
 * POST /api/leads/import-google-sheet
 * Imports leads from a Google Sheet (public or shared via link).
 * Supports both Google Sheets API v4 and direct public CSV export fallback.
 */
export async function POST(request) {
  try {
    const {
      campaignId,
      spreadsheetId,
      sheetName = 'Sheet1',
      nameColumn = 'full_name',
      phoneColumn = 'phone_number',
    } = await request.json();

    if (!campaignId || !spreadsheetId) {
      return NextResponse.json(
        { error: 'campaignId and spreadsheetId are required' },
        { status: 400 }
      );
    }

    let headers = [];
    let dataRows = [];

    // Attempt 1: Try Google Sheets API v4 if API key is present
    const apiKey = process.env.GOOGLE_SHEETS_API_KEY || process.env.GOOGLE_AI_API_KEY;
    let fetchedViaApi = false;

    if (apiKey) {
      try {
        const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}?key=${apiKey}`;
        const sheetsResponse = await fetch(sheetsUrl);
        if (sheetsResponse.ok) {
          const sheetsData = await sheetsResponse.json();
          if (sheetsData.values && sheetsData.values.length >= 2) {
            headers = sheetsData.values[0].map(h => String(h).trim().toLowerCase().replace(/\s+/g, '_'));
            dataRows = sheetsData.values.slice(1);
            fetchedViaApi = true;
          }
        }
      } catch (err) {
        console.warn('Google Sheets API v4 fetch failed, falling back to public CSV export:', err);
      }
    }

    // Attempt 2: Fallback to direct public CSV export (works for all "Anyone with link" sheets)
    if (!fetchedViaApi) {
      const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
      const exportRes = await fetch(exportUrl);

      if (!exportRes.ok) {
        return NextResponse.json(
          { error: 'Cannot access Google Sheet. Please ensure the Google Sheet is shared with "Anyone with the link can view".' },
          { status: 403 }
        );
      }

      const csvText = await exportRes.text();
      const parsed = Papa.parse(csvText, { skipEmptyLines: true });
      if (!parsed.data || parsed.data.length < 2) {
        return NextResponse.json(
          { error: 'Sheet is empty or has no data rows (need header + at least 1 data row).' },
          { status: 400 }
        );
      }

      headers = parsed.data[0].map(h => String(h).trim().toLowerCase().replace(/\s+/g, '_'));
      dataRows = parsed.data.slice(1);
    }

    // Find name and phone columns
    const nameIdx = headers.indexOf(nameColumn.toLowerCase().replace(/\s+/g, '_'));
    const phoneIdx = headers.indexOf(phoneColumn.toLowerCase().replace(/\s+/g, '_'));

    const nameColIdx = nameIdx >= 0 ? nameIdx :
      headers.findIndex(h => ['name', 'full_name', 'fullname', 'attendee_name', 'attendee'].includes(h));
    const phoneColIdx = phoneIdx >= 0 ? phoneIdx :
      headers.findIndex(h => ['phone', 'phone_number', 'phonenumber', 'mobile', 'telephone', 'tel'].includes(h));

    if (nameColIdx < 0 || phoneColIdx < 0) {
      return NextResponse.json(
        {
          error: `Could not find name and phone columns. Found headers: [${headers.join(', ')}]. ` +
            `Expected columns named "full_name" and "phone_number" (or similar).`,
        },
        { status: 400 }
      );
    }

    const leads = [];
    const skipped = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const name = (row[nameColIdx] || '').toString().trim();
      const phone = (row[phoneColIdx] || '').toString().trim();

      if (!name || !phone) {
        skipped.push(i + 2);
        continue;
      }

      const metadata = {};
      headers.forEach((header, idx) => {
        if (idx !== nameColIdx && idx !== phoneColIdx && row[idx] && String(row[idx]).trim()) {
          metadata[header] = String(row[idx]).trim();
        }
      });

      leads.push({
        campaign_id: campaignId,
        full_name: name,
        phone_number: phone,
        phone_hash: Buffer.from(phone).toString('base64'),
        metadata: metadata,
      });
    }

    if (leads.length === 0) {
      return NextResponse.json(
        { error: `No valid rows found. ${skipped.length} rows were skipped (missing name or phone).` },
        { status: 400 }
      );
    }

    // Insert leads into Neon PostgreSQL in batches
    let imported = 0;
    for (const lead of leads) {
      try {
        await query(
          `INSERT INTO leads (campaign_id, full_name, phone_number, phone_hash, metadata, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')
           ON CONFLICT (campaign_id, phone_hash) DO NOTHING`,
          [
            lead.campaign_id,
            lead.full_name,
            lead.phone_number,
            lead.phone_hash,
            JSON.stringify(lead.metadata),
          ]
        );
        imported++;
      } catch (insertErr) {
        console.error('Insert lead error:', insertErr);
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      skipped: skipped.length,
      total: dataRows.length,
      message: `✅ Imported ${imported} leads from Google Sheet! ${skipped.length > 0 ? `(${skipped.length} skipped)` : ''}`,
    });
  } catch (err) {
    console.error('Google Sheets import error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
