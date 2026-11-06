// ─────────────────────────────────────────────────────────────────────────────
// Vapi provider.
//
// Vapi owns the hard real-time loop — telephony, speech-to-text, turn-taking,
// barge-in, text-to-speech — and reports back once with an end-of-call report.
// We supply a transient assistant per call (the compiled brief as the system
// message) rather than a stored assistant, because the brief is different for
// every lead and every objective.
//
// metadata round-trips through Vapi untouched, which is how the webhook finds
// its sales_call_attempts row. Combined with the partial unique index on
// (provider, external_id), redelivery is idempotent — and Vapi does redeliver.
//
// Docs: https://docs.vapi.ai/api-reference/calls/create
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from 'crypto';
import axios from 'axios';
import { logger } from '../../../logger.ts';
import type { AttemptOutcome } from '../types.ts';
import type { CallEvent, CallProvider, PlaceCallRequest, ProviderConfig } from './index.ts';

const VAPI_API = 'https://api.vapi.ai';

/**
 * Map Vapi's endedReason onto our outcome vocabulary.
 *
 * `durationSec` is the tiebreaker: Vapi reports several reasons that can mean
 * either "a person talked to us" or "we hung up on silence", and a call with
 * real duration and a transcript is an answer regardless of how it ended.
 */
export function mapVapiEndedReason(reason: string | null | undefined, durationSec = 0): AttemptOutcome {
  const r = String(reason ?? '').toLowerCase();

  if (!r) return durationSec > 15 ? 'answered' : 'no_answer';

  if (r.includes('did-not-answer') || r.includes('no-answer')) return 'no_answer';
  if (r.includes('busy')) return 'busy';
  if (r.includes('voicemail')) return 'voicemail';
  // Vapi surfaces carrier-level failures with a twilio/telnyx prefix.
  if (r.includes('invalid-number') || r.includes('invalid-destination') || r.includes('does-not-exist')) {
    return 'invalid_number';
  }
  if (r.includes('failed-to-connect') || r.includes('pipeline-error') || r.startsWith('twilio-') || r.startsWith('telnyx-')) {
    return 'failed';
  }
  if (r.includes('silence-timed-out')) {
    // Connected but nobody ever spoke — an answering machine or a dead line.
    return durationSec > 20 ? 'voicemail' : 'no_answer';
  }
  if (r.includes('customer-ended') || r.includes('assistant-ended') || r.includes('end-call-phrase') || r.includes('assistant-forwarded')) {
    return durationSec > 10 ? 'answered' : 'no_answer';
  }
  if (r.includes('exceeded-max-duration')) return 'answered';

  return durationSec > 15 ? 'answered' : 'failed';
}

/** Flatten Vapi's structured message list into readable dialogue. */
function extractTranscript(artifact: Record<string, any> | undefined): string | null {
  if (!artifact) return null;
  if (typeof artifact.transcript === 'string' && artifact.transcript.trim()) {
    return artifact.transcript.trim();
  }
  const messages = artifact.messages;
  if (!Array.isArray(messages)) return null;
  const lines = messages
    .filter((m: any) => m && (m.role === 'user' || m.role === 'bot' || m.role === 'assistant') && m.message)
    .map((m: any) => `${m.role === 'user' ? 'Customer' : 'AI'}: ${String(m.message).trim()}`);
  return lines.length ? lines.join('\n') : null;
}

export class VapiProvider implements CallProvider {
  readonly id = 'vapi';

  constructor(private readonly cfg: ProviderConfig) {}

  isConfigured(): boolean {
    return Boolean(this.cfg.apiKey && this.cfg.phoneNumberId);
  }

  /**
   * The transient assistant definition. Shared by outbound phone calls (placed
   * server-side with the PRIVATE key) and browser test calls (started by the
   * Web SDK with the PUBLIC key), so a developer testing in the browser is
   * exercising the same agent that will dial a lead — not an approximation.
   */
  buildAssistant(req: Pick<PlaceCallRequest, 'firstMessage' | 'systemPrompt' | 'voiceId' | 'maxDurationSec' | 'recordingEnabled'>): Record<string, unknown> {
    const assistant: Record<string, unknown> = {
      firstMessage: req.firstMessage,
      maxDurationSeconds: req.maxDurationSec,
      model: {
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        messages: [{ role: 'system', content: req.systemPrompt }],
      },
      // Ending on silence keeps a voicemail from burning the full duration.
      silenceTimeoutSeconds: 30,
      recordingEnabled: req.recordingEnabled,
    };
    if (req.voiceId) {
      assistant.voice = { provider: '11labs', voiceId: req.voiceId };
    }
    return assistant;
  }

