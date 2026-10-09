import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

const envText = fs.readFileSync('.env.production.local', 'utf-8');
const match = envText.match(/DATABASE_URL=\"([^\"]+)\"/);
const sql = neon(match[1]);

export async function processOmitOutsideUk() {
  console.log('Fetching Sheffield campaign leads...');
  const rows = await sql`
    SELECT l.id, l.phone_number, l.full_name, l.status, l.metadata
    FROM leads l
    JOIN campaigns c ON c.id = l.campaign_id
    WHERE c.name = 'NLP Night of Worship Sheffield'
  `;

  console.log(`Loaded ${rows.length} Sheffield leads.`);

  const distantPrefixes = ['G', 'EH', 'AB', 'DD', 'IV', 'KW', 'PA', 'PH', 'TR', 'PL', 'EX', 'TQ', 'BN', 'CT', 'SO', 'PO', 'BH', 'DT', 'TA', 'BT'];
  
  const toOmit = [];
  const toKeep = [];

  for (const r of rows) {
    const phone = r.phone_number;
    const transport = (r.metadata?.transport_details || '').toUpperCase();
    const comment = (r.metadata?.comment || '').toUpperCase();

    // 1. Outside UK numbers (not +44)
    if (!phone.startsWith('+44')) {
      let reason = 'Outside UK';
      if (phone.startsWith('+353')) reason = 'Outside UK - Dublin / Ireland (+353)';
      else if (phone.startsWith('+234')) reason = 'Outside UK - Nigeria (+234)';
      else if (phone.startsWith('+1')) reason = 'Outside UK - USA/Canada (+1)';
      else reason = `Outside UK - International (${phone.slice(0, 3)})`;

      toOmit.push({
        ...r,
        omitReason: reason,
        isDistantLocation: false,
        isOutsideUk: true
      });
      continue;
    }

    // 2. Check for geographically distant UK locations from Sheffield (>150 miles)
    let matchedDistant = null;
    for (const dp of distantPrefixes) {
      const regex = new RegExp('(?:^|[^A-Z])' + dp + '[0-9]', 'i');
      if (regex.test(transport) || transport.includes('GLASGOW') || transport.includes('EDINBURGH') || transport.includes('BRIGHTON') || transport.includes('PLYMOUTH') || transport.includes('CORNWALL') || transport.includes('SOUTHAMPTON') || transport.includes('BOURNEMOUTH') || transport.includes('PORTSMOUTH') || transport.includes('BALLYMENA') || transport.includes('BELFAST') || transport.includes('DUNDEE')) {
        matchedDistant = r.metadata?.transport_details;
        break;
      }
    }

    if (matchedDistant) {
      toOmit.push({
        ...r,
        omitReason: `Too far from Sheffield (${matchedDistant})`,
        isDistantLocation: true,
        isOutsideUk: false
      });
      continue;
    }

    toKeep.push(r);
  }

  console.log(`\n--- Classification Results ---`);
  console.log(`Total Sheffield leads: ${rows.length}`);
  console.log(`Leads to keep for active calling (UK local/regional): ${toKeep.length}`);
  console.log(`Leads to omit / skip: ${toOmit.length}`);
  
  const outsideUkCount = toOmit.filter(o => o.isOutsideUk).length;
  const distantCount = toOmit.filter(o => o.isDistantLocation).length;
  console.log(`  - Outside UK (including Dublin/Ireland): ${outsideUkCount}`);
  console.log(`  - Geographically distant UK (>150 mi): ${distantCount}`);

  // Create CSV exports
  function toCsvRow(arr) {
    return arr.map(v => {
      const s = String(v ?? '').replace(/"/g, '""');
      return `"${s}"`;
    }).join(',');
  }

  // 1. Omitted contacts CSV
  const omitHeaders = ['Asterisk Mark', 'Full Name', 'Phone Number', 'Email', 'Omit Reason', 'Transport Details', 'Original Status'];
  const omitRows = [omitHeaders.join(',')];
  for (const o of toOmit) {
    omitRows.push(toCsvRow([
      '*',
      o.full_name,
      o.phone_number,
      o.metadata?.email || '',
      o.omitReason,
      o.metadata?.transport_details || '',
      o.status
    ]));
  }
  const omitCsvPath = path.join(process.cwd(), 'sheffield_omitted_outside_uk.csv');
  fs.writeFileSync(omitCsvPath, omitRows.join('\n'), 'utf-8');
  console.log(`\n📁 Generated Omitted Leads CSV: ${omitCsvPath}`);

  // 2. Active UK Calling List CSV
  const keepHeaders = ['Full Name', 'First Name', 'Last Name', 'Phone Number', 'Email', 'Transport Details', 'Status'];
  const keepRows = [keepHeaders.join(',')];
  for (const k of toKeep) {
    keepRows.push(toCsvRow([
      k.full_name,
      k.metadata?.first_name || '',
      k.metadata?.last_name || '',
      k.phone_number,
      k.metadata?.email || '',
      k.metadata?.transport_details || '',
      k.status
    ]));
  }
  const keepCsvPath = path.join(process.cwd(), 'sheffield_active_uk_calling_list.csv');
  fs.writeFileSync(keepCsvPath, keepRows.join('\n'), 'utf-8');
  console.log(`📁 Generated Active UK Calling List CSV: ${keepCsvPath}`);

  // If --execute flag is passed, update live database
  if (process.argv.includes('--execute')) {
    console.log(`\nUpdating live database: marking ${toOmit.length} leads as 'omitted_outside_uk'...`);
    const CHUNK_SIZE = 500;
    for (let i = 0; i < toOmit.length; i += CHUNK_SIZE) {
      const chunk = toOmit.slice(i, i + CHUNK_SIZE);
      const ids = chunk.map(c => c.id);
      const asteriskNames = chunk.map(c => `* ${c.full_name}`);
      const metas = chunk.map(c => JSON.stringify({
        ...(c.metadata || {}),
        omitted: true,
        omitted_reason: c.omitReason,
        asterisk: '*'
      }));

      await sql`
        UPDATE leads AS l
        SET status = 'omitted_outside_uk',
            full_name = v.full_name,
            metadata = v.metadata::jsonb,
            updated_at = NOW()
        FROM (
          SELECT * FROM unnest(
            ${ids}::uuid[],
            ${asteriskNames}::text[],
            ${metas}::text[]
          ) AS t(id, full_name, metadata)
        ) AS v
        WHERE l.id = v.id
      `;
      process.stdout.write(`Updated ${Math.min(i + CHUNK_SIZE, toOmit.length)} / ${toOmit.length} leads...\r`);
    }
    console.log(`\n✅ Live database successfully updated! All ${toOmit.length} records marked with status='omitted_outside_uk' and asterisk.`);
  } else {
    console.log(`\n(Dry run complete. Run with --execute to apply this to the live database.)`);
  }
}

processOmitOutsideUk().catch(console.error);
