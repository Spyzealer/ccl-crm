-- ============================================================
-- CCL CRM — Supabase Schema (Staging)
-- ============================================================
-- Run this once in Supabase SQL Editor on a fresh project.
-- Uses Supabase Auth (auth.users) instead of a custom Users/Sessions table.
-- Roles: Admin (manage users + full CRM access) / Staff (CRM data only)

-- ------------------------------------------------------------
-- 1. Profiles (role mapping on top of auth.users)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  role text not null default 'Staff' check (role in ('Admin', 'Staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Helper: current user's role (used by other policies)
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (id = auth.uid() or public.current_role_name() = 'Admin');

create policy "profiles_admin_write"
  on public.profiles for all
  using (public.current_role_name() = 'Admin')
  with check (public.current_role_name() = 'Admin');

-- ------------------------------------------------------------
-- 2. Customers
-- ------------------------------------------------------------
create table if not exists public.customers (
  customer text primary key,
  group_name text,
  tier text,
  tier_remark text,
  contact text,
  tel text,
  email text,
  note text,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.customers enable row level security;

create policy "customers_read_authenticated"
  on public.customers for select
  using (auth.role() = 'authenticated');

create policy "customers_write_authenticated"
  on public.customers for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- 3. Services
-- ------------------------------------------------------------
create table if not exists public.services (
  id text primary key,
  customer text references public.customers(customer) on delete cascade,
  item text,
  type text,
  qty numeric,
  price_unit numeric,
  price_year numeric,
  start date,
  expire date,
  contact text,
  tel text,
  email text,
  note text,
  source text,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.services enable row level security;

create policy "services_read_authenticated"
  on public.services for select
  using (auth.role() = 'authenticated');

create policy "services_write_authenticated"
  on public.services for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- 4. Followups
-- ------------------------------------------------------------
create table if not exists public.followups (
  id text primary key,
  customer text references public.customers(customer) on delete cascade,
  date date,
  type text,
  note text,
  owner text,
  status text,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.followups enable row level security;

create policy "followups_read_authenticated"
  on public.followups for select
  using (auth.role() = 'authenticated');

create policy "followups_write_authenticated"
  on public.followups for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- 5. Churned customers
-- ------------------------------------------------------------
create table if not exists public.churned_customers (
  name text primary key,
  services text,
  lost_revenue numeric,
  expire date,
  reason text,
  winback text,
  updated_at timestamptz not null default now()
);

alter table public.churned_customers enable row level security;

create policy "churned_read_authenticated"
  on public.churned_customers for select
  using (auth.role() = 'authenticated');

create policy "churned_write_authenticated"
  on public.churned_customers for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- 6. Indexes
-- ------------------------------------------------------------
create index if not exists idx_services_customer on public.services(customer);
create index if not exists idx_followups_customer on public.followups(customer);
create index if not exists idx_services_expire on public.services(expire);
create index if not exists idx_followups_date on public.followups(date);

-- ------------------------------------------------------------
-- 7. Auto-create profile row when a new auth user signs up
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)), 'Staff')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 8. updated_at auto-touch trigger for each table
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_customers_touch on public.customers;
create trigger trg_customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_services_touch on public.services;
create trigger trg_services_touch before update on public.services
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_followups_touch on public.followups;
create trigger trg_followups_touch before update on public.followups
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_churned_touch on public.churned_customers;
create trigger trg_churned_touch before update on public.churned_customers
  for each row execute function public.touch_updated_at();
