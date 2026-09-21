import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const connectionString = 
  process.env.DATABASE_URL || 
  process.env.POSTGRES_URL || 
  process.env.POSTGRES_PRISMA_URL;

if (!connectionString) {
  console.error('❌ Error: DATABASE_URL or POSTGRES_URL environment variable is missing.');
  process.exit(1);
}

const sql = neon(connectionString);

async function runMigration() {
  console.log('🚀 Connecting to Neon PostgreSQL and running schema migration...');

  // 1. Extensions
  await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`;

  // 2. Users Table (Replaces Supabase auth.users & agent_profiles)
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'admin', 'super_admin')),
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // 3. Campaigns Table
  await sql`
    CREATE TABLE IF NOT EXISTS campaigns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      script_template TEXT NOT NULL,
      next_steps_options JSONB NOT NULL DEFAULT '[]',
      consent_message TEXT DEFAULT 'This call may be recorded for quality purposes.',
      consent_mode TEXT NOT NULL DEFAULT 'script' CHECK (consent_mode IN ('whisper', 'script', 'none')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
      retention_days INT DEFAULT 30,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // 4. Leads Table
  await sql`
    CREATE TABLE IF NOT EXISTS leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      phone_hash TEXT NOT NULL,
      metadata JSONB DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'locked', 'called', 'completed', 'no_answer', 'failed')),
      locked_by UUID REFERENCES users(id) ON DELETE SET NULL,
      locked_at TIMESTAMPTZ,
      call_attempts INT DEFAULT 0,
      max_attempts INT DEFAULT 3,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(campaign_id, phone_hash)
    )
  `;

  // 5. Calls Table
  await sql`
    CREATE TABLE IF NOT EXISTS calls (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
      agent_id UUID REFERENCES users(id) ON DELETE SET NULL,
      campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
      initiated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      connected_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      duration_seconds INT,
      twilio_call_sid TEXT UNIQUE,
      twilio_recording_sid TEXT,
      recording_url TEXT,
      recording_status TEXT CHECK (recording_status IN ('completed', 'failed', 'processing') OR recording_status IS NULL),
      call_status TEXT NOT NULL DEFAULT 'initiating'
        CHECK (call_status IN ('initiating', 'ringing', 'in-progress', 'completed', 'no-answer', 'busy', 'failed', 'canceled')),
      agent_disposition TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // 6. QA Results Table
  await sql`
    CREATE TABLE IF NOT EXISTS qa_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      call_id UUID UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
      transcript_raw TEXT,
      transcript_summary TEXT,
      transcription_provider TEXT DEFAULT 'deepgram',
      transcription_confidence FLOAT,
      next_steps_extracted JSONB DEFAULT '[]',
      next_steps_confirmed JSONB DEFAULT '[]',
      testimony_extracted TEXT,
      testimony_confirmed TEXT,
      script_adherence_score FLOAT,
      script_adherence_details JSONB,
      flags JSONB DEFAULT '[]',
      flagged BOOLEAN DEFAULT false,
      reviewed BOOLEAN DEFAULT false,
      reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
      review_notes TEXT,
      processing_status TEXT DEFAULT 'pending'
        CHECK (processing_status IN ('pending', 'transcribing', 'analyzing', 'complete', 'error')),
      error_message TEXT,
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // 7. Indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_leads_campaign_status ON leads(campaign_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_leads_locked_by ON leads(locked_by) WHERE locked_by IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_leads_pending ON leads(campaign_id, status, call_attempts) WHERE status = 'pending'`;
  await sql`CREATE INDEX IF NOT EXISTS idx_calls_agent ON calls(agent_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_calls_campaign ON calls(campaign_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_calls_created ON calls(created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_qa_flagged ON qa_results(flagged) WHERE flagged = true`;
  await sql`CREATE INDEX IF NOT EXISTS idx_qa_processing ON qa_results(processing_status) WHERE processing_status != 'complete'`;
  await sql`CREATE INDEX IF NOT EXISTS idx_qa_call_id ON qa_results(call_id)`;

  // 8. Seed Default Admin
  const adminEmail = 'admin@harvesters.org';
  const existingAdmin = await sql`SELECT id FROM users WHERE LOWER(email) = ${adminEmail.toLowerCase()}`;
  
  if (existingAdmin.length === 0) {
    const defaultPassword = 'AdminPass2026!';
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(defaultPassword, salt);

    await sql`
      INSERT INTO users (email, password_hash, full_name, role, is_active)
      VALUES (${adminEmail.toLowerCase()}, ${hash}, 'Harvesters Administrator', 'super_admin', true)
    `;
    console.log(`✅ Default admin created: ${adminEmail} (Password: ${defaultPassword})`);
  } else {
    console.log(`ℹ️ Admin user ${adminEmail} already exists.`);
  }

  // Also seed default volunteer agent for testing
  const volunteerEmail = 'volunteer@harvesters.org';
  const existingVolunteer = await sql`SELECT id FROM users WHERE LOWER(email) = ${volunteerEmail.toLowerCase()}`;
  if (existingVolunteer.length === 0) {
    const defaultPassword = 'Volunteer2026!';
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(defaultPassword, salt);

    await sql`
      INSERT INTO users (email, password_hash, full_name, role, is_active)
      VALUES (${volunteerEmail.toLowerCase()}, ${hash}, 'Demo Volunteer', 'agent', true)
    `;
    console.log(`✅ Default volunteer created: ${volunteerEmail} (Password: ${defaultPassword})`);
  }

  console.log('🎉 Migration completed successfully!');
}

runMigration().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
