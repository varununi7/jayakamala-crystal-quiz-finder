-- Explicit deny policies on crystal_leads (RLS already enabled, but no policies)
-- The edge function uses the service role and bypasses RLS, so end users get no access.
CREATE POLICY "Deny all client select on crystal_leads"
ON public.crystal_leads FOR SELECT
TO anon, authenticated
USING (false);

CREATE POLICY "Deny all client insert on crystal_leads"
ON public.crystal_leads FOR INSERT
TO anon, authenticated
WITH CHECK (false);

CREATE POLICY "Deny all client update on crystal_leads"
ON public.crystal_leads FOR UPDATE
TO anon, authenticated
USING (false) WITH CHECK (false);

CREATE POLICY "Deny all client delete on crystal_leads"
ON public.crystal_leads FOR DELETE
TO anon, authenticated
USING (false);

-- Shared, persistent rate-limit counters
CREATE TABLE public.rate_limits (
  bucket_key text NOT NULL PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- No client policies: only service role (which bypasses RLS) may touch this.
CREATE POLICY "Deny all client access on rate_limits"
ON public.rate_limits FOR ALL
TO anon, authenticated
USING (false) WITH CHECK (false);

-- Atomic increment: returns true if under the limit (allowed), false if over.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  _bucket_key text,
  _limit integer,
  _window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_reset timestamptz;
BEGIN
  INSERT INTO public.rate_limits (bucket_key, count, reset_at)
  VALUES (_bucket_key, 1, now() + make_interval(secs => _window_seconds))
  ON CONFLICT (bucket_key) DO UPDATE
    SET
      count = CASE WHEN public.rate_limits.reset_at < now() THEN 1 ELSE public.rate_limits.count + 1 END,
      reset_at = CASE WHEN public.rate_limits.reset_at < now() THEN now() + make_interval(secs => _window_seconds) ELSE public.rate_limits.reset_at END
  RETURNING count, reset_at INTO v_count, v_reset;

  RETURN v_count <= _limit;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;