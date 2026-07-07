create table if not exists public.tenant_connector_vault (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    schema_name text not null,
    record_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc'::text, now()),
    updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists idx_tenant_connector_vault_tenant_schema
    on public.tenant_connector_vault (tenant_id, schema_name);

create index if not exists idx_tenant_connector_vault_record_data
    on public.tenant_connector_vault using gin (record_data);

create or replace function public.set_tenant_connector_vault_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc'::text, now());
    return new;
end;
$$;

drop trigger if exists trg_tenant_connector_vault_updated_at on public.tenant_connector_vault;
create trigger trg_tenant_connector_vault_updated_at
before update on public.tenant_connector_vault
for each row
execute function public.set_tenant_connector_vault_updated_at();

alter table public.tenant_connector_vault enable row level security;

drop policy if exists "tenant_connector_vault_select_own" on public.tenant_connector_vault;
create policy "tenant_connector_vault_select_own"
on public.tenant_connector_vault
for select
using ((current_setting('request.jwt.claims', true)::jsonb ->> 'sub') = tenant_id);

drop policy if exists "tenant_connector_vault_insert_own" on public.tenant_connector_vault;
create policy "tenant_connector_vault_insert_own"
on public.tenant_connector_vault
for insert
with check ((current_setting('request.jwt.claims', true)::jsonb ->> 'sub') = tenant_id);

drop policy if exists "tenant_connector_vault_update_own" on public.tenant_connector_vault;
create policy "tenant_connector_vault_update_own"
on public.tenant_connector_vault
for update
using ((current_setting('request.jwt.claims', true)::jsonb ->> 'sub') = tenant_id)
with check ((current_setting('request.jwt.claims', true)::jsonb ->> 'sub') = tenant_id);

drop policy if exists "tenant_connector_vault_delete_own" on public.tenant_connector_vault;
create policy "tenant_connector_vault_delete_own"
on public.tenant_connector_vault
for delete
using ((current_setting('request.jwt.claims', true)::jsonb ->> 'sub') = tenant_id);