-- ACE AI Tennis Coach — Supabase Schema
-- Run this in the Supabase SQL Editor after creating the project.

-- ============================================================
-- 1. profiles — 1:1 with auth.users
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  skill_level text not null default 'intermediate',
  total_sessions integer not null default 0,
  total_strokes integer not null default 0,
  total_practice_time_ms bigint not null default 0,
  strongest_stroke text,
  weaknesses jsonb not null default '[]'::jsonb,
  strengths jsonb not null default '[]'::jsonb,
  stroke_proficiency jsonb not null default '{}'::jsonb,
  recent_sessions jsonb not null default '[]'::jsonb,
  skill_progress jsonb not null default '[]'::jsonb,
  current_goal text,
  coaching_preferences jsonb not null default '{}'::jsonb,
  fatigue_patterns jsonb not null default '{}'::jsonb,
  milestones jsonb not null default '[]'::jsonb,
  -- Onboarding & subscription fields
  sport text not null default 'tennis',
  ntrp_level text,
  improvement_goals jsonb not null default '[]'::jsonb,
  custom_goal_text text,
  coach_preference text not null default 'alex',
  display_name text,
  age integer,
  subscription_tier text not null default 'free',
  trial_start_date timestamptz,
  trial_used boolean not null default false,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ============================================================
-- 2. sessions — completed practice sessions
-- ============================================================
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  start_time timestamptz not null default now(),
  end_time timestamptz,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_sessions_user_id on public.sessions (user_id);
create index idx_sessions_start_time on public.sessions (start_time desc);

alter table public.sessions enable row level security;

create policy "Users can read own sessions"
  on public.sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert own sessions"
  on public.sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own sessions"
  on public.sessions for update
  using (auth.uid() = user_id);

-- ============================================================
-- 3. strokes — individual stroke records (batch-written)
-- ============================================================
create table public.strokes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  timestamp timestamptz not null default now(),
  stroke_type text not null,
  quality real,
  quality_breakdown jsonb,
  technique jsonb,
  physics jsonb,
  pro_comparison jsonb,
  biomechanical jsonb,
  rally_context jsonb,
  created_at timestamptz not null default now()
);

create index idx_strokes_session_id on public.strokes (session_id);
create index idx_strokes_user_id on public.strokes (user_id);

alter table public.strokes enable row level security;

create policy "Users can read own strokes"
  on public.strokes for select
  using (auth.uid() = user_id);

create policy "Users can insert own strokes"
  on public.strokes for insert
  with check (auth.uid() = user_id);

