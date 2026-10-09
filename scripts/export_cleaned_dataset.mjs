import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

const envText = fs.readFileSync('.env.production.local', 'utf-8');
const match = envText.match(/DATABASE_URL=\"([^\"]+)\"/);
const sql = neon(match[1]);

function normalizePhone(raw) {
  if (!raw) return '';
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
  
  // Format: "Lastname, Firstname"
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
  
  // Format: "Firstname Lastname"
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

console.log('Fetching all leads from Neon database...');
const leads = await sql`
  SELECT l.id, l.campaign_id, c.name as campaign_name, l.full_name, l.phone_number, l.status, l.metadata, l.call_attempts, l.created_at
  FROM leads l
  JOIN campaigns c ON c.id = l.campaign_id
  ORDER BY l.created_at ASC
`;

console.log(`Fetched ${leads.length} rows.`);

// Group by normalized phone
const phoneGroups = new Map();
const invalidRows = [];

for (const l of leads) {
  const normPhone = normalizePhone(l.phone_number);
  if (!normPhone) {
    invalidRows.push(l);
    continue;
  }
  if (!phoneGroups.has(normPhone)) {
    phoneGroups.set(normPhone, []);
  }
  phoneGroups.get(normPhone).push(l);
}

// Generate deduplicated list: choose the "best" record for each phone
const deduplicated = [];
const duplicatesPruned = [];

for (const [phone, group] of phoneGroups.entries()) {
  // Sort priority:
  // 1. Status: completed > called > no_answer > unreached > pending
  // 2. Has email
  // 3. Has notes
  const statusRank = { completed: 5, called: 4, no_answer: 3, unreached: 2, callback_requested: 2, pending: 1 };
  
  group.sort((a, b) => {
    const rankA = statusRank[a.status] || 0;
    const rankB = statusRank[b.status] || 0;
    if (rankB !== rankA) return rankB - rankA;
    const emailA = a.metadata?.email ? 1 : 0;
    const emailB = b.metadata?.email ? 1 : 0;
    return emailB - emailA;
  });

  const best = group[0];
  const { firstName, lastName, displayName } = parseName(best.full_name);
  
  deduplicated.push({
    id: best.id,
    contactId: best.metadata?.id || '',
    firstName,
    lastName,
    fullName: displayName,
    cleanPhone: phone,
    rawPhone: best.phone_number,
    email: best.metadata?.email || '',
    campaign: best.campaign_name,
    status: best.status,
    duplicateCount: group.length,
    callAttempts: best.call_attempts || 0,
    notes: best.metadata?.notes || best.metadata?.comment || ''
  });

  if (group.length > 1) {
    for (let i = 1; i < group.length; i++) {
      duplicatesPruned.push(group[i]);
    }
  }
}

// Export to CSV in project directory
function toCsvRow(arr) {
  return arr.map(v => {
    const s = String(v ?? '').replace(/"/g, '""');
    return `"${s}"`;
  }).join(',');
}

const headers = ['Contact ID', 'First Name', 'Last Name', 'Full Name', 'Clean Phone (E.164)', 'Raw Phone', 'Email', 'Campaign', 'Status', 'Duplicate Count', 'Notes'];
const rows = [headers.join(',')];

for (const d of deduplicated) {
  rows.push(toCsvRow([
    d.contactId,
    d.firstName,
    d.lastName,
    d.fullName,
    d.cleanPhone,
    d.rawPhone,
    d.email,
    d.campaign,
    d.status,
    d.duplicateCount,
    d.notes
  ]));
}

const outputPath = path.join(process.cwd(), 'harvesters_cleaned_contacts.csv');
fs.writeFileSync(outputPath, rows.join('\n'), 'utf-8');

console.log(`\n✅ Generated cleaned export: ${outputPath}`);
console.log(`- Unique valid records: ${deduplicated.length}`);
console.log(`- Duplicates identified & filtered: ${duplicatesPruned.length}`);
console.log(`- Corrupt/invalid phone numbers filtered: ${invalidRows.length}`);
console.log(`- File size: ${(fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2)} MB`);
