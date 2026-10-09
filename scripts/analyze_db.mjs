import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const envText = fs.readFileSync('.env.production.local', 'utf-8');
const match = envText.match(/DATABASE_URL=\"([^\"]+)\"/);
const dbUrl = match[1];
const sql = neon(dbUrl);

console.log('=== 1. CAMPAIGN BREAKDOWN ===');
const campaigns = await sql`
  SELECT c.id, c.name, count(l.id) as total_leads,
         count(CASE WHEN l.status = 'pending' THEN 1 END) as pending_leads,
         count(CASE WHEN l.status IN ('completed', 'called') THEN 1 END) as called_leads
  FROM campaigns c
  LEFT JOIN leads l ON l.campaign_id = c.id
  GROUP BY c.id, c.name
  ORDER BY total_leads DESC
`;
console.table(campaigns);

console.log('\n=== 2. DUPLICATE PHONE NUMBERS (OVERALL) ===');
const dupePhones = await sql`
  SELECT phone_number, count(*) as count, array_agg(DISTINCT campaign_id) as campaigns, array_agg(DISTINCT status) as statuses
  FROM leads
  GROUP BY phone_number
  HAVING count(*) > 1
  ORDER BY count DESC
  LIMIT 20
`;
console.log(`Top duplicate phone numbers (sample):`);
console.table(dupePhones);

const totalDupeStats = await sql`
  SELECT 
    count(DISTINCT phone_number) as unique_phones,
    count(*) as total_rows,
    count(*) - count(DISTINCT phone_number) as excess_duplicate_rows
  FROM leads
`;
console.log('Total Duplicate Summary (Exact Phone match across all campaigns):');
console.table(totalDupeStats);

console.log('\n=== 3. DUPLICATE PHONE NUMBERS PER CAMPAIGN ===');
const dupesPerCampaign = await sql`
  SELECT c.name as campaign_name,
         count(*) as total_rows,
         count(DISTINCT l.phone_number) as unique_phones,
         count(*) - count(DISTINCT l.phone_number) as duplicate_rows
  FROM leads l
  JOIN campaigns c ON c.id = l.campaign_id
  GROUP BY c.id, c.name
`;
console.table(dupesPerCampaign);

console.log('\n=== 4. STATUSES OF DUPLICATE ROWS ===');
const dupeStatusBreakdown = await sql`
  WITH dupes AS (
    SELECT phone_number
    FROM leads
    GROUP BY phone_number
    HAVING count(*) > 1
  )
  SELECT l.status, count(*) as row_count
  FROM leads l
  JOIN dupes d ON d.phone_number = l.phone_number
  GROUP BY l.status
`;
console.table(dupeStatusBreakdown);

console.log('\n=== 5. PHONE NUMBER FORMATTING ISSUES ===');
const phoneFormatAudit = await sql`
  SELECT 
    count(CASE WHEN phone_number NOT LIKE '+%' THEN 1 END) as missing_plus,
    count(CASE WHEN length(phone_number) < 10 THEN 1 END) as too_short,
    count(CASE WHEN length(phone_number) > 15 THEN 1 END) as too_long,
    count(CASE WHEN phone_number ~ '[^0-9+]' THEN 1 END) as non_digits,
    count(*) as total
  FROM leads
`;
console.table(phoneFormatAudit);

