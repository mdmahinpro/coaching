import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20250913000001_private_avatars_public_assets.sql'),
  'utf8'
);

describe('private avatars/public assets migration', () => {
  it('makes avatars private and creates a separately named public bucket', () => {
    expect(sql).toContain("'avatars', 'avatars', false");
    expect(sql).toContain("'public-assets', 'public-assets', true");
    expect(sql).toContain('file_size_limit = EXCLUDED.file_size_limit');
  });

  it('removes browser avatar policies and creates no direct write policy', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "avatars_auth_insert"');
    expect(sql).toContain('DROP POLICY IF EXISTS "avatars_auth_update"');
    expect(sql).toContain('DROP POLICY IF EXISTS "avatars_anon_insert"');
    expect(sql).not.toMatch(/CREATE\s+POLICY[\s\S]+FOR\s+(INSERT|UPDATE|DELETE)/i);
  });

  it('normalizes legacy student public URLs to private references', () => {
    expect(sql).toContain('UPDATE public.students');
    expect(sql).toContain("'avatars/\\1'");
    expect(sql).toContain('/object/public/avatars/students/');
  });
});
