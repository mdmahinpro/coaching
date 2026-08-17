-- Enable the pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create the heartbeat table
CREATE TABLE IF NOT EXISTS database_keepalive (
    id INT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert the initial record
INSERT INTO database_keepalive (id, created_at)
VALUES (1, NOW())
ON CONFLICT (id) DO UPDATE SET created_at = NOW();

-- Schedule the daily task to run at midnight every day
-- This refreshes the timestamp on the existing row
SELECT cron.schedule('daily-heartbeat', '0 0 * * *', $$ UPDATE database_keepalive SET created_at = NOW() WHERE id = 1; $$);
