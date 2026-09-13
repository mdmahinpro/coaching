import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'scripts/check-disposable-state.mjs'), 'utf8');

describe('disposable destination-state check safety', () => {
  it('pins the destination and uses a read-only transaction', () => {
    expect(source).toContain("host: 'aws-0-ap-northeast-1.pooler.supabase.com'");
    expect(source).toContain("login_username: 'postgres.hjzwbicauyxffrmdhvgy'");
    expect(source).toContain('BEGIN READ ONLY');
    expect(source).toContain('pg_stat_user_tables');
    expect(source).toContain('provisioning_migrations');
  });
  it('does not write or print secrets', () => {
    expect(source).not.toContain('console.log(raw)');
    expect(source).not.toContain('INSERT ');
    expect(source).not.toContain('UPDATE ');
    expect(source).not.toContain('DROP ');
    expect(source).not.toContain('CREATE ');
    expect(source).toContain('writes_performed: false');
  });
});