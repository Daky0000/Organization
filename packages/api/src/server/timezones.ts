// ─────────────────────────────────────────────────────────────────────────────
// Pure IANA-timezone helpers built on Intl — no date library.
//
// Shared by autopilot scheduling and Sales reminders. Keep this file free of
// imports so anything can use it without pulling a feature module along.
// ─────────────────────────────────────────────────────────────────────────────

export function isValidIanaTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of a UTC instant in `tz`. weekday: 0=Sunday … 6=Saturday. */
export function zonedParts(utcMs: number, tz: string): {
  year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const raw = Object.fromEntries(
    fmt.formatToParts(new Date(utcMs)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(raw.year), month: Number(raw.month), day: Number(raw.day),
    hour: Number(raw.hour), minute: Number(raw.minute), second: Number(raw.second),
    weekday: WEEKDAYS.indexOf(raw.weekday),
  };
}

function zoneOffsetMs(utcMs: number, tz: string): number {
  const p = zonedParts(utcMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

export type ZonedLocalResult =
  | { ok: true; iso: string; ambiguous: boolean }
  | { ok: false; reason: 'invalid_format' | 'invalid_timezone' | 'dst_gap' };

/**
 * Converts a wall-clock time ("YYYY-MM-DDTHH:mm[:ss]") in an IANA zone to a UTC
 * instant. A time that does not exist (spring-forward gap) is rejected; an
 * ambiguous one (fall-back) takes the earlier instant and says so.
 */
export function resolveZonedLocal(local: string, tz: string): ZonedLocalResult {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(local || '').trim());
  if (!m) return { ok: false, reason: 'invalid_format' };
  if (!isValidIanaTimezone(tz)) return { ok: false, reason: 'invalid_timezone' };
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const candidates = new Set<number>();
  for (const probe of [wall - 14 * 3600_000, wall, wall + 14 * 3600_000]) {
    const guess = wall - zoneOffsetMs(probe, tz);
    if (guess + zoneOffsetMs(guess, tz) === wall) candidates.add(guess);
  }
  const valid = [...candidates].sort((a, b) => a - b);
  if (!valid.length) return { ok: false, reason: 'dst_gap' };
  return { ok: true, iso: new Date(valid[0]).toISOString(), ambiguous: valid.length > 1 };
}

/** "YYYY-MM-DD" of a UTC instant as seen in `tz`. */
export function zonedDateKey(utcMs: number, tz: string): string {
  const p = zonedParts(utcMs, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
