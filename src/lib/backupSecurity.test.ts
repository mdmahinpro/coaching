import { describe, expect, it } from 'vitest';
import {
  BACKUP_VERSION,
  MAX_BACKUP_FILE_BYTES,
  MAX_BACKUP_ROWS_PER_TABLE,
  createBackupEnvelope,
  parseBackupText,
  sanitizeBackupTables,
} from './backupSecurity';

const validEnvelope = (tables: Record<string, unknown> = { students: [{ id: 'student-1' }] }) =>
  JSON.stringify({
    backup_version: BACKUP_VERSION,
    backup_date: '2025-09-10T10:00:00.000Z',
    institute: 'Test Center',
    tables,
  });

describe('portable backup security boundary', () => {
  it('accepts only the exact supported envelope and table allowlist', () => {
    expect(parseBackupText(validEnvelope()).tables.students).toHaveLength(1);
    expect(() => parseBackupText(validEnvelope({ admin_users: [] }))).toThrow('Table is not allowed');
    expect(() =>
      parseBackupText(
        JSON.stringify({ ...JSON.parse(validEnvelope()), unexpected: true })
      )
    ).toThrow();
    expect(() =>
      parseBackupText(validEnvelope({ students: 'not-an-array' }))
    ).toThrow();
  });

  it('rejects sensitive fields, including nested secrets and default admission passwords', () => {
    expect(() =>
      parseBackupText(validEnvelope({ students: [{ id: '1', password: '$2b$hash' }] }))
    ).toThrow('Sensitive fields');
    expect(() =>
      parseBackupText(validEnvelope({ admission_requests: [{ id: '1', reference_no: 'APP-123' }] }))
    ).toThrow('Sensitive fields');
    expect(() =>
      parseBackupText(validEnvelope({ sms_logs: [{ response: { token: 'provider-secret' } }] }))
    ).toThrow('Sensitive fields');
    expect(() =>
      parseBackupText(validEnvelope({ fees: [{ id: '1', session_token: 'session-secret' }] }))
    ).toThrow('Sensitive fields');
    expect(() =>
      parseBackupText(validEnvelope({ fees: [{ id: '1', provider_response: { id: 'remote' } }] }))
    ).toThrow('Sensitive fields');
    expect(() =>
      parseBackupText(validEnvelope({ site_settings: [{ key: 'sms_api_key', value: 'secret' }] }))
    ).toThrow('Sensitive fields');
  });

  it('removes sensitive data before export without mutating ordinary fields', () => {
    const sanitized = sanitizeBackupTables({
      students: [{ id: '1', name: 'Ada', password: '$2b$hash' }],
      admission_requests: [{ id: '2', reference_no: 'APP-123', name: 'Lin' }],
      sms_logs: [{ id: '3', response: { token: 'secret' }, message: 'sent' }],
      fees: [
        {
          id: '4',
          amount: 500,
          session_token: 'session-secret',
          provider_response: { access_token: 'provider-secret' },
        },
      ],
      site_settings: [
        { key: 'institute_name', value: 'Center' },
        { key: 'email_api_key', value: 'secret' },
      ],
    });

    expect(sanitized.students).toEqual([{ id: '1', name: 'Ada' }]);
    expect(sanitized.admission_requests).toEqual([{ id: '2', name: 'Lin' }]);
    expect(sanitized.sms_logs).toEqual([{ id: '3', message: 'sent' }]);
    expect(sanitized.fees).toEqual([{ id: '4', amount: 500 }]);
    expect(sanitized.site_settings).toEqual([{ key: 'institute_name', value: 'Center' }]);
    expect(() => createBackupEnvelope(sanitized, 'Center')).not.toThrow();
  });

  it('enforces per-table row and total file-size limits before restore', () => {
    const tooManyRows = Array.from({ length: MAX_BACKUP_ROWS_PER_TABLE + 1 }, (_, id) => ({ id }));
    expect(() => parseBackupText(validEnvelope({ students: tooManyRows }))).toThrow();

    const oversized = validEnvelope({ notices: [{ content: 'x'.repeat(MAX_BACKUP_FILE_BYTES) }] });
    expect(() => parseBackupText(oversized)).toThrow('exceeds 10 MiB');
  });
});
