-- Career-Ops Supabase Schema — Migration Auth
-- Exécuter dans Supabase SQL Editor (idempotent, safe à relancer)
-- Project: https://xwirvvbfaoqeroayyzpf.supabase.co

-- ── 1. Trigger helper ─────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── 2. Table profiles (nouvelle — liée à auth.users) ─────────────────────────
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text,
  email          text,
  location       text,
  linkedin       text,
  target_roles   jsonb,
  narrative      jsonb,
  compensation   jsonb,
  search_prefs   jsonb,
  location_prefs jsonb,
  cv_markdown    text,
  profile_context text,
  is_admin       boolean default false,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure set_updated_at();

-- ── 3. Trigger auto-création profil au signup ─────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── 4. Ajout colonne user_id sur tables existantes (safe si déjà présente) ────

-- applications
alter table applications
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

drop trigger if exists applications_updated_at on applications;
create or replace trigger applications_updated_at
  before update on applications
  for each row execute procedure set_updated_at();

-- pipeline : supprimer l'ancienne contrainte unique(url) si elle existe,
--            puis ajouter unique(url, user_id)
alter table pipeline
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

do $$
begin
  -- Supprimer l'ancienne contrainte unique sur url seul si elle existe encore
  if exists (
    select 1 from pg_constraint
    where conname = 'pipeline_url_key' and conrelid = 'pipeline'::regclass
  ) then
    alter table pipeline drop constraint pipeline_url_key;
  end if;

  -- Ajouter unique(url, user_id) si elle n'existe pas
  if not exists (
    select 1 from pg_constraint
    where conname = 'pipeline_url_user_id_key' and conrelid = 'pipeline'::regclass
  ) then
    alter table pipeline add constraint pipeline_url_user_id_key unique (url, user_id);
  end if;
end;
$$;

-- reports
alter table reports
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

drop trigger if exists reports_updated_at on reports;
create or replace trigger reports_updated_at
  before update on reports
  for each row execute procedure set_updated_at();

-- ── 4b. Colonnes supplémentaires sur profiles ────────────────────────────────
alter table public.profiles
  add column if not exists cv_markdown     text,
  add column if not exists profile_context text,
  add column if not exists location_prefs  jsonb;

-- ── 5. Activation RLS ────────────────────────────────────────────────────────
alter table public.profiles  enable row level security;
alter table applications      enable row level security;
alter table pipeline          enable row level security;
alter table reports           enable row level security;

-- ── 6. Politiques RLS (drop + recreate pour idempotence) ─────────────────────

-- profiles
drop policy if exists "profiles_own" on public.profiles;
create policy "profiles_own" on public.profiles
  for all using (auth.uid() = id);

-- applications
drop policy if exists "applications_own" on applications;
create policy "applications_own" on applications
  for all using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- pipeline
drop policy if exists "pipeline_own" on pipeline;
create policy "pipeline_own" on pipeline
  for all using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- reports
drop policy if exists "reports_own" on reports;
create policy "reports_own" on reports
  for all using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );
