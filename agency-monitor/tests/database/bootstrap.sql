-- CI-only emulation of minimum Supabase auth and Storage catalogue.
-- Run ONLY in a disposable PostgreSQL 17 test container. Never in NJSS.
\set ON_ERROR_STOP on
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (
 id uuid primary key,
 email text,
 email_confirmed_at timestamptz
);
create function auth.uid() returns uuid
 language sql stable set search_path='' as $$
 select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
 $$;
create schema storage;
create table storage.buckets (
 id text primary key,
 name text not null,
 public boolean not null default false,
 file_size_limit bigint,
 allowed_mime_types text[]
);
