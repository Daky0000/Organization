/**
 * The lead pages UI primitives, unified with the canonical DakyXTech Design System v21/v22.
 */

import { type ReactNode } from "react";
import { leadsUi } from "../lib/config";
import {
  PageHeader as BasePageHeader,
  Card as BaseCard,
  Badge as BaseBadge,
  Button as BaseButton,
  EmptyState as BaseEmptyState,
  Field as BaseField,
  StatTile as BaseStatTile,
  ScoreBar as BaseScoreBar,
  RelativeTime as BaseRelativeTime,
  Drawer as BaseDrawer,
  StatusDot as BaseStatusDot,
  Notice,
} from "../../ui";

export const PageHeader = BasePageHeader;
export const Card = BaseCard;
export const Badge = BaseBadge;
export const Button = BaseButton;
export const EmptyState = BaseEmptyState;
export const Field = BaseField;
export const StatTile = BaseStatTile;
export const ScoreBar = BaseScoreBar;
export const RelativeTime = BaseRelativeTime;
export const Drawer = BaseDrawer;
export const StatusDot = BaseStatusDot;

/** The module's own links, styled like a DakyXTech secondary button. */
export function LinkButton({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a
      href={to}
      className="os-button inline-flex items-center justify-center gap-2 rounded-[10px] border border-line-2 bg-white px-4 py-2.5 text-[13px] font-medium text-ink transition hover:border-ink/40 hover:bg-sunken"
    >
      {children}
    </a>
  );
}

export function Money({ amount, currency }: { amount: number | string; currency?: string }) {
  const code = currency ?? leadsUi().currency;
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return <span className="text-faint">—</span>;
  return (
    <span>
      {code} {n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!(error instanceof Error)) return null;
  return <Notice tone="danger">{error.message}</Notice>;
}
