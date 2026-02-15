ALTER TABLE public.improvement_tracker
  ADD COLUMN IF NOT EXISTS drill_history jsonb NOT NULL DEFAULT '{}'::jsonb;
