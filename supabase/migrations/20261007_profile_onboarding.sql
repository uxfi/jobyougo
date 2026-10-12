-- JobYouGo — profile columns for the guided onboarding (2026-10-07).
-- Run in the Supabase SQL editor. Idempotent: safe to run again.
--
-- Before this migration the dashboard and the onboarding dropped phone,
-- portfolio, GitHub, years of experience, languages, availability and
-- preferences on save because the profiles table had no column for them.
-- ui/server.mjs keeps working without these columns (it falls back to the
-- legacy columns and logs a warning), but every account then loses those
-- fields on each save.

alter table public.profiles
  add column if not exists candidate               jsonb,
  add column if not exists availability            jsonb,
  add column if not exists preferences             jsonb,
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.profiles.candidate is
  'Full candidate block (phone, portfolio_url, github, twitter, years_experience, languages, photo…). full_name/email/location/linkedin stay mirrored in their own columns.';
comment on column public.profiles.availability is
  'notice_period, start_date, current_employment, desired_engagement — fed to apply form answers and the CV availability tags.';
comment on column public.profiles.preferences is
  'language.output, spend_tier, cv.* — the top-level keys of config/profile.yml.';
comment on column public.profiles.onboarding_completed_at is
  'Set when the guided onboarding was finished at least once.';

-- Ask PostgREST to reload its schema cache so the new columns are usable now.
notify pgrst, 'reload schema';
