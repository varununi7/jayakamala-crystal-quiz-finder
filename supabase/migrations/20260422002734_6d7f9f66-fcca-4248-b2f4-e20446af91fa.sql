
CREATE TABLE public.crystal_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  answers jsonb not null,
  recommendations jsonb not null,
  wants_supply boolean default false,
  created_at timestamptz not null default now()
);

ALTER TABLE public.crystal_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert leads"
ON public.crystal_leads
FOR INSERT
TO anon, authenticated
WITH CHECK (true);
