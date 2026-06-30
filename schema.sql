-- =============================================
-- INKWELL DATABASE SCHEMA
-- Run this in Supabase > SQL Editor > New Query
-- =============================================

-- 1. PROFILES TABLE (one row per user)
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  name text not null,
  is_premium boolean default false,
  stories_posted integer default 0,
  created_at timestamptz default now()
);

-- 2. STORIES TABLE
create table public.stories (
  id bigint generated always as identity primary key,
  author_id uuid references public.profiles(id) on delete cascade,
  author_name text not null,
  is_author_premium boolean default false,
  title text not null,
  genre text not null,
  preview text,
  body text not null,
  created_at timestamptz default now()
);

-- 3. REACTIONS TABLE
create table public.reactions (
  id bigint generated always as identity primary key,
  story_id bigint references public.stories(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz default now(),
  unique(story_id, user_id, emoji)
);

-- =============================================
-- ENABLE ROW LEVEL SECURITY
-- =============================================
alter table public.profiles enable row level security;
alter table public.stories enable row level security;
alter table public.reactions enable row level security;

-- =============================================
-- PROFILES POLICIES
-- =============================================
create policy "Anyone can view profiles"
  on public.profiles for select using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update using (auth.uid() = id);

-- =============================================
-- STORIES POLICIES
-- =============================================
create policy "Anyone can view stories"
  on public.stories for select using (true);

create policy "Logged in users can post stories"
  on public.stories for insert with check (auth.uid() = author_id);

-- =============================================
-- REACTIONS POLICIES
-- =============================================
create policy "Anyone can view reactions"
  on public.reactions for select using (true);

create policy "Logged in users can react"
  on public.reactions for insert with check (auth.uid() = user_id);

create policy "Users can remove their own reactions"
  on public.reactions for delete using (auth.uid() = user_id);
