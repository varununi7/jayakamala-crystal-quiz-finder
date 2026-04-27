-- Remove the overly permissive always-true INSERT policy on crystal_leads.
-- Writes happen exclusively from the crystal-quiz edge function using the
-- service role key, which bypasses RLS. No client (anon or authenticated)
-- needs direct insert access.
DROP POLICY IF EXISTS "Anyone can insert leads" ON public.crystal_leads;

-- RLS remains enabled; with no policies, all anon/authenticated access is denied
-- by default. Service role (used by the edge function) continues to bypass RLS.