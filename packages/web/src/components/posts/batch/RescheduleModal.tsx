import { useState } from 'react';

interface RescheduleModalProps {
  count: number;
  onSubmit: (date: string, time: string) => Promise<void>;
  onClose: () => void;
}

const RescheduleModal = ({ count, onSubmit, onClose }: RescheduleModalProps) => {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!date) {
      alert('Please select a date.');
      return;
    }
    setLoading(true);
    try {
      await onSubmit(date, time);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">Reschedule {count} posts</h3>
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2">Time</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Will reschedule {count} posts to {date || 'selected date'} at {time}.
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="flex-1 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            disabled={loading}
            data-testid="reschedule-submit"
          >
            {loading ? 'Rescheduling...' : 'Reschedule'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RescheduleModal;
