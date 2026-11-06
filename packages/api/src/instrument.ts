import { redactSensitive } from './redact.ts';
import * as Sentry from '@sentry/node';
import { config } from './config.ts';

// Error monitoring. Must be imported before the rest of the server so
// Sentry's default integrations (uncaught exceptions, unhandled rejections)
// register first. Entirely a no-op unless SENTRY_DSN is set — every
// Sentry.capture* call is safe to make when init was never called.
export const sentryEnabled = Boolean(config.sentryDsn);

if (sentryEnabled) {
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    beforeSend: event => redactSensitive(event) as typeof event,
    // Errors only — tracing stays off so enabling monitoring never adds
    // per-request overhead or surprise event volume.
    tracesSampleRate: 0,
    // The server ships as a single esbuild bundle, so OpenTelemetry's
    // module-load hooks can't instrument express anyway (it logs a
    // "express is not instrumented" warning at boot). Error capture —
    // the pino hook, setupExpressErrorHandler, process-level handlers —
    // doesn't need OTel at all.
    skipOpenTelemetrySetup: true,
  });
}

export { Sentry };
