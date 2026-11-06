import { redactSensitive } from './redact.ts';
import pino from 'pino';
import * as Sentry from '@sentry/node';

// Most failures in this codebase are caught and logged rather than thrown, so
// hooking error/fatal logs is what actually gets them into monitoring.
// Sentry.capture* is a safe no-op when SENTRY_DSN is unset (init never ran).
function forwardToSentry(args: unknown[]) {
  try {
    const first = args[0] as any;
    const error =
      args.find((a): a is Error => a instanceof Error) ??
      (first && typeof first === 'object' && first.err instanceof Error ? (first.err as Error) : undefined);
    if (error) {
      Sentry.captureException(error, { extra: { logArgs: args.filter((a) => a !== error) } });
      return;
    }
    const msg = args
      .map((a) => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch { return String(a); }
      })
      .join(' ');
    if (msg) Sentry.captureMessage(msg.slice(0, 500), 'error');
  } catch {
    // never let monitoring break logging
  }
}

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  hooks: {
    logMethod(inputArgs, method, level) {
      const safeArgs=inputArgs.map(value=>redactSensitive(value));
      if (level >= 50) forwardToSentry(safeArgs);
      return method.apply(this, safeArgs as Parameters<typeof method>);
    },
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
    ],
    remove: true,
  },
});

// Normalize legacy message-first calls so errors remain structured and visible.
function log(level: 'debug' | 'info' | 'warn' | 'error' | 'fatal', args: unknown[]) {
  const [first, ...rest] = args;
  if (typeof first === 'string') {
    const error = rest.find(value => value instanceof Error);
    baseLogger[level]({ ...(error ? { err: error } : {}), ...(rest.length && !error ? { details: rest } : {}) }, first);
  } else {
    baseLogger[level](first && typeof first === 'object' ? first : { value: first }, typeof rest[0] === 'string' ? rest[0] : undefined);
  }
}
export const logger = {
  debug: (...args: unknown[]) => log('debug', args),
  info: (...args: unknown[]) => log('info', args),
  warn: (...args: unknown[]) => log('warn', args),
  error: (...args: unknown[]) => log('error', args),
  fatal: (...args: unknown[]) => log('fatal', args),
};
