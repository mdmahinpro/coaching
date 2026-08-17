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

const CONSOLE_METHODS: Record<LogLevel, keyof Console> = {
  error: 'error',
  warn: 'warn',
  info: 'info',
};

const PREFIXES: Record<LogLevel, string> = {
  error: '[Error]',
  warn: '[Warning]',
  info: '[Info]',
};

// ── Pluggable error-tracking sink ─────────────────────────────────────
// Stays a no-op until initErrorTracking() wires in a real provider
// (e.g. Sentry). This keeps console behaviour unchanged for tests while
// giving production a single place to ship errors to.
type ErrorSink = (message: string, context?: LogContext) => void;
let errorSink: ErrorSink | null = null;

// Minimal shape of the bits of @sentry/react we call. Declared locally so the
// build never needs the package's type declarations to be installed.
interface SentryLike {
  init(options: {
    dsn: string;
    environment: string;
    tracesSampleRate: number;
  }): void;
  captureException(
    error: unknown,
    hint?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
  ): void;
}

/**
 * Initialise production error tracking. Called once from main.tsx.
 * Loads Sentry lazily and only when VITE_SENTRY_DSN is set, so builds
 * without the dependency (or without a DSN) are completely unaffected.
 */
export async function initErrorTracking(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn || !import.meta.env.PROD) {
    return;
  }
  try {
    // Specifier kept in a variable so TS/Vite don't hard-resolve an optional dep.
    const mod = '@sentry/react';
    const Sentry = (await import(/* @vite-ignore */ mod)) as unknown as SentryLike;
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
    });
    errorSink = (message, context) => {
      Sentry.captureException(new Error(message), {
        tags: context?.source ? { source: context.source } : undefined,
        extra: context?.meta,
      });
    };
  } catch {
    // @sentry/react not installed — tracking stays disabled.
  }
}

/**
 * Core log function — writes to console now, single swap point for Sentry.
 */
function log(level: LogLevel, message: string, context?: LogContext): void {
  const timestamp = new Date().toISOString();
  const prefix = context?.source ? `${PREFIXES[level]} [${context.source}]` : PREFIXES[level];

  // Use direct console access so test spies on console.error/warn/log work
  const consoleFn = console[CONSOLE_METHODS[level]] as (...args: unknown[]) => void;

  // Build a structured payload — useful when we pipe to Sentry later
  const _payload: Record<string, unknown> = {
    timestamp,
    message,
    ...(context?.source && { source: context.source }),
    ...(context?.meta && { meta: context.meta }),
  };

  // Production-friendly: always keep console output, add structured data
  consoleFn(prefix, message, context?.meta ?? '');

  // Ship errors to the configured tracking sink (Sentry) when present.
  if (level === 'error' && errorSink) {
    errorSink(message, context);
  }
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
