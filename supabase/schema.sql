-- Career-Ops Supabase Schema
-- Run this in the Supabase SQL Editor to initialize the database.
-- Project: https://xwirvvbfaoqeroayyzpf.supabase.co

-- ── Applications ──────────────────────────────────────────────────────────────
create table if not exists applications (
  num          integer primary key,
  date         date        not null,
  company      text        not null,
  role         text        not null,
  score        text,                   -- e.g. "4.2/5"
  status       text,                   -- canonical state from templates/states.yml
  pdf          text,                   -- "✅" or "❌"
  report       text,                   -- markdown link string
  notes        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- Auto-update updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger applications_updated_at
  before update on applications
  for each row execute procedure set_updated_at();

-- ── Pipeline ──────────────────────────────────────────────────────────────────
create table if not exists pipeline (
  id         bigserial primary key,
  url        text unique not null,
  note       text,
  processed  boolean default false,
  created_at timestamptz default now()
);

-- ── Reports ───────────────────────────────────────────────────────────────────
create table if not exists reports (
  filename   text primary key,         -- e.g. "001-company-2026-04-07.md"
  content    text,                      -- full markdown content
  num        integer,
  company    text,
  date       date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace trigger reports_updated_at
  before update on reports
  for each row execute procedure set_updated_at();

-- ── RLS (Row Level Security) — disable for service role usage ────────────────
-- These tables are accessed server-side via service role key, so RLS is off.
alter table applications disable row level security;
alter table pipeline     disable row level security;
alter table reports      disable row level security;
