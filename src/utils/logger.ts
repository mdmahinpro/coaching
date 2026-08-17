/**
 * Centralized logging utility.
 *
 * All application errors, warnings, and info messages flow through here.
 * This single integration point makes it trivial to add Sentry (or any
 * other observability platform) later — just update the functions below.
 */

type LogLevel = 'error' | 'warn' | 'info';

interface LogContext {
  /** Component or module name where the log originated */
  source?: string;
  /** Extra key-value pairs for structured logging */
  meta?: Record<string, unknown>;
}

const CONSOLE_METHODS: Record<LogLevel, (...args: unknown[]) => void> = {
  error: console.error,
  warn: console.warn,
  info: console.info,
};

const PREFIXES: Record<LogLevel, string> = {
  error: '[Error]',
  warn: '[Warning]',
  info: '[Info]',
};

/**
 * Core log function — writes to console now, single swap point for Sentry.
 */
function log(level: LogLevel, message: string, context?: LogContext): void {
  const timestamp = new Date().toISOString();
  const prefix = context?.source
    ? `${PREFIXES[level]} [${context.source}]`
    : PREFIXES[level];

  const consoleFn = CONSOLE_METHODS[level];

  // Build a structured payload — useful when we pipe to Sentry later
  const payload: Record<string, unknown> = {
    timestamp,
    message,
    ...(context?.source && { source: context.source }),
    ...(context?.meta && { meta: context.meta }),
  };

  // Production-friendly: always keep console output, add structured data
  consoleFn(prefix, message, context?.meta ?? '');

  // ── Sentry integration point ──────────────────────────────────────
  // When @sentry/angular or @sentry/react is added, import it here and
  // call Sentry.captureException / Sentry.captureMessage with the same
  // payload so every log is tracked in one place.
  // if (level === 'error' && typeof Sentry !== 'undefined') {
  //   Sentry.withScope(scope => {
  //     if (context?.source) scope.setTag('source', context.source);
  //     if (context?.meta) scope.setExtras(context.meta);
  //     Sentry.captureException(new Error(message), scope);
  //   });
  // }
}

/** Log an error with optional source and metadata */
export function logError(message: string, context?: LogContext): void {
  log('error', message, context);
}

/** Log a warning with optional source and metadata */
export function logWarning(message: string, context?: LogContext): void {
  log('warn', message, context);
}

/** Log an informational message with optional source and metadata */
export function logInfo(message: string, context?: LogContext): void {
  log('info', message, context);
}
