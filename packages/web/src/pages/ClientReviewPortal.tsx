import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, MessageSquare, Clock, ShieldCheck } from 'lucide-react';
import { API_BASE_URL } from '../utils/apiBase';

interface ClientReviewPortalProps {
  token: string;
}

export default function ClientReviewPortal({ token }: ClientReviewPortalProps) {
  const [review, setReview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewerName, setReviewerName] = useState('');
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedDecision, setSubmittedDecision] = useState<string | null>(null);

  useEffect(() => {
    const loadReview = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/api/public/review/${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!res.ok || !data.success) {
          setError(data.error || 'Review link not found or expired.');
        } else {
          setReview(data.review);
          setReviewerName(data.review.client_name || '');
        }
      } catch {
        setError('Unable to load review portal.');
      } finally {
        setLoading(false);
      }
    };
    void loadReview();
  }, [token]);

  const handleDecision = async (decision: 'approved' | 'changes_requested') => {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/public/review/${encodeURIComponent(token)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          reviewerName: reviewerName || 'Client Reviewer',
          feedback,
        }),
      });
      const data = await res.json();
      if (data.success && data.review) {
        setReview(data.review);
        setSubmittedDecision(decision);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-500">Loading Client Review Portal...</p>
        </div>
      </div>
    );
  }

  if (error || !review) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md w-full text-center space-y-3 shadow-sm">
          <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
          <h1 className="text-lg font-bold text-slate-900">Review Link Unavailable</h1>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  const snapshot = review.resource_snapshot || {};

  return (
    <div className="min-h-screen bg-canvas py-12 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Top White-Label Header */}
        <div className="bg-white border border-line rounded-[22px] p-6 shadow-panel flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <img src="/brand/header-lockup-on-light.png" alt="DakyXTech" className="h-6 w-auto" />
              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-d bg-pale px-2.5 py-1 rounded-full">
                <ShieldCheck className="h-3.5 w-3.5" />
                Client Sign-Off Portal
              </div>
            </div>
            <h1 className="text-xl font-medium text-ink">{review.title}</h1>
            <p className="text-xs text-muted mt-1">
              Prepared by <span className="font-medium text-ink">{review.agency_name || 'Your Agency Team'}</span>
              {review.client_name ? ` for ${review.client_name}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-medium uppercase tracking-wider ${
                review.status === 'approved'
                  ? 'bg-positive-surface text-positive-text border border-positive-line'
                  : review.status === 'changes_requested'
                  ? 'bg-warn-surface text-warn-text border border-warn-line'
                  : 'bg-soft text-muted border border-line'
              }`}
            >
              {review.status.replace('_', ' ')}
            </span>
          </div>
        </div>

        {/* Deliverable Preview Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Deliverable Content Preview ({review.resource_type})
            </span>
            {Array.isArray(snapshot.platforms) && (
              <div className="flex gap-1.5">
                {snapshot.platforms.map((p: string) => (
                  <span
                    key={p}
                    className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-semibold capitalize"
                  >
                    {p}
                  </span>
                ))}
              </div>
            )}
          </div>

          {snapshot.mediaUrl && (
            <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-100 max-h-96 flex items-center justify-center">
              <img src={snapshot.mediaUrl} alt="Deliverable preview" className="max-h-96 object-contain" />
            </div>
          )}

          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
            {snapshot.content || 'Content preview ready for client review.'}
          </div>

          {snapshot.scheduledAt && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5" />
              Scheduled publication: {new Date(snapshot.scheduledAt).toLocaleString()}
            </div>
          )}
        </div>

        {/* Decision Form */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          {submittedDecision ? (
            <div className="text-center py-6 space-y-2">
              <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
              <h3 className="text-lg font-bold text-slate-900">
                Thank you! Your decision ({submittedDecision.replace('_', ' ')}) has been recorded.
              </h3>
              <p className="text-sm text-slate-500">
                The agency team has been notified in real time with your notes.
              </p>
            </div>
          ) : (
            <>
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-indigo-600" />
                Submit Review Decision
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Your Name
                  </label>
                  <input
                    type="text"
                    value={reviewerName}
                    onChange={(e) => setReviewerName(e.target.value)}
                    placeholder="e.g., Jordan Lee"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Feedback or Revision Notes (Optional for Approval)
                </label>
                <textarea
                  rows={3}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Add any comments, copy tweaks, or approval confirmation..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleDecision('changes_requested')}
                  className="px-4 py-2.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-sm font-semibold transition"
                >
                  Request Changes
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleDecision('approved')}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition flex items-center gap-1.5 shadow-sm"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Approve Deliverable
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
