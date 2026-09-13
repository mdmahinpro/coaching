import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20250907000001_exam_session_only_and_avatar_storage.sql'),
  'utf8'
);

describe('Batch S1 forward migration contract', () => {
  it('removes identifier-only exam entry and creates session-only entry', () => {
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.exam_join(UUID, TEXT, TEXT)');
    expect(migration).toContain('CREATE FUNCTION public.exam_join(');
    expect(migration).toContain('p_portal_token TEXT');
    expect(migration).toContain("RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'");
    expect(migration).toContain('_student_id_from_token(p_portal_token)');
    expect(migration).not.toContain('p_student_code TEXT');
  });

  it('removes anonymous avatar write policies without changing public-read decision', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "avatars_anon_insert"');
    expect(migration).toContain('DROP POLICY IF EXISTS "avatars_anon_update"');
    expect(migration).toContain('DROP POLICY IF EXISTS "avatars_anon_delete"');
    expect(migration).not.toContain('CREATE POLICY "avatars_anon_insert"');
    expect(migration).not.toContain('CREATE POLICY "avatars_anon_update"');
  });
});
