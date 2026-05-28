import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

/**
 * POST /api/leads/import-google-sheet
 * Imports leads from a Google Sheet (public or shared via link).
 * Uses the Google Sheets API v4 with an API key (no OAuth needed for public sheets).
 *
 * Expected body: { campaignId, spreadsheetId, sheetName?, nameColumn?, phoneColumn? }
 *
 * The spreadsheet ID is the long string in the Google Sheets URL:
 * https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit
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

    const apiKey = process.env.GOOGLE_SHEETS_API_KEY || process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Google API key not configured. Set GOOGLE_SHEETS_API_KEY or GOOGLE_AI_API_KEY in your environment.' },
        { status: 500 }
      );
    }

    // Fetch the sheet data using Google Sheets API v4
    const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}?key=${apiKey}`;

    const sheetsResponse = await fetch(sheetsUrl);

    if (!sheetsResponse.ok) {
      const errorText = await sheetsResponse.text();
      if (sheetsResponse.status === 403) {
        return NextResponse.json(
          { error: 'Cannot access the Google Sheet. Make sure it is shared as "Anyone with the link can view".' },
          { status: 403 }
        );
      }
      if (sheetsResponse.status === 404) {
        return NextResponse.json(
          { error: `Sheet "${sheetName}" not found. Check the sheet name or spreadsheet ID.` },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: `Google Sheets API error: ${sheetsResponse.status} - ${errorText}` },
        { status: sheetsResponse.status }
      );
    }

    const sheetsData = await sheetsResponse.json();
    const rows = sheetsData.values;

    if (!rows || rows.length < 2) {
      return NextResponse.json(
        { error: 'Sheet is empty or has no data rows (need header + at least 1 data row).' },
        { status: 400 }
      );
    }

    // First row is headers
    const headers = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const dataRows = rows.slice(1);

    // Find the name and phone column indices
    const nameIdx = headers.indexOf(nameColumn.toLowerCase().replace(/\s+/g, '_'));
    const phoneIdx = headers.indexOf(phoneColumn.toLowerCase().replace(/\s+/g, '_'));

    // Fallback: try common column names
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

    // Parse rows into leads
    const supabase = createAdminClient();
    const leads = [];
    const skipped = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const name = (row[nameColIdx] || '').trim();
      const phone = (row[phoneColIdx] || '').trim();

      if (!name || !phone) {
        skipped.push(i + 2); // +2 for 1-indexed + header row
        continue;
      }

      // Build metadata from remaining columns
      const metadata = {};
      headers.forEach((header, idx) => {
        if (idx !== nameColIdx && idx !== phoneColIdx && row[idx] && row[idx].trim()) {
          metadata[header] = row[idx].trim();
        }
      });

      leads.push({
        campaign_id: campaignId,
        full_name: name,
        phone_number: phone,
        phone_hash: Buffer.from(phone).toString('base64'),
        metadata: Object.keys(metadata).length > 0 ? metadata : {},
      });
    }

    if (leads.length === 0) {
      return NextResponse.json(
        { error: `No valid rows found. ${skipped.length} rows were skipped (missing name or phone).` },
        { status: 400 }
      );
    }

    // Insert in batches of 100
    let imported = 0;
    let duplicates = 0;

    for (let i = 0; i < leads.length; i += 100) {
      const batch = leads.slice(i, i + 100);
      const { data, error, count } = await supabase
        .from('leads')
        .upsert(batch, {
          onConflict: 'campaign_id,phone_hash',
          ignoreDuplicates: true,
        })
        .select('id');

      if (error) {
        return NextResponse.json(
          { error: `Import error at batch ${Math.floor(i / 100) + 1}: ${error.message}`, imported },
          { status: 500 }
        );
      }

      imported += data?.length || batch.length;
    }

    return NextResponse.json({
      success: true,
      imported,
      skipped: skipped.length,
      total: dataRows.length,
      message: `✅ Imported ${imported} leads from Google Sheet. ${skipped.length > 0 ? `${skipped.length} rows skipped (missing data).` : ''}`,
    });
  } catch (err) {
    console.error('Google Sheets import error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