-- ============================================================
-- 4. improvement_tracker — cross-session metrics (1 row/user)
-- ============================================================
create table public.improvement_tracker (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles on delete cascade,
  stroke_metrics jsonb not null default '{}'::jsonb,
  fault_history jsonb not null default '{}'::jsonb,
  coaching_plan jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.improvement_tracker enable row level security;

create policy "Users can read own tracker"
  on public.improvement_tracker for select
  using (auth.uid() = user_id);

create policy "Users can insert own tracker"
  on public.improvement_tracker for insert
  with check (auth.uid() = user_id);

create policy "Users can update own tracker"
  on public.improvement_tracker for update
  using (auth.uid() = user_id);

-- ============================================================
-- 5. coach_notebook — GPT session observations
-- ============================================================
create table public.coach_notebook (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  date text not null,
  coach_notes text,
  summary jsonb,
  created_at timestamptz not null default now()
);

create index idx_notebook_user_id on public.coach_notebook (user_id);
create index idx_notebook_date on public.coach_notebook (date desc);

alter table public.coach_notebook enable row level security;

create policy "Users can read own notebook"
  on public.coach_notebook for select
  using (auth.uid() = user_id);

create policy "Users can insert own notebook"
  on public.coach_notebook for insert
  with check (auth.uid() = user_id);

-- ============================================================
-- 6. curriculum — 4-week training plans
-- ============================================================
create table public.curriculum (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  start_date text not null,
  skill_level text not null default 'intermediate',
  weeks jsonb not null default '[]'::jsonb,
  primary_focus text,
  sessions_completed integer not null default 0,
  last_session_date text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_curriculum_user_active on public.curriculum (user_id, is_active)
  where is_active = true;

alter table public.curriculum enable row level security;

create policy "Users can read own curriculum"
  on public.curriculum for select
  using (auth.uid() = user_id);

create policy "Users can insert own curriculum"
  on public.curriculum for insert
  with check (auth.uid() = user_id);

create policy "Users can update own curriculum"
  on public.curriculum for update
  using (auth.uid() = user_id);

-- ============================================================
-- Triggers
-- ============================================================

-- Auto-create profile on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auto-update updated_at timestamp
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

create trigger set_updated_at
  before update on public.improvement_tracker
  for each row execute function public.handle_updated_at();

create trigger set_updated_at
  before update on public.curriculum
  for each row execute function public.handle_updated_at();

-- ============================================================
-- 7. Onboarding & subscription columns on profiles
-- ============================================================
-- Migration: run this if the profiles table was created before these columns existed.
-- Safe to run multiple times (IF NOT EXISTS).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sport text NOT NULL DEFAULT 'tennis',
  ADD COLUMN IF NOT EXISTS ntrp_level text,
  ADD COLUMN IF NOT EXISTS improvement_goals jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS custom_goal_text text,
  ADD COLUMN IF NOT EXISTS coach_preference text NOT NULL DEFAULT 'alex',
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS age integer,
  ADD COLUMN IF NOT EXISTS subscription_tier text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS trial_start_date timestamptz,
  ADD COLUMN IF NOT EXISTS trial_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- ============================================================
-- 8. guest_trials — IP-based rate limiting for trial sessions
-- ============================================================
create table if not exists public.guest_trials (
  id uuid primary key default gen_random_uuid(),
  ip_address text not null,
  created_at timestamptz not null default now(),
  stroke_count integer not null default 0
);

create index if not exists idx_guest_trials_ip
  on public.guest_trials (ip_address, created_at desc);

-- ============================================================
-- 9. structured_session_memory — Rich per-session coaching memory
-- ============================================================
create table if not exists public.structured_session_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  session_id uuid references public.sessions on delete set null,
  session_date timestamptz not null default now(),
  session_number integer not null default 1,
  stroke_summaries jsonb not null default '{}'::jsonb,
  coaching_moments jsonb not null default '[]'::jsonb,
  observations jsonb not null default '{}'::jsonb,
  visual_summary jsonb,
  coach_notes_freetext text,
  created_at timestamptz not null default now()
);

create index if not exists idx_structured_memory_user
  on public.structured_session_memory (user_id, session_date desc);

alter table public.structured_session_memory enable row level security;

create policy "Users can read own structured memory"
  on public.structured_session_memory for select
  using (auth.uid() = user_id);

create policy "Users can insert own structured memory"
  on public.structured_session_memory for insert
  with check (auth.uid() = user_id);

-- ============================================================
-- 10. coaching_effectiveness — Track which coaching cues work
-- ============================================================
create table if not exists public.coaching_effectiveness (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  session_id uuid references public.sessions on delete set null,
  coaching_cue text not null,
  issue_id text not null,
  stroke_type text not null,
  pre_metrics jsonb not null default '{}'::jsonb,
  post_metrics jsonb not null default '{}'::jsonb,
  quality_delta real,
  target_metric_delta real,
  effective boolean,
  strokes_between integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_coaching_effectiveness_user
  on public.coaching_effectiveness (user_id, issue_id);

alter table public.coaching_effectiveness enable row level security;

create policy "Users can read own coaching effectiveness"
  on public.coaching_effectiveness for select
  using (auth.uid() = user_id);

create policy "Users can insert own coaching effectiveness"
  on public.coaching_effectiveness for insert
  with check (auth.uid() = user_id);

-- ============================================================
-- 11. anonymous_telemetry — Anonymized per-session metrics
-- ============================================================
-- No RLS: inserted by submit-telemetry Edge Function using service role.
-- No user_id stored — fully anonymized.
create table if not exists public.anonymous_telemetry (
  id uuid primary key default gen_random_uuid(),
  skill_level text not null default 'intermediate',
  ntrp_level text,
  session_number integer,
  stroke_type text not null,
  stroke_count integer not null default 0,
  avg_quality real,
  avg_form_score real,
  metrics jsonb not null default '{}'::jsonb,
  fault_frequencies jsonb not null default '{}'::jsonb,
  session_duration_minutes real,
  telemetry_version integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists idx_telemetry_skill_stroke
  on public.anonymous_telemetry (skill_level, stroke_type);

-- ============================================================
-- 12. micro_confirmations — Player feedback on coaching & classification
-- ============================================================
create table if not exists public.micro_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  session_id uuid references public.sessions on delete set null,
  confirmation_type text not null, -- coaching_quality | stroke_classification | fault_accuracy
  coaching_issue_id text,
  player_rating integer, -- 1 (thumbs down) or 5 (thumbs up)
  detected_stroke_type text,
  confirmed_stroke_type text, -- null if correct, actual type if wrong
  fault_id text,
  was_real boolean,
  created_at timestamptz not null default now()
);

create index if not exists idx_micro_confirmations_user
  on public.micro_confirmations (user_id, confirmation_type);

alter table public.micro_confirmations enable row level security;

create policy "Users can read own confirmations"
  on public.micro_confirmations for select
  using (auth.uid() = user_id);

create policy "Users can insert own confirmations"
  on public.micro_confirmations for insert
  with check (auth.uid() = user_id);

-- ============================================================
-- 13. adaptive_thresholds column on improvement_tracker
-- ============================================================
ALTER TABLE public.improvement_tracker
  ADD COLUMN IF NOT EXISTS adaptive_thresholds jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================
-- 14. Subscription security: prevent client-side tier escalation
-- ============================================================
-- Check constraint: subscription_tier can only be one of the known values
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_subscription_tier_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_subscription_tier_check
  CHECK (subscription_tier IN ('free', 'trial', 'pro'));

-- Trigger: prevent users from setting subscription_tier to 'pro' directly.
-- Only 'free' and 'trial' transitions are allowed via client RLS.
-- 'pro' must be set by a service role (e.g., payment webhook).
CREATE OR REPLACE FUNCTION public.protect_subscription_columns()
RETURNS TRIGGER AS $$
BEGIN
  -- If subscription_tier is being changed to 'pro', only allow service role
  IF NEW.subscription_tier = 'pro' AND OLD.subscription_tier != 'pro' THEN
    -- Check if this is NOT a service role call (service role bypasses RLS entirely)
    -- In RLS context, auth.uid() is set. Service role calls don't trigger RLS.
    -- Since this trigger fires regardless, we check auth.role()
    IF current_setting('request.jwt.claim.role', true) != 'service_role' THEN
      RAISE EXCEPTION 'Cannot set subscription_tier to pro via client. Use payment flow.';
    END IF;
  END IF;

  -- Prevent backdating trial_start_date (must be within last minute if being set)
  IF NEW.trial_start_date IS DISTINCT FROM OLD.trial_start_date
     AND NEW.trial_start_date IS NOT NULL THEN
    IF NEW.trial_start_date < (now() - interval '1 minute') THEN
      RAISE EXCEPTION 'Cannot backdate trial_start_date';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_subscription ON public.profiles;
CREATE TRIGGER protect_subscription
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_subscription_columns();
