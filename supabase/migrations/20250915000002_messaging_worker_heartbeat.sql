-- Persist scheduler liveness without storing host credentials or request metadata.
BEGIN;

CREATE TABLE IF NOT EXISTS public.messaging_worker_heartbeat (
  id TEXT PRIMARY KEY CHECK (id = 'messaging-worker'),
  last_success_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.messaging_worker_heartbeat IS
  'Non-secret liveness marker updated only after successful messaging queue worker runs.';

INSERT INTO public.messaging_worker_heartbeat (id) VALUES ('messaging-worker')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.messaging_worker_heartbeat ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.messaging_worker_heartbeat FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.messaging_worker_heartbeat TO service_role;

COMMIT;
