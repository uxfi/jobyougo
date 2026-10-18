-- JobYouGo — complete profile columns (2026-10-13).
-- Run in the Supabase SQL editor. Idempotent: safe to run again, and it also
-- covers 20261007_profile_onboarding.sql, so a deployment that never ran that
-- one only needs this file.
--
-- Without these columns the server saves the legacy columns only and logs which
-- section it left out: phone, links, languages, education, availability, the
-- output language / spend tier and every screening answer are lost on save.

alter table public.profiles
  add column if not exists candidate               jsonb,
  add column if not exists availability            jsonb,
  add column if not exists preferences             jsonb,
  add column if not exists screening               jsonb,
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.profiles.candidate is
  'Candidate block: names, phone, links, nationalities, languages [{name, level, cefr}], education [], skills [], years_experience, people_management, apply_cv… full_name/email/location/linkedin stay mirrored in their own columns.';
comment on column public.profiles.availability is
  'notice_period, notice_period_days, start_date, current_employment, desired_engagement, days_per_week, hours_per_week — fed to apply form answers and the CV availability tags.';
comment on column public.profiles.preferences is
  'language.output, spend_tier, cv.*, writing_voice, outreach_rules — the top-level keys of config/profile.yml.';
comment on column public.profiles.screening is
  'Answers application forms ask beyond the CV: how_did_you_hear, referred_by, references, background_check_ok, non_compete, security_clearance, driving_licence, previously_applied, consents, eeo (decline by default) and custom question/answer pairs.';
comment on column public.profiles.onboarding_completed_at is
  'Set when the guided onboarding was finished at least once.';

-- location_prefs (legacy jsonb) now also carries bases[] (city, country, IANA
-- timezone, phone, regions, default, status), nationality, onsite_exceptions[],
-- relocation and travel: no column change needed.

-- Ask PostgREST to reload its schema cache so the new columns are usable now.
notify pgrst, 'reload schema';
