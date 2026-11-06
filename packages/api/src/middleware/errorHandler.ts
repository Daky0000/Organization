import type { Response, NextFunction } from 'express';
import type { Request } from '../types/http.ts';
import { config } from '../config.ts';
import { logger } from '../logger.ts';

type HttpError = { type?: string; status?: number; statusCode?: number; message?: string };

function deriveStatus(err: unknown): number {
  const e = err as HttpError;
  if (e?.type === 'entity.too.large') return 413;
  if (e?.type === 'entity.parse.failed') return 400;
  if (typeof e?.status === 'number') return e.status;
  if (typeof e?.statusCode === 'number') return e.statusCode;
  return 500;
}

function deriveMessage(err: unknown, status: number): string {
  if (status === 413) return 'Request too large';
  if (status === 400) return 'Invalid JSON payload';
  // Never leak internal error messages to clients in production
  if (status >= 500 && config.nodeEnv === 'production') return 'Internal server error';
  return err instanceof Error ? err.message : 'Internal server error';
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;

  const status = deriveStatus(err);
  const message = deriveMessage(err, status);

  if (status >= 500) {
    logger.error(
      {
        method: req.method,
        url: req.originalUrl,
        status,
        // Log the real message server-side even though we hide it from clients
        internalMessage: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      'request_error',
    );
  }

  // Consistent error shape across all routes: { success: false, error: string }
  res.status(status).json({ success: false, error: message });
}
