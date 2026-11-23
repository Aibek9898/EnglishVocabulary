-- Vocab: the database for accounts. Safe to run again and again: the GitHub
-- workflow "Set up Supabase" runs it on every change to this folder.

-- ---------- profiles: one per account; the first account is the admin ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Read own profile" on public.profiles;
create policy "Read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, is_admin, created_at)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'name', ''),
    not exists (select 1 from public.profiles where is_admin),
    coalesce(new.created_at, now())
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts made before this ran (e.g. the admin, added in the dashboard).
insert into public.profiles (id, email, name, created_at)
select u.id, u.email, nullif(u.raw_user_meta_data ->> 'name', ''), u.created_at
from auth.users u
on conflict (id) do nothing;

update public.profiles set is_admin = true
where id = (select id from public.profiles order by created_at limit 1)
  and not exists (select 1 from public.profiles where is_admin);

-- ---------- vocab_state: each account's words, progress, settings, grammar ----------
-- One gzipped JSON per account, the same format the site used for GitHub sync.
-- `version` goes up by one on every save, so two devices can't overwrite each other.

create table if not exists public.vocab_state (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data text not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.vocab_state enable row level security;

drop policy if exists "Own words" on public.vocab_state;
create policy "Own words" on public.vocab_state
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------- books: titles and reading position; the text is in Storage ----------

create table if not exists public.books (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  title text not null,
  author text,
  format text,
  words integer,
  added_at bigint,
  opened_at bigint,
  pos jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.books enable row level security;

drop policy if exists "Own books" on public.books;
create policy "Own books" on public.books
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.vocab_state, public.books to authenticated;
-- The admin function works as service_role; grant it too, in case new tables aren't granted automatically.
grant all on public.profiles, public.vocab_state, public.books to service_role;

-- ---------- Storage: a private bucket; each account sees only its own folder ----------

insert into storage.buckets (id, name, public, file_size_limit)
values ('books', 'books', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "Own book files: read" on storage.objects;
create policy "Own book files: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Own book files: add" on storage.objects;
create policy "Own book files: add" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Own book files: change" on storage.objects;
create policy "Own book files: change" on storage.objects
  for update to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Own book files: remove" on storage.objects;
create policy "Own book files: remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);
