import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import Papa from 'papaparse';

/**
 * Normalizes phone numbers into E.164-compatible format (+...).
 */
function normalizePhoneNumber(raw) {
  if (!raw) return '';
  let clean = String(raw).trim().replace(/[\s\-\(\)\.]/g, '');
  if (clean.startsWith('+')) return clean;
  if (clean.startsWith('00')) return '+' + clean.slice(2);
  
  // Standard country codes without '+'
  // UK: 44..., Nigeria: 234..., US/Canada: 1...
  if (clean.startsWith('44') || clean.startsWith('234') || (clean.startsWith('1') && clean.length === 11)) {
    return '+' + clean;
  }
  
  // UK local mobile: 07... (11 digits)
  if (clean.startsWith('07') && clean.length === 11) {
    return '+44' + clean.slice(1);
  }
  
  // Nigeria local: 080..., 081..., 090..., 070... (11 digits)
  if (/^0[789][01]\d{8}$/.test(clean)) {
    return '+234' + clean.slice(1);
  }
  
  // Generic fallback if all digits
  if (/^\d{9,15}$/.test(clean)) {
    return '+' + clean;
  }
  
  return clean;
}

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
      nameColumn,
      phoneColumn,
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
            headers = sheetsData.values[0].map(h => String(h || '').trim().toLowerCase().replace(/\s+/g, '_'));
            dataRows = sheetsData.values.slice(1);
            fetchedViaApi = true;
          }
        }
      } catch (err) {
        console.warn('Google Sheets API v4 fetch failed, falling back to export:', err);
      }
    }

    // Attempt 2: Fallback to direct public CSV export (works for all "Anyone with link" sheets)
    if (!fetchedViaApi) {
      const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
      const exportRes = await fetch(exportUrl);

      if (exportRes.ok) {
        const csvText = await exportRes.text();
        const parsed = Papa.parse(csvText, { skipEmptyLines: true });
        if (parsed.data && parsed.data.length >= 2) {
          headers = parsed.data[0].map(h => String(h || '').trim().toLowerCase().replace(/\s+/g, '_'));
          dataRows = parsed.data.slice(1);
          fetchedViaApi = true;
        }
      }
    }

    if (!fetchedViaApi || headers.length === 0) {
      return NextResponse.json(
        { error: 'Could not access sheet. Make sure the Google Sheet is shared with "Anyone with the link can view", and check that the tab name is correct.' },
        { status: 403 }
      );
    }

    // Comprehensive candidate matchers
    const phoneCandidates = [
      'phone', 'phone_no', 'phone_num', 'phoneno', 'phone_number', 'phonenumber',
      'mobile', 'mobile_no', 'mobileno', 'mobile_number',
      'tel', 'tel_no', 'telephone', 'telephone_no',
      'contact', 'contact_no', 'contact_number', 'cell', 'cellphone', 'cell_phone', 'whatsapp'
    ];

    const nameCandidates = [
      'full_name', 'fullname', 'name', 'attendee_name', 'attendee', 'member_name',
      'contact_name', 'person_name', 'client_name', 'participant_name'
    ];

    // Find custom or auto-detected Name column
    let nameColIdx = -1;
    if (nameColumn) {
      const cleanCustomName = nameColumn.toLowerCase().replace(/\s+/g, '_');
      nameColIdx = headers.indexOf(cleanCustomName);
    }
    if (nameColIdx < 0) {
      nameColIdx = headers.findIndex(h => nameCandidates.includes(h));
    }
    if (nameColIdx < 0) {
      // Fallback: any header containing 'name' but NOT 'agent', 'caller', 'rep'
      nameColIdx = headers.findIndex(h =>
        !h.includes('agent') && !h.includes('caller') && !h.includes('rep') &&
        (h.includes('name') || h.includes('attendee'))
      );
    }

    // Find custom or auto-detected Phone column
    let phoneColIdx = -1;
    if (phoneColumn) {
      const cleanCustomPhone = phoneColumn.toLowerCase().replace(/\s+/g, '_');
      phoneColIdx = headers.indexOf(cleanCustomPhone);
    }
    if (phoneColIdx < 0) {
      phoneColIdx = headers.findIndex(h => phoneCandidates.includes(h));
    }
    if (phoneColIdx < 0) {
      // Fallback: any header containing 'phone', 'tel', 'mobile', or 'contact'
      phoneColIdx = headers.findIndex(h =>
        !h.includes('agent') &&
        (h.includes('phone') || h.includes('mobile') || h.includes('tel') || h.includes('contact'))
      );
    }

    if (nameColIdx < 0 || phoneColIdx < 0) {
      return NextResponse.json(
        {
          error: `Could not identify attendee name and phone columns. Found headers: [${headers.join(', ')}]. ` +
            `Please ensure a column for name (e.g. "Name") and phone (e.g. "Phone", "Phone No") exists.`,
        },
        { status: 400 }
      );
    }

    const leads = [];
    const skipped = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const name = (row[nameColIdx] || '').toString().trim();
      const rawPhone = (row[phoneColIdx] || '').toString().trim();
      const phone = normalizePhoneNumber(rawPhone);

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
        row_index: i + 1,
      });
    }

    if (leads.length === 0) {
      return NextResponse.json(
        { error: `No valid attendee records found. ${skipped.length} rows were skipped (empty name or phone).` },
        { status: 400 }
      );
    }

    // Insert leads into Neon PostgreSQL in batches of 100 for ultra-fast performance
    let imported = 0;
    const chunkSize = 100;
    for (let i = 0; i < leads.length; i += chunkSize) {
      const chunk = leads.slice(i, i + chunkSize);
      const valueRows = [];
      const params = [];
      let paramIdx = 1;

      for (const l of chunk) {
        valueRows.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, 'pending')`);
        params.push(
          l.campaign_id,
          l.full_name,
          l.phone_number,
          l.phone_hash,
          JSON.stringify(l.metadata),
          l.row_index
        );
      }

      const batchSql = `
        INSERT INTO leads (campaign_id, full_name, phone_number, phone_hash, metadata, row_index, status)
        VALUES ${valueRows.join(', ')}
        ON CONFLICT (campaign_id, phone_hash) DO NOTHING
      `;

      try {
        await query(batchSql, params);
        imported += chunk.length;
      } catch (insertErr) {
        console.error('Batch insert lead error:', insertErr);
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
