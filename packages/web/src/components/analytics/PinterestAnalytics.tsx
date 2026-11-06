import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  ExternalLink,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  MousePointerClick,
  Pin,
  Plus,
  RefreshCcw,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  pinterestAnalyticsService,
  type PinterestBoard,
  type PinterestBoardPerformance,
  type PinterestDefaultBoard,
  type PinterestPin,
  type PinterestPinsSummary,
  type PinterestProfileResponse,
} from '../../services/pinterestAnalyticsService';
import { formatCompactNumber, formatPercent, formatShortDate } from './analyticsUtils';

type Props = {
  days: number;
};

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</div>
          <div className="mt-2 text-2xl font-black tracking-tight text-slate-950">{value}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">{icon}</div>
      </div>
    </div>
  );
}

const fmtNumber = (value: number | string | null | undefined) =>
  value !== null && value !== undefined && value !== '' ? formatCompactNumber(value) : 'N/A';

function guessPinterestPinUrl(pinId: string) {
  return `https://www.pinterest.com/pin/${encodeURIComponent(pinId)}/`;
}

type BoardOption = {
  id: string;
  name: string;
  perf: PinterestBoardPerformance | null;
};

export default function PinterestAnalytics({ days }: Props) {
  const [profile, setProfile] = useState<PinterestProfileResponse | null>(null);
  const [overviewPins, setOverviewPins] = useState<PinterestPin[]>([]);
  const [overviewSummary, setOverviewSummary] = useState<PinterestPinsSummary | null>(null);
  const [boards, setBoards] = useState<PinterestBoard[]>([]);
  const [boardsPerf, setBoardsPerf] = useState<PinterestBoardPerformance[]>([]);
  const [defaultBoard, setDefaultBoard] = useState<PinterestDefaultBoard | null>(null);

  const [selectedBoardId, setSelectedBoardId] = useState<string>('all');
  const [boardPins, setBoardPins] = useState<PinterestPin[]>([]);
  const [boardSummary, setBoardSummary] = useState<PinterestPinsSummary | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; errors?: string[] } | null>(null);
  const [savingDefault, setSavingDefault] = useState(false);
  const [boardsLoadError, setBoardsLoadError] = useState<string | null>(null);

  const [createBoardOpen, setCreateBoardOpen] = useState(false);
  const [createBoardName, setCreateBoardName] = useState('');
  const [createBoardDescription, setCreateBoardDescription] = useState('');
  const [createBoardSecret, setCreateBoardSecret] = useState(false);
  const [createBoardSetDefault, setCreateBoardSetDefault] = useState(true);
  const [createBoardError, setCreateBoardError] = useState<string | null>(null);
  const [createBoardLoading, setCreateBoardLoading] = useState(false);

  const boardNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of boards) {
      const id = String(b?.id || '').trim();
      const name = String(b?.name || '').trim();
      if (id) map.set(id, name || id);
    }
    for (const p of boardsPerf) {
      const id = String(p?.board_id || '').trim();
      const name = p?.board_name ? String(p.board_name).trim() : '';
      if (id && name && !map.has(id)) map.set(id, name);
    }
    return map;
  }, [boards, boardsPerf]);

  const perfByBoardId = useMemo(() => {
    const map = new Map<string, PinterestBoardPerformance>();
    for (const p of boardsPerf) {
      const id = String(p?.board_id || '').trim();
      if (id) map.set(id, p);
    }
    return map;
  }, [boardsPerf]);

  const boardOptions = useMemo((): BoardOption[] => {
    const ids = new Set<string>();
    for (const b of boards) {
      const id = String(b?.id || '').trim();
      if (id) ids.add(id);
    }
    for (const p of boardsPerf) {
      const id = String(p?.board_id || '').trim();
      if (id) ids.add(id);
    }

    const options = Array.from(ids).map((id) => {
      const name = boardNameById.get(id) || `Board ${id.slice(0, 6)}`;
      const perf = perfByBoardId.get(id) || null;
      return { id, name, perf };
    });

    options.sort((a, b) => {
      const ai = a.perf?.total_impressions ?? 0;
      const bi = b.perf?.total_impressions ?? 0;
      if (bi !== ai) return bi - ai;
      return a.name.localeCompare(b.name);
    });

    return options;
  }, [boardNameById, boards, boardsPerf, perfByBoardId]);

  const selectedBoardName = useMemo(() => {
    if (selectedBoardId === 'all') return 'All boards';
    return boardOptions.find((b) => b.id === selectedBoardId)?.name || `Board ${selectedBoardId.slice(0, 6)}`;
  }, [boardOptions, selectedBoardId]);

  const activePins = selectedBoardId === 'all' ? overviewPins : boardPins;
  const activeSummary = selectedBoardId === 'all' ? overviewSummary : boardSummary;

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBoardsLoadError(null);
    try {
      const [profileResult, pinsResult] = await Promise.all([
        pinterestAnalyticsService.getProfile(),
        pinterestAnalyticsService.getPins({ days, limit: 200 }),
      ]);

      const boardsPromise = pinterestAnalyticsService
        .getBoards()
        .then((value) => ({ ok: true as const, value }))
        .catch((err) => ({ ok: false as const, err }));

      const [perfResult, boardsOutcome, defaultResult] = await Promise.all([
        pinterestAnalyticsService.getBoardsPerformance(days).catch(() => ({ success: true, boards: [], days } as any)),
        boardsPromise,
        pinterestAnalyticsService.getDefaultBoard().catch(() => null),
      ]);

      setProfile(profileResult);
      setOverviewPins(pinsResult.pins);
      setOverviewSummary(pinsResult.summary);
      setBoardsPerf(Array.isArray((perfResult as any)?.boards) ? (perfResult as any).boards : []);
      if (boardsOutcome.ok) {
        setBoards(Array.isArray((boardsOutcome.value as any)?.boards) ? (boardsOutcome.value as any).boards : []);
      } else {
        setBoards([]);
        const message = boardsOutcome.err instanceof Error ? boardsOutcome.err.message : 'Failed to load boards';
        setBoardsLoadError(message);
      }
      setDefaultBoard(defaultResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Pinterest analytics');
    } finally {
      setLoading(false);
    }
  }, [days]);

  const fetchBoard = useCallback(async (boardId: string) => {
    if (!boardId || boardId === 'all') return;
    setBoardLoading(true);
    setBoardError(null);
    try {
      const result = await pinterestAnalyticsService.getPins({ days, limit: 100, boardId });
      setBoardPins(result.pins);
      setBoardSummary(result.summary);
    } catch (err) {
      setBoardPins([]);
      setBoardSummary(null);
      setBoardError(err instanceof Error ? err.message : 'Failed to load board performance');
    } finally {
      setBoardLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  useEffect(() => {
    if (selectedBoardId === 'all') {
      setBoardPins([]);
      setBoardSummary(null);
      setBoardError(null);
      return;
    }
    void fetchBoard(selectedBoardId);
  }, [fetchBoard, selectedBoardId]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await pinterestAnalyticsService.sync();
      setSyncResult(result);
      await fetchOverview();
      if (selectedBoardId !== 'all') await fetchBoard(selectedBoardId);
    } catch (err) {
      setSyncResult({ synced: 0, errors: [err instanceof Error ? err.message : 'Sync failed'] });
    } finally {
      setSyncing(false);
    }
  };

  const handleSetDefaultBoard = async () => {
    if (selectedBoardId === 'all') return;
    setSavingDefault(true);
    try {
      await pinterestAnalyticsService.setDefaultBoard({ id: selectedBoardId, name: selectedBoardName });
      setDefaultBoard({ id: selectedBoardId, name: selectedBoardName });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save default board');
    } finally {
      setSavingDefault(false);
    }
  };

  const openCreateBoard = () => {
    setCreateBoardName('');
    setCreateBoardDescription('');
    setCreateBoardSecret(false);
    setCreateBoardSetDefault(true);
    setCreateBoardError(null);
    setCreateBoardOpen(true);
  };

  const handleCreateBoard = async () => {
    const name = createBoardName.trim();
    if (!name) {
      setCreateBoardError('Board name is required');
      return;
    }

    setCreateBoardLoading(true);
    setCreateBoardError(null);
    try {
      const board = await pinterestAnalyticsService.createBoard({
        name,
        description: createBoardDescription.trim() ? createBoardDescription.trim() : undefined,
        privacy: createBoardSecret ? 'SECRET' : 'PUBLIC',
      });

      setBoardsLoadError(null);

      const updatedBoards = await pinterestAnalyticsService.getBoards().catch(() => ({ success: true, boards: [] as PinterestBoard[] } as any));
      setBoards(Array.isArray((updatedBoards as any)?.boards) ? (updatedBoards as any).boards : []);

      setSelectedBoardId(board.id);

      if (createBoardSetDefault) {
        await pinterestAnalyticsService.setDefaultBoard({ id: board.id, name: board.name });
        setDefaultBoard({ id: board.id, name: board.name });
      }

      setCreateBoardOpen(false);
    } catch (err) {
      setCreateBoardError(err instanceof Error ? err.message : 'Failed to create board');
    } finally {
      setCreateBoardLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading Pinterest analytics...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
    );
  }

  const handleText =
    profile?.handle && profile.handle.trim()
      ? profile.handle.trim().startsWith('@')
        ? profile.handle.trim()
        : `@${profile.handle.trim()}`
      : null;

  const displayName = profile?.account_name || handleText || 'Pinterest';

  const snapshotCards = [
    { label: 'Followers', value: fmtNumber(profile?.followers), icon: <Users size={16} /> },
    { label: 'Monthly Views', value: fmtNumber(profile?.monthly_views), icon: <Eye size={16} /> },
    { label: 'Impressions', value: fmtNumber(overviewSummary?.total_impressions), icon: <TrendingUp size={16} /> },
    { label: 'Saves', value: fmtNumber(overviewSummary?.total_saves), icon: <Bookmark size={16} /> },
    { label: 'Outbound Clicks', value: fmtNumber(overviewSummary?.total_outbound_clicks), icon: <MousePointerClick size={16} /> },
    { label: 'Avg Eng. Rate', value: formatPercent(overviewSummary?.avg_engagement_rate), icon: <TrendingUp size={16} /> },
  ];

  const pinsForDisplay = [...activePins]
    .sort((a, b) => Number(b.impressions || 0) - Number(a.impressions || 0))
    .slice(0, 12);

  const topBoards = boardsPerf.slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-base font-bold text-slate-950">Pinterest Analytics</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {overviewSummary ? `${formatCompactNumber(overviewSummary.total_pins)} pins synced` : `${overviewPins.length} pins loaded`}
          </div>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCcw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing...' : 'Sync Pinterest'}
        </button>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            syncResult.errors?.length
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {syncResult.errors?.length ? (
            <>
              <span className="font-semibold">Sync completed with issues.</span> {syncResult.synced} items synced.
              {syncResult.errors.map((message, index) => (
                <span key={index} className="block mt-1 text-xs">{message}</span>
              ))}
            </>
          ) : (
            <>
              <span className="font-semibold">Sync successful!</span> {syncResult.synced} items updated.
            </>
          )}
        </div>
      )}

      {/* Snapshot */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            {profile?.picture_url ? (
              <img src={profile.picture_url} alt="" className="h-14 w-14 rounded-2xl object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                <Pin size={18} />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Snapshot</div>
              <div className="mt-1 text-xl font-black tracking-tight text-slate-950">{displayName}</div>
              {profile?.account_name && handleText ? (
                <div className="mt-0.5 text-sm text-slate-600">{handleText}</div>
              ) : null}
              {profile?.bio ? (
                <div className="mt-1 text-xs text-slate-500 line-clamp-2">{profile.bio}</div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                {profile?.website ? (
                  <a href={profile.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-rose-600 hover:underline">
                    <ExternalLink size={11} /> Website
                  </a>
                ) : null}
                {profile?.synced_at ? (
                  <span>Last synced {new Date(profile.synced_at).toLocaleString()}</span>
                ) : null}
              </div>
            </div>
          </div>

          {defaultBoard?.id ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Default Board</div>
              <div className="mt-1 font-bold text-slate-900">
                {boardNameById.get(defaultBoard.id) || defaultBoard.name || `Board ${defaultBoard.id.slice(0, 6)}`}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">Used when publishing to Pinterest without a board destination.</div>
            </div>
          ) : null}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {snapshotCards.map((c) => (
            <StatCard key={c.label} label={c.label} value={c.value} icon={c.icon} />
          ))}
        </div>
      </div>

      {/* Board performance */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Boards</div>
            <div className="mt-1 text-base font-bold text-slate-950">Board performance</div>
            <div className="mt-0.5 text-xs text-slate-500">Switch boards to see how each one performs over the last {days} days.</div>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <select
                value={selectedBoardId}
                onChange={(e) => setSelectedBoardId(e.target.value)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-slate-400"
              >
                <option value="all">All boards</option>
                {boardOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}{defaultBoard?.id === b.id ? ' (default)' : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={openCreateBoard}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Plus size={14} /> New board
              </button>
            </div>

            {selectedBoardId !== 'all' ? (
              defaultBoard?.id === selectedBoardId ? (
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                  Default publishing board
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSetDefaultBoard()}
                  disabled={savingDefault}
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {savingDefault ? 'Saving...' : 'Set as default board'}
                </button>
              )
            ) : null}
          </div>
        </div>

        {boardsLoadError ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span className="font-semibold">Couldn&apos;t load boards.</span> {boardsLoadError}{' '}
            <a href="/integrations" className="font-semibold underline">Reconnect Pinterest</a>
          </div>
        ) : null}

        {!defaultBoard?.id ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <span className="font-semibold">Tip:</span> Set a default board for publishing (select a board, then click <span className="font-semibold">Set as default board</span>).
          </div>
        ) : null}

        {selectedBoardId === 'all' ? (
          <div className="mt-5">
            {topBoards.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                <Pin size={32} className="mx-auto mb-3 text-slate-300" />
                <div className="font-semibold text-slate-700">No board performance yet</div>
                <div className="mt-1 text-xs">Click <span className="font-semibold">Sync Pinterest</span> to pull pin metrics, then come back here.</div>
              </div>
            ) : (
              <div className="grid gap-2">
                {topBoards.map((b) => {
                  const name = boardNameById.get(b.board_id) || b.board_name || `Board ${String(b.board_id).slice(0, 6)}`;
                  return (
                    <button
                      key={b.board_id}
                      type="button"
                      onClick={() => setSelectedBoardId(b.board_id)}
                      className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
                        <div className="text-xs text-slate-500">
                          {formatCompactNumber(b.total_pins)} pins · Last activity {b.last_activity ? formatShortDate(b.last_activity) : 'N/A'}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                        <span className="rounded-full bg-slate-100 px-3 py-1">
                          <TrendingUp size={12} className="inline-block mr-1" />
                          {formatCompactNumber(b.total_impressions)} impr.
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1">
                          <Bookmark size={12} className="inline-block mr-1" />
                          {formatCompactNumber(b.total_saves)} saves
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1">
                          <MousePointerClick size={12} className="inline-block mr-1" />
                          {formatCompactNumber(b.total_outbound_clicks)} clicks
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1">
                          {formatPercent(b.engagement_rate)} eng.
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-5">
            {boardLoading ? (
              <div className="flex items-center justify-center py-10 text-slate-400">
                <Loader2 size={20} className="animate-spin mr-2" /> Loading board metrics...
              </div>
            ) : boardError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{boardError}</div>
            ) : activeSummary ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <StatCard label="Pins" value={formatCompactNumber(activeSummary.total_pins)} icon={<Pin size={16} />} />
                <StatCard label="Impressions" value={formatCompactNumber(activeSummary.total_impressions)} icon={<TrendingUp size={16} />} />
                <StatCard label="Outbound" value={formatCompactNumber(activeSummary.total_outbound_clicks)} icon={<MousePointerClick size={16} />} />
                <StatCard label="Saves" value={formatCompactNumber(activeSummary.total_saves)} icon={<Bookmark size={16} />} />
                <StatCard label="Reactions" value={formatCompactNumber(activeSummary.total_reactions)} icon={<Heart size={16} />} />
                <StatCard label="Avg Eng. Rate" value={formatPercent(activeSummary.avg_engagement_rate)} icon={<MessageCircle size={16} />} />
              </div>
            ) : null}
          </div>
        )}

        {/* Top pins (current selection) */}
        <div className="mt-7">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Top pins</div>
              <div className="mt-0.5 text-sm font-bold text-slate-900">{selectedBoardName}</div>
            </div>
            <div className="text-xs text-slate-500">
              Showing {pinsForDisplay.length} of {activeSummary ? formatCompactNumber(activeSummary.total_pins) : formatCompactNumber(activePins.length)} pins
            </div>
          </div>

          {pinsForDisplay.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              <Pin size={32} className="mx-auto mb-3 text-slate-300" />
              <div className="font-semibold text-slate-700">No pins to display</div>
              <div className="mt-1 text-xs">Sync Pinterest to pull pin insights.</div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pinsForDisplay.map((pin) => {
                const impressions = Number(pin.impressions || 0);
                const engagement = Number(pin.engagement || 0);
                const engagementRate = impressions > 0 ? (engagement / impressions) * 100 : 0;

                const outboundClicks = pin.outbound_clicks ?? pin.clicks ?? null;
                const saves = pin.saves_count ?? pin.saves ?? null;

                const title = pin.title || pin.description || `Pin ${pin.pin_id.slice(0, 8)}`;
                const createdAt = pin.created_at || pin.posted_at;

                const pinUrl = pin.pin_id ? guessPinterestPinUrl(pin.pin_id) : null;

                return (
                  <div key={pin.pin_id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                      {pin.media_url ? (
                        <img src={pin.media_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Pin size={28} className="text-slate-300" />
                        </div>
                      )}
                    </div>
                    <div className="space-y-3 p-4">
                      <div>
                        <div className="line-clamp-3 text-sm font-semibold leading-snug text-slate-900">{title}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {pin.creative_type ? pin.creative_type.replace(/_/g, ' ') : 'PIN'} · {formatShortDate(createdAt)}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                        <div className="rounded-xl bg-slate-50 px-3 py-2">
                          Impr.: <span className="font-semibold text-slate-700">{formatCompactNumber(pin.impressions)}</span>
                        </div>
                        <div className="rounded-xl bg-slate-50 px-3 py-2">
                          Saves: <span className="font-semibold text-slate-700">{formatCompactNumber(saves)}</span>
                        </div>
                        <div className="rounded-xl bg-slate-50 px-3 py-2">
                          Clicks: <span className="font-semibold text-slate-700">{formatCompactNumber(outboundClicks)}</span>
                        </div>
                        <div className="rounded-xl bg-slate-50 px-3 py-2">
                          Eng. rate: <span className="font-semibold text-slate-700">{formatPercent(engagementRate)}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                        <div className="inline-flex items-center gap-1">
                          <MessageCircle size={12} /> Engagement {formatCompactNumber(pin.engagement)}
                        </div>
                        <div className="flex items-center gap-3">
                          {pin.link ? (
                            <a
                              href={pin.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline"
                              title="Open destination link"
                            >
                              <ExternalLink size={11} /> Link
                            </a>
                          ) : null}
                          {pinUrl ? (
                            <a
                              href={pinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-semibold text-rose-600 hover:underline"
                              title="View on Pinterest"
                            >
                              <ExternalLink size={11} /> View
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {createBoardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Create board</h3>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-2">Board name</label>
                <input
                  value={createBoardName}
                  onChange={(e) => setCreateBoardName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                  placeholder="e.g. Product inspiration"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-2">Description (optional)</label>
                <textarea
                  value={createBoardDescription}
                  onChange={(e) => setCreateBoardDescription(e.target.value)}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                  placeholder="What will you save here?"
                  rows={3}
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={createBoardSecret}
                  onChange={(e) => setCreateBoardSecret(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Secret board
              </label>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={createBoardSetDefault}
                  onChange={(e) => setCreateBoardSetDefault(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Set as default publishing board
              </label>

              {createBoardError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{createBoardError}</div>
              ) : null}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setCreateBoardOpen(false)}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                disabled={createBoardLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateBoard()}
                className="flex-1 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                disabled={createBoardLoading || !createBoardName.trim()}
              >
                {createBoardLoading ? 'Creating...' : 'Create board'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

