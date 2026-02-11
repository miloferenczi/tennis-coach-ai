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
