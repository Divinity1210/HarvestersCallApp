import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

const envText = fs.readFileSync('.env.production.local', 'utf-8');
const match = envText.match(/DATABASE_URL=\"([^\"]+)\"/);
const sql = neon(match[1]);

function normalizePhone(raw) {
  if (!raw) return null;
  let str = String(raw).trim();
  str = str.replace(/^[=\'"\s]+/, '').replace(/[\'"\s]+$/, '');
  if (str.startsWith('+')) str = str.slice(1);
  let digits = str.replace(/[^0-9]/g, '');
  
  if (!digits || digits.length < 7) {
    return null;
  }

  // UK mobile missing 44 (e.g. 7498521991 - 10 digits starting with 7)
  if (digits.length === 10 && digits.startsWith('7')) {
    digits = '44' + digits;
  }
  // UK local mobile with 0 (e.g. 07498521991 - 11 digits starting with 07)
  else if (digits.length === 11 && digits.startsWith('07')) {
    digits = '44' + digits.slice(1);
  }
  // Nigeria local with 0 (e.g. 080..., 081..., 070..., 090... - 11 digits)
  else if (digits.length === 11 && (digits.startsWith('08') || digits.startsWith('09') || digits.startsWith('07'))) {
    digits = '234' + digits.slice(1);
  }
  // Nigeria with 234080... (extra 0 after 234)
  else if (digits.length === 14 && digits.startsWith('2340')) {
    digits = '234' + digits.slice(4);
  }
  // UK with 4407... (extra 0 after 44)
  else if (digits.length === 13 && digits.startsWith('4407')) {
    digits = '44' + digits.slice(3);
  }

  return '+' + digits;
}

function parseName(fullName) {
  if (!fullName) return { firstName: '', lastName: '', displayName: '' };
  let str = fullName.trim();
  if (str.includes(',')) {
    const parts = str.split(',').map(p => p.trim());
    const lastName = parts[0] || '';
    const firstName = parts.slice(1).join(' ') || '';
    return {
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`.trim()
    };
  }
  const parts = str.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '', displayName: parts[0] };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
    displayName: str
  };
}

export async function runLiveCleanup() {
  console.log('1. Loading existing leads from database...');
  const leads = await sql`SELECT * FROM leads ORDER BY created_at ASC`;
  console.log(`Loaded ${leads.length} leads.`);

  // Create a backup directory and save current leads state
  const backupDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `leads_backup_${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(leads, null, 2), 'utf-8');
  console.log(`✅ Safe backup created at: ${backupFile}`);

  const phoneGroups = new Map();
  const invalidLeadIds = [];

  for (const l of leads) {
    const norm = normalizePhone(l.phone_number);
    if (!norm) {
      invalidLeadIds.push(l.id);
      continue;
    }
    if (!phoneGroups.has(norm)) {
      phoneGroups.set(norm, []);
    }
    phoneGroups.get(norm).push(l);
  }

  const winnersToUpdate = [];
  const duplicateIdMap = new Map(); // duplicateId -> winnerId
  const statusRank = { completed: 5, called: 4, no_answer: 3, unreached: 2, callback_requested: 2, pending: 1 };

  for (const [phone, group] of phoneGroups.entries()) {
    group.sort((a, b) => {
      const rankA = statusRank[a.status] || 0;
      const rankB = statusRank[b.status] || 0;
      if (rankB !== rankA) return rankB - rankA;
      const emailA = a.metadata?.email ? 1 : 0;
      const emailB = b.metadata?.email ? 1 : 0;
      return emailB - emailA;
    });

    const winner = group[0];
    const { firstName, lastName, displayName } = parseName(winner.full_name);
    const updatedMetadata = {
      ...(winner.metadata || {}),
      first_name: firstName,
      last_name: lastName
    };

    winnersToUpdate.push({
      id: winner.id,
      cleanPhone: phone,
      displayName,
      metadata: updatedMetadata
    });

    for (let i = 1; i < group.length; i++) {
      duplicateIdMap.set(group[i].id, winner.id);
    }
  }

  console.log(`\n2. Re-pointing any calls attached to duplicate leads...`);
  const existingCalls = await sql`SELECT id, lead_id FROM calls`;
  let remappedCalls = 0;
  for (const call of existingCalls) {
    if (duplicateIdMap.has(call.lead_id)) {
      const newLeadId = duplicateIdMap.get(call.lead_id);
      await sql`UPDATE calls SET lead_id = ${newLeadId} WHERE id = ${call.id}`;
      remappedCalls++;
    }
  }
  console.log(`✅ Re-pointed ${remappedCalls} calls to winning lead IDs.`);

  console.log(`\n3. Deleting ${duplicateIdMap.size} duplicate leads...`);
  const dupIds = Array.from(duplicateIdMap.keys());
  const DELETE_CHUNK_SIZE = 500;
  for (let i = 0; i < dupIds.length; i += DELETE_CHUNK_SIZE) {
    const chunk = dupIds.slice(i, i + DELETE_CHUNK_SIZE);
    await sql`DELETE FROM leads WHERE id = ANY(${chunk}::uuid[])`;
    process.stdout.write(`Deleted ${Math.min(i + DELETE_CHUNK_SIZE, dupIds.length)} / ${dupIds.length} duplicates...\r`);
  }
  console.log(`\n✅ Deleted all ${dupIds.length} duplicate leads.`);

  if (invalidLeadIds.length > 0) {
    console.log(`\n4. Deleting ${invalidLeadIds.length} corrupt/invalid entries...`);
    await sql`DELETE FROM calls WHERE lead_id = ANY(${invalidLeadIds}::uuid[])`;
    await sql`DELETE FROM leads WHERE id = ANY(${invalidLeadIds}::uuid[])`;
    console.log(`✅ Deleted ${invalidLeadIds.length} invalid entries.`);
  }

  console.log(`\n5. Updating phone numbers & names to normalized standard on remaining ${winnersToUpdate.length} leads...`);
  const UPDATE_CHUNK_SIZE = 1000;
  let updatedCount = 0;
  for (let i = 0; i < winnersToUpdate.length; i += UPDATE_CHUNK_SIZE) {
    const chunk = winnersToUpdate.slice(i, i + UPDATE_CHUNK_SIZE);
    const ids = chunk.map(c => c.id);
    const phones = chunk.map(c => c.cleanPhone);
    const names = chunk.map(c => c.displayName);
    const metas = chunk.map(c => JSON.stringify(c.metadata));

    await sql`
      UPDATE leads AS l
      SET phone_number = v.phone_number,
          full_name = v.full_name,
          metadata = v.metadata::jsonb,
          updated_at = NOW()
      FROM (
        SELECT * FROM unnest(
          ${ids}::uuid[],
          ${phones}::text[],
          ${names}::text[],
          ${metas}::text[]
        ) AS t(id, phone_number, full_name, metadata)
      ) AS v
      WHERE l.id = v.id
    `;
    updatedCount += chunk.length;
    process.stdout.write(`Updated ${updatedCount} / ${winnersToUpdate.length} leads...\r`);
  }

  console.log(`\n\n🎉 Live database cleanup successfully completed!`);
  const finalCount = await sql`SELECT count(*) FROM leads`;
  console.log(`Remaining clean leads in live database: ${finalCount[0].count}`);

  const campaignCounts = await sql`
    SELECT c.name, count(l.id) as count 
    FROM campaigns c 
    LEFT JOIN leads l ON l.campaign_id = c.id 
    GROUP BY c.id, c.name
  `;
  console.log('\nCampaign Breakdown:');
  for (const c of campaignCounts) {
    console.log(`- ${c.name}: ${c.count} leads`);
  }
}

if (process.argv.includes('--execute')) {
  runLiveCleanup().catch(console.error);
} else {
  console.log('Safe mode: Run with `--execute` to apply changes directly to the live database.');
}
