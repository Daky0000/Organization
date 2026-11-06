// ─────────────────────────────────────────────────────────────────────────────
// CallProvider — the seam between the sales OS and whoever moves the audio.
//
// Everything downstream of a call (conversation records, analysis, follow-ups,
// timing) is provider-blind. Vapi is the default, but the simulator exists so
// the entire loop can be exercised end-to-end in a test with no network and no
// per-minute spend — which is what makes the brain shippable before the caller.
// ─────────────────────────────────────────────────────────────────────────────

import type { AttemptOutcome } from '../types.ts';

export interface PlaceCallRequest {
  toNumber: string;
  fromNumber: string | null;
  /** Opening line, with mandatory disclosures already prepended. */
  firstMessage: string;
  /** The compiled call brief. */
  systemPrompt: string;
  voiceId: string | null;
  maxDurationSec: number;
  recordingEnabled: boolean;
  /** Round-tripped by the provider so the webhook can find its attempt row. */
  metadata: { attemptId: string; userId: string; contactId: string };
}

export type CallEvent =
  | { kind: 'started'; externalId: string; at: Date }
  | {
      kind: 'ended';
      externalId: string;
      at: Date;
      durationSec: number;
      outcome: AttemptOutcome;
      recordingUrl?: string | null;
      transcript?: string | null;
      endedReason?: string | null;
    }
  | { kind: 'failed'; externalId: string; error: string }
  /** Deliveries we recognize but do not act on (status pings, partial updates). */
  | { kind: 'ignored' };

export interface ProviderConfig {
  /**
   * PRIVATE key. Server-side only: places calls, reads phone numbers, full org
   * access. Never send this to a browser, put it in a log, or return it from an
   * API response.
   */
  apiKey: string;
  /**
   * PUBLIC key. Browser-safe by design — used by the Web SDK to start an
   * in-browser test call. It is still a credential: restrict it by allowed
   * origin and by assistant in the Vapi dashboard.
   */
  publicKey?: string | null;
  phoneNumberId?: string | null;
  webhookSecret?: string | null;
  assistantId?: string | null;
}

export interface CallProvider {
  readonly id: string;
  /** True when the provider has everything it needs to actually dial. */
  isConfigured(): boolean;
  placeCall(req: PlaceCallRequest): Promise<{ externalId: string }>;
  verifySignature(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean;
  normalizeWebhook(body: unknown): CallEvent;
  cancelCall(externalId: string): Promise<void>;
}

export { SimulatorProvider } from './simulator.ts';
export { VapiProvider, mapVapiEndedReason } from './vapi.ts';
