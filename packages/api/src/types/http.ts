import type { Request as ExpressRequest } from 'express';

// All application routes use named scalar parameters, never Express wildcard arrays.
export type Request = ExpressRequest<Record<string, string>>;
