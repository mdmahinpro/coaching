import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migrationPath = 'supabase/migrations/20250912000001_student_auth_hardening.sql';
const migration = fs.readFileSync(path.join(process.cwd(), migrationPath), 'utf8');
const manifest = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'supabase/schema/migration-manifest.json'), 'utf8')
) as { migrations: Array<{ file: string; classification: string }> };

const functionBody = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.verify_student_login'),
  migration.indexOf('GRANT EXECUTE ON FUNCTION public.verify_student_login')
);

describe('student authentication hardening migration', () => {
  it('is the authoritative forward migration after atomic exam deletion', () => {
    const files = manifest.migrations.map(({ file }) => file);
    const previous = files.indexOf('20250911000001_atomic_exam_deletion.sql');
    const hardened = files.indexOf('20250912000001_student_auth_hardening.sql');

    expect(previous).toBeGreaterThanOrEqual(0);
    expect(hardened).toBe(previous + 1);
    expect(manifest.migrations[hardened]?.classification).toBe('required-security');
  });

  it('migrates every non-empty non-bcrypt student password to bcrypt', () => {
    expect(migration).toContain('UPDATE public.students AS s');
    expect(migration).toContain('SET search_path = public, extensions;');
    expect(migration).toContain('RESET search_path;');
    expect(migration).toContain("SET password = crypt(s.password, gen_salt('bf'))");
    expect(migration).toContain("AND btrim(s.password) <> ''");
    expect(migration).toContain("AND s.password !~ '^\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$'");
  });

  it('serializes the rate-limit decision per normalized phone and fails closed', () => {
    const lock = functionBody.indexOf('pg_catalog.pg_advisory_xact_lock');
    const count = functionBody.indexOf('SELECT count(*) INTO v_failed_count');
    const authentication = functionBody.indexOf('SELECT s.id INTO v_id');

    expect(functionBody).toContain(
      "regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9]', '', 'g')"
    );
    expect(functionBody).toContain('pg_catalog.hashtextextended(v_phone, 0)');
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(count).toBeGreaterThan(lock);
    expect(authentication).toBeGreaterThan(count);
    expect(functionBody).toContain('IF v_failed_count >= 5 THEN');
    expect(functionBody).toContain(
      "RAISE EXCEPTION 'Too many failed attempts. Please try again later.'"
    );
    expect(functionBody).not.toContain('EXCEPTION WHEN');
  });

  it('uses bcrypt only and retains committed failure accounting', () => {
    expect(functionBody).toContain("s.password ~ '^\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$'");
    expect(functionBody).toContain('s.password = crypt(p_password, s.password)');
    expect(functionBody).not.toMatch(/s\.password\s*=\s*p_password/);

    const invalidBranch = functionBody.slice(
      functionBody.indexOf('IF v_id IS NULL THEN'),
      functionBody.indexOf(
        'INSERT INTO public.login_attempts (phone_number, attempt_time, success)',
        functionBody.indexOf('IF v_id IS NULL THEN') + 1
      )
    );
    expect(invalidBranch).not.toContain('RAISE EXCEPTION');
    expect(functionBody).toContain('VALUES (v_phone, clock_timestamp(), false);\n    RETURN;');
  });

  it('preserves the public result signature and opaque session issuance', () => {
    expect(functionBody).toContain('session_token  TEXT');
    expect(functionBody).toContain('v_token := public._issue_student_session(v_id);');
    expect(functionBody).toContain('v_token\n  FROM public.students AS s');
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.verify_student_login(TEXT, TEXT) TO anon, authenticated;'
    );
  });
});
