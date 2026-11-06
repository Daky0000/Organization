import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type Props = {
  value: string; // datetime-local string "YYYY-MM-DDTHH:mm" or ''
  onChange: (val: string) => void;
  onCancel: () => void;
};

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_LABELS = ['Mo','Tu','We','Th','Fr','Sa','Su'];

function parse(val: string) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function pad(n: number) { return String(n).padStart(2, '0'); }

function toDatetimeLocal(year: number, month: number, day: number, h24: number, min: number) {
  return `${year}-${pad(month + 1)}-${pad(day)}T${pad(h24)}:${pad(min)}`;
}

export default function CalendarPicker({ value, onChange, onCancel }: Props) {
  const now         = new Date();
  const todayMid    = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const init        = parse(value) ?? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0);

  const [viewYear,  setViewYear]  = useState(init.getFullYear());
  const [viewMonth, setViewMonth] = useState(init.getMonth());
  const [selDate,   setSelDate]   = useState<{ y: number; m: number; d: number }>({
    y: init.getFullYear(), m: init.getMonth(), d: init.getDate(),
  });
  const [hour,   setHour]   = useState(() => { const h = init.getHours() % 12; return h === 0 ? 12 : h; });
  const [minute, setMinute] = useState(init.getMinutes());
  const [ampm,   setAmpm]   = useState<'AM' | 'PM'>(init.getHours() >= 12 ? 'PM' : 'AM');

  // Build day cells (Monday-first grid)
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
  const firstDayOfWeek  = (firstDayOfMonth.getDay() + 6) % 7; // 0=Mon
  const daysInMonth     = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  type Cell = { day: number; own: boolean };
  const cells: Cell[] = [];
  for (let i = firstDayOfWeek - 1; i >= 0; i--)
    cells.push({ day: daysInPrevMonth - i, own: false });
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ day: d, own: true });
  let n = 1;
  while (cells.length % 7 !== 0) cells.push({ day: n++, own: false });

  const isToday    = (d: number) => d === now.getDate() && viewMonth === now.getMonth() && viewYear === now.getFullYear();
  const isSelected = (d: number) => d === selDate.d && viewMonth === selDate.m && viewYear === selDate.y;
  const isPast     = (d: number) => new Date(viewYear, viewMonth, d) < todayMid;

  // Prevent navigating to months before the current month
  const canGoPrev = viewYear > now.getFullYear() || (viewYear === now.getFullYear() && viewMonth > now.getMonth());

  const prevMonth = () => {
    if (!canGoPrev) return;
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const pickDay = (d: number) => {
    if (isPast(d)) return;
    setSelDate({ y: viewYear, m: viewMonth, d });
  };

  const quickPick = (daysFromNow: number) => {
    const t = new Date(now);
    t.setDate(t.getDate() + daysFromNow);
    setViewYear(t.getFullYear());
    setViewMonth(t.getMonth());
    setSelDate({ y: t.getFullYear(), m: t.getMonth(), d: t.getDate() });
  };

  const confirm = () => {
    const h24 = ampm === 'PM' ? (hour === 12 ? 12 : hour + 12) : (hour === 12 ? 0 : hour);
    onChange(toDatetimeLocal(selDate.y, selDate.m, selDate.d, h24, minute));
  };

  return (
    <div className="rounded-2xl bg-white border border-gray-200 shadow-2xl w-72 select-none">

      {/* Quick shortcuts */}
      <div className="flex items-center gap-1.5 px-3 pt-3 pb-2.5 border-b border-gray-100">
        {[
          { label: 'Today',     days: 0 },
          { label: 'Tomorrow',  days: 1 },
          { label: 'Next week', days: 7 },
        ].map(({ label, days }) => (
          <button
            key={label}
            onClick={() => quickPick(days)}
            className="px-3 py-1 rounded-full text-[11px] font-semibold border border-gray-200 text-gray-600 hover:border-[#2563EB] hover:text-[#2563EB] hover:bg-indigo-50 transition-colors"
          >
            {label}
          </button>
        ))}
      </div>

      {/* Month / year nav */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={prevMonth}
          disabled={!canGoPrev}
          className={[
            'p-1 rounded-lg transition-colors',
            canGoPrev ? 'text-gray-400 hover:bg-gray-100 hover:text-gray-700' : 'text-gray-200 cursor-not-allowed',
          ].join(' ')}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-[13px] font-bold text-gray-800 tracking-tight">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          onClick={nextMonth}
          className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 px-3 mb-1">
        {DAY_LABELS.map(d => (
          <div key={d} className="text-center text-[10px] font-bold text-gray-400 pb-1">{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 px-3 pb-3 gap-y-0.5">
        {cells.map((cell, i) => {
          const past = cell.own && isPast(cell.day);
          const today = cell.own && isToday(cell.day);
          const sel   = cell.own && isSelected(cell.day) && !past;
          return (
            <button
              key={i}
              onClick={() => cell.own && pickDay(cell.day)}
              disabled={!cell.own || past}
              className={[
                'h-8 w-8 mx-auto flex items-center justify-center rounded-full text-[12px] font-medium transition-all',
                !cell.own                              ? 'text-gray-200 cursor-default'                             : '',
                past                                   ? 'text-gray-300 cursor-not-allowed'                        : '',
                cell.own && !past && !today && !sel    ? 'text-gray-700 hover:bg-indigo-50 hover:text-[#2563EB]'  : '',
                today && !sel && !past                 ? 'text-[#2563EB] font-bold ring-1 ring-[#2563EB]'          : '',
                sel                                    ? 'bg-[#2563EB] text-white font-bold shadow-md scale-110'   : '',
              ].join(' ')}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      {/* Time picker */}
      <div className="border-t border-gray-100 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Time</p>
        <div className="flex items-center gap-2">
          <select
            value={hour}
            onChange={e => setHour(Number(e.target.value))}
            className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] font-semibold text-gray-700 text-center focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
              <option key={h} value={h}>{pad(h)}</option>
            ))}
          </select>

          <span className="text-gray-400 font-black text-base leading-none">:</span>

          <select
            value={minute}
            onChange={e => setMinute(Number(e.target.value))}
            className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] font-semibold text-gray-700 text-center focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
              <option key={m} value={m}>{pad(m)}</option>
            ))}
          </select>

          <div className="flex rounded-lg border border-gray-200 overflow-hidden ml-auto">
            {(['AM', 'PM'] as const).map(p => (
              <button
                key={p}
                onClick={() => setAmpm(p)}
                className={[
                  'px-3 py-1.5 text-[11px] font-bold transition-colors',
                  ampm === p ? 'bg-[#2563EB] text-white' : 'text-gray-500 hover:bg-gray-50',
                ].join(' ')}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-4 pb-4">
        <button
          onClick={onCancel}
          className="flex-1 rounded-xl border border-gray-200 py-2 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={confirm}
          className="flex-1 rounded-xl bg-[#2563EB] py-2 text-[13px] font-bold text-white hover:bg-[#4a5be8] transition-colors shadow-sm"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
