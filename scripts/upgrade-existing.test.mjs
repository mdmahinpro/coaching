import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const upgrade = fs.readFileSync(path.join(root, 'scripts/upgrade-existing.mjs'), 'utf8');
const fixture = fs.readFileSync(path.join(root, 'scripts/seed-showcase.mjs'), 'utf8');
const browserDemo = fs.readFileSync(path.join(root, 'src/data/demoData.ts'), 'utf8');

describe('showcase handover tooling', () => {
  it('makes existing upgrades dry-run first with immutable backup evidence', () => {
    expect(upgrade).toContain("process.env.UPGRADE_APPLY === '1'");
    expect(upgrade).toContain('BEGIN TRANSACTION READ ONLY');
    expect(upgrade).toContain('UPGRADE_PLAN_FILE');
    expect(upgrade).toContain('UPGRADE_BACKUP_EVIDENCE_FILE');
    expect(upgrade).toContain('immutableLocation');
    expect(upgrade).toContain('schemaSignature');
  });

  it('requires explicit reviewed adoption when a populated database lacks a ledger', () => {
    expect(upgrade).toContain('UPGRADE_ADOPTION_FILE');
    expect(upgrade).toContain('adoption.reviewed !== true');
    expect(upgrade).toContain('Adoption evidence missing exact checksum');
  });

  it('removes browser writes and provides a showcase-only owned fixture', () => {
    expect(browserDemo).not.toContain("from '@/lib/supabase'");
    expect(browserDemo).toContain('Browser demo seeding is disabled');
    expect(fixture).toContain("allowedEnvironment: 'showcase'");
    expect(fixture).toContain('showcase_fixture_runs');
    expect(fixture).toContain('showcase_fixture_rows');
    expect(fixture).toContain("process.env.SHOWCASE_FIXTURE_APPLY === '1'");
  });
});
