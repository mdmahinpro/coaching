import { z } from 'zod';

export const BACKUP_VERSION = '1.0' as const;
export const MAX_BACKUP_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_BACKUP_ROWS_PER_TABLE = 10_000;
export const MAX_BACKUP_TOTAL_ROWS = 50_000;

export const BACKUP_TABLES = [
  'students',
  'teachers',
  'batches',
  'fees',
  'exams',
  'mcq_questions',
  'mcq_submissions',
  'notices',
  'sms_logs',
  'payment_approvals',
  'fee_audit_logs',
  'admission_requests',
  'site_settings',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];
export type BackupRow = Record<string, unknown>;
export type BackupTables = Partial<Record<BackupTable, BackupRow[]>>;

export interface BackupEnvelope {
  backup_version: typeof BACKUP_VERSION;
  backup_date: string;
  institute: string;
  tables: BackupTables;
}

const allowedTables = new Set<string>(BACKUP_TABLES);
const globallySensitiveKeys =
  /(^|_)(password|passwd|password_hash|default_password|api_key|apikey|secret|token|access_token|refresh_token|authorization|provider_response)(_|$)/i;
const tableSensitiveFields: Partial<Record<BackupTable, ReadonlySet<string>>> = {
  students: new Set(['password', 'password_hash']),
  admission_requests: new Set(['reference_no', 'default_password']),
  sms_logs: new Set(['response', 'provider_response']),
};
const sensitiveSettingKey =
  /(password|passwd|api[_-]?key|secret|token|authorization|credential)/i;

function isPlainObject(value: unknown): value is BackupRow {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {return false;}
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function containsSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) {return value.some(containsSensitiveKey);}
  if (!isPlainObject(value)) {return false;}
  return Object.entries(value).some(
    ([key, nested]) => globallySensitiveKeys.test(key) || containsSensitiveKey(nested)
  );
}

function rowHasSensitiveData(table: BackupTable, row: BackupRow): boolean {
  const denied = tableSensitiveFields[table];
  if (denied && Object.keys(row).some((key) => denied.has(key))) {return true;}
  if (
    table === 'site_settings' &&
    typeof row.key === 'string' &&
    sensitiveSettingKey.test(row.key)
  ) {
    return true;
  }
  return containsSensitiveKey(row);
}

const jsonPrimitive = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
type JsonValue = z.infer<typeof jsonPrimitive> | JsonValue[] | { [key: string]: JsonValue };
const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonPrimitive, z.array(jsonValue), z.record(jsonValue)])
);
const rowSchema = z.record(jsonValue).refine(isPlainObject, 'Each row must be a JSON object');

const envelopeSchema = z
  .object({
    backup_version: z.literal(BACKUP_VERSION),
    backup_date: z.string().datetime({ offset: true }),
    institute: z.string().min(1).max(200),
    tables: z.record(z.array(rowSchema).max(MAX_BACKUP_ROWS_PER_TABLE)),
  })
  .strict()
  .superRefine((envelope, ctx) => {
    const entries = Object.entries(envelope.tables);
    if (entries.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tables'], message: 'No tables supplied' });
    }
    let totalRows = 0;
    for (const [tableName, rows] of entries) {
      if (!allowedTables.has(tableName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tables', tableName],
          message: `Table is not allowed: ${tableName}`,
        });
        continue;
      }
      totalRows += rows.length;
      rows.forEach((row, index) => {
        if (rowHasSensitiveData(tableName as BackupTable, row)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tables', tableName, index],
            message: 'Sensitive fields are not permitted in portable backups',
          });
        }
      });
    }
    if (totalRows > MAX_BACKUP_TOTAL_ROWS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tables'],
        message: `Backup exceeds ${MAX_BACKUP_TOTAL_ROWS} total rows`,
      });
    }
  });

function stripSensitiveKeys(value: unknown): unknown {
  if (Array.isArray(value)) {return value.map(stripSensitiveKeys);}
  if (!isPlainObject(value)) {return value;}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !globallySensitiveKeys.test(key))
      .map(([key, nested]) => [key, stripSensitiveKeys(nested)])
  );
}

export function sanitizeBackupTables(input: unknown): BackupTables {
  if (!isPlainObject(input)) {throw new Error('Backup tables must be an object');}
  const output: BackupTables = {};
  for (const [tableName, value] of Object.entries(input)) {
    if (!allowedTables.has(tableName) || !Array.isArray(value)) {continue;}
    const table = tableName as BackupTable;
    const denied = tableSensitiveFields[table];
    const rows = value
      .filter(isPlainObject)
      .filter(
        (row) =>
          table !== 'site_settings' ||
          typeof row.key !== 'string' ||
          !sensitiveSettingKey.test(row.key)
      )
      .map((row) =>
        Object.fromEntries(
          Object.entries(row)
            .filter(([key]) => !denied?.has(key) && !globallySensitiveKeys.test(key))
            .map(([key, nested]) => [key, stripSensitiveKeys(nested)])
        )
      );
    output[table] = rows;
  }
  return output;
}

export function parseBackupText(text: string): BackupEnvelope {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_FILE_BYTES) {
    throw new Error(`Backup file exceeds ${MAX_BACKUP_FILE_BYTES / 1024 / 1024} MiB`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Backup is not valid JSON');
  }
  const result = envelopeSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? 'Invalid backup schema');
  }
  return result.data as BackupEnvelope;
}

export function createBackupEnvelope(
  tables: unknown,
  institute: string,
  backupDate = new Date().toISOString()
): BackupEnvelope {
  const sanitized = sanitizeBackupTables(tables);
  return parseBackupText(
    JSON.stringify({
      backup_version: BACKUP_VERSION,
      backup_date: backupDate,
      institute: institute || 'CoachingCenter',
      tables: sanitized,
    })
  );
}
