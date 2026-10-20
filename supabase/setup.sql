-- Pick – Datenbank für den gemeinsamen Sync
-- Einmal im Supabase SQL Editor ausführen (alles markieren → Run).

-- Gerichte, Orte und Einkaufsliste (kind = 'shop'). Der ganze Eintrag liegt als JSON in "data".
-- Gelöschte Einträge bleiben als "deleted = true" stehen, damit das andere Handy davon erfährt.
create table if not exists public.items (
  id          uuid primary key,
  kind        text not null check (kind in ('dish', 'place', 'shop')),
  data        jsonb not null default '{}'::jsonb,
  deleted     boolean not null default false,
  updated_at  timestamptz not null
);

-- Verlauf "Zuletzt gegessen"
create table if not exists public.history (
  id    uuid primary key,
  data  jsonb not null,
  at    timestamptz not null
);

-- Fotos der Gerichte/Orte (als verkleinertes JPEG, Base64). Eine Foto-ID ändert sich nie,
-- ein neues Foto bekommt eine neue ID.
create table if not exists public.images (
  id          uuid primary key,
  data        text not null,
  created_at  timestamptz not null default now()
);

-- Zugriff nur für angemeldete Nutzer (= ihr beide). Anonym gibt es nichts.
alter table public.items   enable row level security;
alter table public.history enable row level security;
alter table public.images  enable row level security;

drop policy if exists "Angemeldete duerfen alles" on public.items;
create policy "Angemeldete duerfen alles" on public.items
  for all to authenticated using (true) with check (true);

drop policy if exists "Angemeldete duerfen alles" on public.history;
create policy "Angemeldete duerfen alles" on public.history
  for all to authenticated using (true) with check (true);

drop policy if exists "Angemeldete duerfen alles" on public.images;
create policy "Angemeldete duerfen alles" on public.images
  for all to authenticated using (true) with check (true);

revoke all on public.items, public.history, public.images from anon;
grant select, insert, update, delete on public.items, public.history, public.images to authenticated;
