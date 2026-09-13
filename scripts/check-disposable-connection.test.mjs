import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'scripts/check-disposable-connection.mjs'), 'utf8');

describe('disposable connection check safety contract', () => {
  it('pins the approved destination and uses a read-only transaction', () => {
    expect(source).toContain("host: 'aws-0-ap-northeast-1.pooler.supabase.com'");
    expect(source).toContain("username: 'postgres.hjzwbicauyxffrmdhvgy'");
    expect(source).toContain("sqlRole: 'postgres'");
    expect(source).toContain("await client.query('BEGIN READ ONLY')");
    expect(source).toContain("transaction_read_only");
    expect(source).toContain('session_user AS session_user');
    expect(source).toContain('login_username: parsedFields.login_username');
    expect(source).toContain("'current_user'");
  });

  it('does not print or mutate the connection URI', () => {
    expect(source).not.toContain('console.log(raw)');
    expect(source).not.toContain('console.log(JSON.stringify({ raw');
    expect(source).not.toContain('INSERT ');
    expect(source).not.toContain('UPDATE ');
    expect(source).not.toContain('CREATE ');
    expect(source).toContain('writes_performed: false');
    expect(source).toContain('parsed: parsedFields');
    expect(source).toContain('field: failedField');
  });
});
