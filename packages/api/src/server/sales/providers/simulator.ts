// ─────────────────────────────────────────────────────────────────────────────
// The simulator provider.
//
// Drives the full queue → dial → webhook → conversation → analysis → follow-up
// loop with no network and no spend. This is not a toy: it is how the sales
// brain is verified before a real number is ever dialed, and how the webhook
// path stays testable afterwards.
//
// Outcomes are chosen deterministically from the attempt id so a given attempt
// always replays identically — a flaky simulator would be worse than none.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';
import type { AttemptOutcome } from '../types.ts';
import type { CallEvent, CallProvider, PlaceCallRequest } from './index.ts';

/** Roughly the distribution of a real cold-calling list. */
const OUTCOME_TABLE: { outcome: AttemptOutcome; weight: number }[] = [
  { outcome: 'answered', weight: 30 },
  { outcome: 'no_answer', weight: 40 },
  { outcome: 'voicemail', weight: 15 },
  { outcome: 'busy', weight: 8 },
  { outcome: 'rejected', weight: 7 },
];

const SAMPLE_TRANSCRIPTS: Record<string, string> = {
  answered: `AI: Hi, this is an AI assistant calling. Do you have a quick minute?
Customer: Uh, sure, what's this about?
AI: We help teams like yours get their marketing content out consistently without hiring an agency. Is that something you handle at the moment?
Customer: Yeah, I do it myself, and honestly it's a mess. But I'll be straight with you, we looked at tools like this before and they were way out of our budget.
AI: That's fair. What did the pricing look like when you last checked?
Customer: A few hundred a month, which for a team our size is a lot.
AI: Understood. Can I send you our pricing so you can see where we land? It's meaningfully lower than that.
Customer: Sure, send it over. Actually — can you call me Thursday afternoon instead? I'll have looked at it by then.
AI: Thursday afternoon works. I'll send the pricing today and call you then. Thanks for your time.
Customer: Great, thanks.`,
  rejected: `AI: Hi, this is an AI assistant calling. Do you have a quick minute?
Customer: No, I'm not interested. Please take me off your list.
AI: Understood, I'll make sure you're not contacted again. Sorry to have bothered you.`,
  voicemail: `[Voicemail greeting detected. No conversation took place.]`,
};

function hashToUnit(input: string): number {
  const digest = createHash('sha256').update(input).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

export function simulateOutcome(attemptId: string): AttemptOutcome {
  const total = OUTCOME_TABLE.reduce((sum, o) => sum + o.weight, 0);
  let point = hashToUnit(attemptId) * total;
  for (const entry of OUTCOME_TABLE) {
    point -= entry.weight;
    if (point <= 0) return entry.outcome;
  }
  return 'no_answer';
}

export class SimulatorProvider implements CallProvider {
  readonly id = 'simulator';

  isConfigured(): boolean {
    return true;
  }

  async placeCall(req: PlaceCallRequest): Promise<{ externalId: string }> {
    return { externalId: `sim_${req.metadata.attemptId}` };
  }

  verifySignature(): boolean {
    return true;
  }

  normalizeWebhook(body: unknown): CallEvent {
    const b = (body ?? {}) as Record<string, any>;
    const externalId = String(b.externalId || b.id || '');
    if (!externalId) return { kind: 'ignored' };
    if (b.kind === 'started') return { kind: 'started', externalId, at: new Date() };

    const attemptId = externalId.replace(/^sim_/, '');
    const outcome: AttemptOutcome = b.outcome || simulateOutcome(attemptId);
    const answered = outcome === 'answered' || outcome === 'rejected';
    return {
      kind: 'ended',
      externalId,
      at: new Date(),
      durationSec: answered ? 95 : outcome === 'voicemail' ? 22 : 0,
      outcome,
      recordingUrl: null,
      transcript: b.transcript ?? SAMPLE_TRANSCRIPTS[outcome] ?? null,
      endedReason: `simulated:${outcome}`,
    };
  }

  async cancelCall(): Promise<void> {
    /* nothing to cancel */
  }

  /** Builds the webhook body this provider's own dial would produce. */
  buildCompletionWebhook(attemptId: string, override?: Partial<{ outcome: AttemptOutcome; transcript: string }>) {
    return {
      externalId: `sim_${attemptId}`,
      outcome: override?.outcome ?? simulateOutcome(attemptId),
      transcript: override?.transcript,
    };
  }
}
