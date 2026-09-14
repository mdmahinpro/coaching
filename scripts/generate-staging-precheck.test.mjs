import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const precheckPath = path.join(root, 'staging', 'STAGING_PRECHECK.sql');
const generatorPath = path.join(root, 'scripts', 'generate-staging-precheck.mjs');
const precheck = fs.readFileSync(precheckPath, 'utf8');
const generator = fs.readFileSync(generatorPath, 'utf8');

const psql = ['echo', 'set', '\\i', 'include', 'connect', 'gexec', 'copy', '\\d', 'q', 'o', 'g'];

describe('staging precheck: missing optional objects must not error', () => {
  it('reports the ledger via to_regclass, never via an unguarded static FROM', () => {
    // A plain static top-level `SELECT ... FROM public.provisioning_migrations`
    // would raise 42P01 when the relation is absent: PostgreSQL resolves a
    // missing relation at parse/plan time even behind a CASE/WHERE EXISTS.
    // The ONLY `FROM public.provisioning_migrations` occurrences in the file must
    // be inside a DO-block EXECUTE string (dynamic SQL) that is guarded by
    // to_regclass(...), so the missing-relation failure mode is unreachable.
    const fromRefs = [...precheck.matchAll(/FROM\s+public\.provisioning_migrations\b/gi)];
    expect(fromRefs.length).toBeGreaterThan(0);
    for (const ref of fromRefs) {
      const before = precheck.slice(0, ref.index);
      // The reference must sit after DO $$ ... EXECUTE 'SELECT ... (a dynamic
      // string), and there must be a to_regclass guard already seen inside its
      // enclosing DO block.
      const lastDo = before.lastIndexOf('DO $$');
      const lastGuard = before.lastIndexOf("to_regclass('public.provisioning_migrations') IS NOT NULL");
      expect(lastGuard).toBeGreaterThan(lastDo);
      expect(before.lastIndexOf("EXECUTE 'SELECT")).toBeGreaterThan(lastDo);
    }
    // The existence guard itself is present and catalog-only.
    expect(precheck).toContain("to_regclass('public.provisioning_migrations') IS NOT NULL");
    // The guarded dynamic queries are present.
    expect(precheck).toContain("EXECUTE 'SELECT count(*) FROM public.provisioning_migrations' INTO v_rows");
    expect(precheck).toContain("EXECUTE 'SELECT version, sha256, applied_at FROM public.provisioning_migrations ORDER BY version'");
  });

  it('inspects ALL optional application tables via the system catalog, never via direct FROM', () => {
    // The precheck must never `SELECT ... FROM public.<app_table>`. Every app
    // table reference must be a catalog predicate (pg_class/pg_proc/RLS), which
    // is safe on a database with no application objects.
    const directRefs = precheck.match(/FROM\s+public\.(?!provisioning_migrations\b)[a-z_]+\b/gi);
    expect(directRefs).toBe(null);
    // Informational live-tuples come from pg_class.reltuples (catalog), not the tables.
    expect(precheck).toContain('c.reltuples::bigint AS live_tuples');
  });

  it('chooses GO for a fresh database (no app tables, no ledger)', () => {
    // The decision CASE returns GO when the ledger is absent AND no application
    // table or function exists. We assert the branch ordering and the exact
    // GO/STOP probe strings that encode the three result meanings.
    const goIdx = precheck.indexOf("'GO: fresh-install candidate. Run STAGING_INSTALL.sql.'");
    expect(goIdx).toBeGreaterThan(-1);
    // STOP when an existing ledger is found (checked first, so a present ledger
    // always stops for review regardless of application objects).
    const ledgerStop = precheck.indexOf("'STOP: an existing migration ledger was found.");
    expect(ledgerStop).toBeGreaterThan(-1);
    expect(ledgerStop).toBeLessThan(goIdx);
    // STOP when application objects exist even if empty.
    expect(precheck).toContain("'STOP: application objects already exist (even if empty).");
    expect(precheck).toContain("'STOP: application functions already exist.");
    // The consolidated summary exposes ledger_exists + catalog counts together,
    // so the independent GO condition (summary) matches the DECISION guide.
    expect(precheck).toContain('AS application_tables_found,');
    expect(precheck).toContain('AS application_functions_found,');
    expect(precheck).toContain('AS ledger_exists;');
  });

  it('is non-mutating (selects/catalog only, no DDL/DML/policy writes)', () => {
    // No statement may BEGIN with a DDL/DML/policy keyword. Words like "drop"/
    // "create" can legitimately appear inside the decision/notice STRING
    // literals (e.g. "Do not drop/reset"), so only the leading statement token
    // is rejected as a mutation signal.
    const writeStarts = precheck.match(/^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE)\b/gim);
    expect(writeStarts).toBeNull();
    // The only dynamic execution is a conditional read-only SELECT against the
    // ledger (guarded by to_regclass). Diagnostics are emitted via RAISE NOTICE.
    expect(precheck).toContain('RAISE NOTICE');
  });

  it('is Dashboard SQL Editor compatible (no psql directives)', () => {
    for (const directive of psql) {
      expect(precheck).not.toMatch(new RegExp(`^\\\\${directive}\\b`, 'i'));
    }
  });

  it('ships a generator that emits the precheck from a single authoritative table list', () => {
    // The generator is the source of truth for the table/function lists and for
    // the guarded-ledger handling that prevents the 42P01 failure.
    expect(generator).toContain("'provisioning_migrations'");
    expect(generator).toContain("to_regclass('public.provisioning_migrations') IS NOT NULL");
    expect(generator).toContain('outPath');
  });

  it('precheck covers EVERY table the install bundle creates, so a partial existing schema cannot pass as fresh', () => {
    // A devastating failure mode is the installer hitting "relation already
    // exists" (e.g. public.teachers) on a database the precheck called "fresh"
    // because the precheck's table list missed that one table. The precheck
    // must therefore cover every application table the install bundle emits.
    const bundle = fs.readFileSync(path.join(root, 'staging', 'STAGING_INSTALL.sql'), 'utf8');
    // Parse the shipped precheck's first authoritative catalog table list. This
    // also covers reviewed one-off staging additions that are intentionally not
    // made to the generator in a database-only change set.
    const tableListStart = precheck.indexOf("AND c.relname IN (");
    const tableListEnd = precheck.indexOf("       )", tableListStart);
    const appSrc = precheck.slice(tableListStart, tableListEnd);
    const precheckTables = [...appSrc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    // Every CREATE TABLE in the bundle (public app tables; ledger is reported
    // separately and is intentionally absent from the fresh-install GO list).
    const created = new Set(
      [...bundle.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?([a-z_]+)/gi)].map((m) => m[1])
    );
    created.delete('provisioning_migrations');
    const missing = [...created].filter((t) => !precheckTables.includes(t));
    expect(missing).toEqual([]);
    // Sanity: teachers (the reported 42P07 object) is definitely covered.
    expect(precheckTables).toContain('teachers');
    expect(precheckTables).toContain('sms_logs');
  });
});