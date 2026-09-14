-- ============================================================
--  home_stats(): public aggregate counts for the homepage hero.
--
--  The hero's students/teacher/batch counts are aggregate numbers that are
--  already displayed publicly. `students` is a private table, so it cannot be
--  counted by the browser's anon role directly; this SECURITY DEFINER function
--  runs as the table owner and returns ONLY the three aggregate counts (never
--  any row data). This lets the homepage fetch live counts via the normal anon
--  Supabase client instead of the `/api/home-stats` serverless function, which
--  requires a SUPABASE_SERVICE_ROLE_KEY environment variable on the host.
-- ============================================================

CREATE OR REPLACE FUNCTION public.home_stats()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'students', (SELECT count(*) FROM public.students   WHERE is_approved = true AND status = 'active'),
    'teachers', (SELECT count(*) FROM public.teachers   WHERE is_active = true),
    'batches',  (SELECT count(*) FROM public.batches    WHERE is_active = true)
  );
$$;

-- Callable by the public/anon client for the homepage; returns aggregates only.
REVOKE ALL ON FUNCTION public.home_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.home_stats() TO anon, authenticated;