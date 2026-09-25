-- Undergraduate Hub Supabase foundation.
-- Apply with Supabase CLI or the SQL editor after configuring a project.

create extension if not exists "pgcrypto";

create type public.user_role as enum ('member', 'staff', 'admin');
create type public.book_status as enum ('available', 'rented', 'lost');
create type public.request_status as enum (
  'pending', 'approved', 'rejected', 'rescheduled', 'collected', 'returned'
);
create type public.payment_method as enum ('cash', 'bkash', 'nagad');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  university text,
  role public.user_role not null default 'member',
  plan text not null default 'Student',
  deposit_status text not null default 'Pending',
  outstanding_fees numeric(10, 2) not null default 0 check (outstanding_fees >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text,
  phone text not null unique,
  university text not null default 'Other',
  student_id text,
  subscription_plan integer not null default 49 check (subscription_plan in (29, 49)),
  subscription_start date,
  subscription_end date,
  role text not null default 'member' check (role in ('member', 'staff', 'admin')),
  deposit_amount numeric(10, 2) not null default 300 check (deposit_amount >= 0),
  deposit_status text not null default 'unpaid'
    check (deposit_status in ('paid', 'unpaid', 'partially_paid', 'waived')),
  status text not null default 'active'
    check (status in ('active', 'expired', 'suspended')),
  total_books_read integer not null default 0 check (total_books_read >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  category text not null default 'Other',
  language text not null default 'English',
  cover_url text,
  qr_code text not null unique,
  isbn text,
  price numeric(10, 2) not null default 0 check (price >= 0),
  status public.book_status not null default 'available',
  condition_note text,
  deposit_required boolean not null default true,
  deposit_amount numeric(10, 2) not null default 300 check (deposit_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.borrow_requests (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id),
  member_id uuid not null references public.members(id),
  pickup_date date not null,
  pickup_slot text not null,
  status public.request_status not null default 'pending',
  note text,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  book_id uuid not null references public.books(id),
  request_date timestamptz not null default now(),
  requested_pickup_date date not null,
  requested_pickup_time time,
  approved_pickup_date date,
  approved_pickup_time time,
  borrow_date timestamptz,
  due_date timestamptz,
  return_date timestamptz,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'borrowed', 'returned', 'overdue', 'cancelled')),
  late_fee numeric(10, 2) not null default 0 check (late_fee >= 0),
  staff_note text,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  transaction_id uuid references public.transactions(id) on delete set null,
  amount numeric(10, 2) not null check (amount > 0),
  type text not null default 'subscription'
    check (type in ('subscription', 'deposit', 'late_fee', 'other')),
  method public.payment_method not null,
  reference_number text,
  collected_by uuid references auth.users(id) on delete set null,
  status text not null default 'paid'
    check (status in ('paid', 'pending', 'cancelled')),
  paid_at timestamptz not null default now()
  ,note text
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  plan text not null,
  starts_on date not null default current_date,
  ends_on date not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table public.wishlist (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (member_id, book_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index books_title_idx on public.books using gin (to_tsvector('simple', title));
create index books_author_idx on public.books (author);
create index books_category_idx on public.books (category);
create index books_language_idx on public.books (language);
create index books_status_idx on public.books (status);
create index books_qr_code_idx on public.books (qr_code);
create index borrow_requests_member_idx on public.borrow_requests (member_id, created_at desc);
create index borrow_requests_status_idx on public.borrow_requests (status, created_at desc);
create unique index transactions_one_active_book_idx
  on public.transactions (member_id)
  where status in ('approved', 'borrowed', 'overdue');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger members_updated_at before update on public.members
for each row execute function public.set_updated_at();
create trigger books_updated_at before update on public.books
for each row execute function public.set_updated_at();
create trigger borrow_requests_updated_at before update on public.borrow_requests
for each row execute function public.set_updated_at();
create trigger transactions_updated_at before update on public.transactions
for each row execute function public.set_updated_at();

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where id = auth.uid() and role in ('staff', 'admin')
  );
$$;

alter table public.profiles enable row level security;
alter table public.members enable row level security;
alter table public.books enable row level security;
alter table public.borrow_requests enable row level security;
alter table public.transactions enable row level security;
alter table public.payments enable row level security;
alter table public.subscriptions enable row level security;
alter table public.wishlist enable row level security;
alter table public.notifications enable row level security;

create policy "members can read their profile" on public.profiles
for select using (id = auth.uid() or public.is_staff());
create policy "members can update their profile" on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());
create policy "members can read their member record" on public.members
for select using (auth_user_id = auth.uid() or public.is_staff());
create policy "members can update their member record" on public.members
for update using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
create policy "staff can manage members" on public.members
for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "books are readable by signed-in users" on public.books
for select to authenticated using (true);
create policy "staff can manage books" on public.books
for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "members can read their requests" on public.borrow_requests
for select using (member_id = auth.uid() or public.is_staff());
create policy "members can create their requests" on public.borrow_requests
for insert with check (member_id = auth.uid());
create policy "staff can update requests" on public.borrow_requests
for update using (public.is_staff()) with check (public.is_staff());
create policy "members can read their transactions" on public.transactions
for select using (member_id in (select id from public.members where auth_user_id = auth.uid()) or public.is_staff());
create policy "staff can manage transactions" on public.transactions
for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff can manage payments" on public.payments
for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "members can read their subscriptions" on public.subscriptions
for select using (member_id = auth.uid() or public.is_staff());
create policy "members can manage their wishlist" on public.wishlist
for all using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy "members can read their notifications" on public.notifications
for select using (member_id = auth.uid() or public.is_staff());