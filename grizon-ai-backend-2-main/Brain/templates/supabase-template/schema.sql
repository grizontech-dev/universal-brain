-- Grizon Supabase starter schema
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz default now()
);
