import { neon } from '@neondatabase/serverless';
import fs from 'fs';

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

export async function previewDatabaseCleanup() {
  console.log('Fetching leads from Neon database...');
  const leads = await sql`
    SELECT id, campaign_id, full_name, phone_number, status, metadata, call_attempts
    FROM leads
  `;
  console.log(`Loaded ${leads.length} leads.`);

  const phoneGroups = new Map();
  const invalidIds = [];

  for (const l of leads) {
    const norm = normalizePhone(l.phone_number);
    if (!norm) {
      invalidIds.push(l.id);
      continue;
    }
    if (!phoneGroups.has(norm)) {
      phoneGroups.set(norm, []);
    }
    phoneGroups.get(norm).push(l);
  }

  const winningIds = [];
  const duplicateIdsToDelete = [];

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
    winningIds.push({ id: winner.id, cleanPhone: phone });
    for (let i = 1; i < group.length; i++) {
      duplicateIdsToDelete.push({ duplicateId: group[i].id, winnerId: winner.id });
    }
  }

  console.log('--- Cleanup Summary (Dry Run) ---');
  console.log(`Total current leads: ${leads.length}`);
  console.log(`Valid unique leads to keep: ${winningIds.length}`);
  console.log(`Duplicate leads to remove: ${duplicateIdsToDelete.length}`);
  console.log(`Invalid / corrupt phone entries to remove: ${invalidIds.length}`);
}

previewDatabaseCleanup();
