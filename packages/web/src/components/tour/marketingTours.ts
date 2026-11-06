import type { Tour } from './tourCore';

// ─────────────────────────────────────────────────────────────────────────────
// Marketing is big, so it gets one short tour per tool rather than one long
// tour of everything. Each tour runs on its own page, points at the real
// controls (data-tour="…" in the page), and says only what the tool does.
//
// MARKETING_SETUP_ORDER is the order to set things up in: people first, then
// the ways to reach them, then measuring.
// ─────────────────────────────────────────────────────────────────────────────

// Tours for the removed email/campaign/survey/forms/leads tools were dropped.
// Add tours for this product's pages here.
export const MARKETING_TOURS: Record<string, Tour> = {};

export const MARKETING_SETUP_ORDER: Array<{ tour: string; why: string }> = [];
