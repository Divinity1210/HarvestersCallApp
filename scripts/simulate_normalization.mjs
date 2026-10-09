import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const envText = fs.readFileSync('.env.production.local', 'utf-8');
const match = envText.match(/DATABASE_URL=\"([^\"]+)\"/);
const sql = neon(match[1]);

function normalizePhone(raw) {
  if (!raw) return '';
  let str = String(raw).trim();
  // Strip formula prefixes: ='+, ="+, =, ', "
  str = str.replace(/^[=\'"\s]+/, '').replace(/[\'"\s]+$/, '');
  if (str.startsWith('+')) str = str.slice(1);
  // Remove non-digit characters
  let digits = str.replace(/[^0-9]/g, '');
  
  if (!digits || digits.length < 7) {
    return 'INVALID: ' + raw;
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

const leads = await sql`
  SELECT id, campaign_id, full_name, phone_number, status, metadata
  FROM leads
`;

console.log(`Fetched ${leads.length} total leads.`);

const phoneMap = new Map();
let invalidCount = 0;
const invalidList = [];

for (const l of leads) {
  const norm = normalizePhone(l.phone_number);
  if (norm.startsWith('INVALID')) {
    invalidCount++;
    invalidList.push({ id: l.id, name: l.full_name, raw: l.phone_number });
    continue;
  }
  if (!phoneMap.has(norm)) {
    phoneMap.set(norm, []);
  }
  phoneMap.get(norm).push(l);
}

console.log(`Total valid unique normalized phone numbers: ${phoneMap.size}`);
console.log(`Invalid phone numbers: ${invalidCount}`);

let duplicateGroups = 0;
let totalDuplicateRows = 0;
const intraCampaignDupes = [];

for (const [phone, rows] of phoneMap.entries()) {
  if (rows.length > 1) {
    duplicateGroups++;
    totalDuplicateRows += rows.length;
    // Check if within same campaign
    const campCounts = {};
    for (const r of rows) {
      campCounts[r.campaign_id] = (campCounts[r.campaign_id] || 0) + 1;
    }
    for (const [campId, c] of Object.entries(campCounts)) {
      if (c > 1) {
        intraCampaignDupes.push({ phone, campaignId: campId, count: c, names: rows.filter(r => r.campaign_id === campId).map(r => r.full_name) });
      }
    }
  }
}

console.log(`Duplicate phone groups: ${duplicateGroups}`);
console.log(`Total rows in duplicate groups: ${totalDuplicateRows}`);
console.log(`Excess rows that can be pruned: ${totalDuplicateRows - duplicateGroups}`);
console.log(`Intra-campaign duplicates revealed by normalization: ${intraCampaignDupes.length}`);
if (intraCampaignDupes.length > 0) {
  console.log('Sample intra-campaign duplicates:');
  console.log(intraCampaignDupes.slice(0, 5));
}

console.log('\nSample invalid numbers:');
console.log(invalidList.slice(0, 10));