  /**
   * Verify the private key and report what it can reach. Setup is otherwise
   * guesswork — a wrong key or a phone number ID from the wrong org fails
   * silently at 3am on the first real call instead of here.
   */
  async checkCredentials(): Promise<{
    ok: boolean;
    error?: string;
    phoneNumbers: { id: string; number: string | null; name: string | null }[];
    phoneNumberIdValid: boolean;
    hasPublicKey: boolean;
  }> {
    const base = { phoneNumbers: [], phoneNumberIdValid: false, hasPublicKey: Boolean(this.cfg.publicKey) };
    if (!this.cfg.apiKey) return { ...base, ok: false, error: 'No private API key configured' };
    try {
      const { data } = await axios.get(`${VAPI_API}/phone-number`, {
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
        timeout: 15_000,
      });
      const phoneNumbers = (Array.isArray(data) ? data : []).map((p: any) => ({
        id: String(p.id),
        number: p.number ?? null,
        name: p.name ?? null,
      }));
      return {
        ok: true,
        phoneNumbers,
        phoneNumberIdValid: Boolean(this.cfg.phoneNumberId) && phoneNumbers.some((p) => p.id === this.cfg.phoneNumberId),
        hasPublicKey: Boolean(this.cfg.publicKey),
      };
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.message || err?.message;
      if (status === 401 || status === 403) {
        return { ...base, ok: false, error: 'Vapi rejected the private key' };
      }
      return { ...base, ok: false, error: `Could not reach Vapi: ${detail || 'unknown error'}` };
    }
  }

  /** The browser-safe key, for the Web SDK. Never returns the private key. */
  getPublicKey(): string | null {
    return this.cfg.publicKey || null;
  }

  async placeCall(req: PlaceCallRequest): Promise<{ externalId: string }> {
    return this.placeCallWithAssistant({
      toNumber: req.toNumber,
      assistant: this.buildAssistant(req),
      metadata: req.metadata,
    });
  }

  async placeCallWithAssistant(params: {
    toNumber: string;
    assistant: Record<string, unknown>;
    metadata: { attemptId: string; userId: string; contactId: string };
  }): Promise<{ externalId: string }> {
    if (!this.isConfigured()) {
      throw new Error('Vapi is not configured — a private API key and phone number ID are required');
    }

    try {
      const { data } = await axios.post(
        `${VAPI_API}/call`,
        {
          phoneNumberId: this.cfg.phoneNumberId,
          customer: { number: params.toNumber },
          assistant: params.assistant,
          metadata: params.metadata,
        },
        {
          headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json' },
          timeout: 20_000,
        },
      );
      const externalId = data?.id;
      if (!externalId) throw new Error('Vapi accepted the call but returned no id');
      return { externalId: String(externalId) };
    } catch (err: any) {
      const detail = err?.response?.data?.message || err?.response?.data?.error || err?.message;
      const status = err?.response?.status;
      logger.error({ status, detail }, 'vapi_place_call_failed');
      // A private key used here is the usual cause of a 401 — the public key
      // cannot place calls, which is the single most common setup mistake.
      if (status === 401 || status === 403) {
        throw new Error('Vapi rejected the key. Placing calls requires the PRIVATE key, not the public one.');
      }
      if (status === 400) throw new Error(`Vapi rejected the call: ${detail}`);
      throw new Error(`Vapi call failed: ${detail || 'unknown error'}`);
    }
  }

  /**
   * Vapi authenticates webhooks with either a shared secret header or an HMAC
   * signature, depending on how the server URL is configured. Support both, and
   * refuse everything when no secret is set rather than accepting anonymous
   * posts that can write conversation records.
   */
  verifySignature(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean {
    const secret = this.cfg.webhookSecret;
    if (!secret) return false;

    const header = (name: string): string => {
      const v = headers[name] ?? headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] ?? '' : String(v ?? '');
    };

    const shared = header('x-vapi-secret');
    if (shared) {
      const a = Buffer.from(shared);
      const b = Buffer.from(secret);
      return a.length === b.length && timingSafeEqual(a, b);
    }

    const signature = header('x-vapi-signature');
    if (signature) {
      const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
      const a = Buffer.from(signature.replace(/^sha256=/, ''));
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    }

    return false;
  }

  normalizeWebhook(body: unknown): CallEvent {
    const message = ((body as any)?.message ?? {}) as Record<string, any>;
    const type = String(message.type ?? '');
    const call = (message.call ?? {}) as Record<string, any>;
    const externalId = String(call.id ?? message.callId ?? '');

    if (!externalId) return { kind: 'ignored' };

    if (type === 'status-update') {
      const status = String(message.status ?? '');
      if (status === 'in-progress') return { kind: 'started', externalId, at: new Date() };
      return { kind: 'ignored' };
    }

    if (type !== 'end-of-call-report') return { kind: 'ignored' };

    const artifact = (message.artifact ?? {}) as Record<string, any>;
    const durationSec = Math.max(
      0,
      Math.round(Number(message.durationSeconds ?? message.duration ?? 0)) || 0,
    );
    const endedReason = message.endedReason ?? call.endedReason ?? null;

    return {
      kind: 'ended',
      externalId,
      at: message.endedAt ? new Date(message.endedAt) : new Date(),
      durationSec,
      outcome: mapVapiEndedReason(endedReason, durationSec),
      recordingUrl: artifact.recordingUrl ?? artifact.stereoRecordingUrl ?? message.recordingUrl ?? null,
      transcript: extractTranscript(artifact),
      endedReason: endedReason ? String(endedReason) : null,
    };
  }

  async cancelCall(externalId: string): Promise<void> {
    if (!this.cfg.apiKey) return;
    await axios
      .delete(`${VAPI_API}/call/${externalId}`, {
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
        timeout: 10_000,
      })
      .catch((err) => logger.warn({ err: err?.message, externalId }, 'vapi_cancel_failed'));
  }
}
