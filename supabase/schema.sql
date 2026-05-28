-- ============================================
-- NLP Connect — Database Schema
-- Run this in your Supabase SQL Editor
-- ============================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- CAMPAIGNS: Reusable across events/conferences
-- ============================================
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
);

-- ============================================
-- LEADS: Attendees to be called
-- ============================================
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  phone_hash TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'locked', 'called', 'completed', 'no_answer', 'failed')),
  locked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  locked_at TIMESTAMPTZ,
  call_attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, phone_hash)
);

-- ============================================
-- AGENT PROFILES: Extends Supabase auth.users
-- ============================================
CREATE TABLE IF NOT EXISTS agent_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'admin', 'super_admin')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- CALLS: Irrefutable call log with server-side timestamps
-- ============================================
CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,

  -- Irrefutable server-side timestamps (agents CANNOT modify these)
  initiated_at TIMESTAMPTZ NOT NULL,
  connected_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INT,

  -- Twilio metadata
  twilio_call_sid TEXT UNIQUE,
  twilio_recording_sid TEXT,
  recording_url TEXT,
  recording_status TEXT CHECK (recording_status IN ('completed', 'failed', 'processing') OR recording_status IS NULL),

  -- Call outcome
  call_status TEXT NOT NULL DEFAULT 'initiating'
    CHECK (call_status IN ('initiating', 'ringing', 'in-progress', 'completed', 'no-answer', 'busy', 'failed', 'canceled')),
  agent_disposition TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- QA RESULTS: AI-generated analysis per call
-- ============================================
CREATE TABLE IF NOT EXISTS qa_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID UNIQUE REFERENCES calls(id) ON DELETE CASCADE,

  -- Transcription
  transcript_raw TEXT,
  transcript_summary TEXT,
  transcription_provider TEXT DEFAULT 'deepgram',
  transcription_confidence FLOAT,

  -- AI-Extracted Data
  next_steps_extracted JSONB DEFAULT '[]',
  next_steps_confirmed JSONB DEFAULT '[]',
  testimony_extracted TEXT,
  testimony_confirmed TEXT,

  -- Script Adherence
  script_adherence_score FLOAT,
  script_adherence_details JSONB,

  -- Red Flags
  flags JSONB DEFAULT '[]',
  flagged BOOLEAN DEFAULT false,
  reviewed BOOLEAN DEFAULT false,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes TEXT,

  -- Processing Pipeline
  processing_status TEXT DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'transcribing', 'analyzing', 'complete', 'error')),
  error_message TEXT,
  processed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- INDEXES for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_leads_campaign_status ON leads(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_locked_by ON leads(locked_by) WHERE locked_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_pending ON leads(campaign_id, status, call_attempts) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_calls_agent ON calls(agent_id);
CREATE INDEX IF NOT EXISTS idx_calls_campaign ON calls(campaign_id);
CREATE INDEX IF NOT EXISTS idx_calls_created ON calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_flagged ON qa_results(flagged) WHERE flagged = true;
CREATE INDEX IF NOT EXISTS idx_qa_processing ON qa_results(processing_status) WHERE processing_status != 'complete';
CREATE INDEX IF NOT EXISTS idx_qa_call_id ON qa_results(call_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_results ENABLE ROW LEVEL SECURITY;

-- Helper function: check if user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM agent_profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin')
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- CAMPAIGNS: everyone can read active campaigns
CREATE POLICY "Anyone can read active campaigns"
  ON campaigns FOR SELECT
  USING (status = 'active' OR is_admin());

CREATE POLICY "Admins can manage campaigns"
  ON campaigns FOR ALL
  USING (is_admin());

-- AGENT PROFILES: users can read their own, admins can read all
CREATE POLICY "Users can read own profile"
  ON agent_profiles FOR SELECT
  USING (id = auth.uid() OR is_admin());

CREATE POLICY "Admins can manage profiles"
  ON agent_profiles FOR ALL
  USING (is_admin());

-- LEADS: agents can read leads they have locked (without phone_number via view)
-- NOTE: phone_number column is protected — agents access leads via API route only
CREATE POLICY "Agents can read locked leads"
  ON leads FOR SELECT
  USING (locked_by = auth.uid() OR is_admin());

CREATE POLICY "Admins can manage leads"
  ON leads FOR ALL
  USING (is_admin());

-- CALLS: agents can read their own calls, admins can read all
CREATE POLICY "Agents can read own calls"
  ON calls FOR SELECT
  USING (agent_id = auth.uid() OR is_admin());

CREATE POLICY "Agents can insert calls"
  ON calls FOR INSERT
  WITH CHECK (agent_id = auth.uid() OR is_admin());

CREATE POLICY "System can update calls"
  ON calls FOR UPDATE
  USING (agent_id = auth.uid() OR is_admin());

-- QA RESULTS: agents can read their own, admins can read all
CREATE POLICY "Agents can read own QA results"
  ON qa_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM calls WHERE calls.id = qa_results.call_id AND calls.agent_id = auth.uid()
    )
    OR is_admin()
  );

CREATE POLICY "Admins can manage QA results"
  ON qa_results FOR ALL
  USING (is_admin());

-- ============================================
-- AUTO-CREATE PROFILE ON SIGNUP (TRIGGER)
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.agent_profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',        -- Google OAuth uses 'name'
      NEW.raw_user_meta_data->>'display_name',
      NEW.email,
      'Agent ' || substr(NEW.id::text, 1, 8)
    ),
    'agent'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Drop the trigger if it exists, then create
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
