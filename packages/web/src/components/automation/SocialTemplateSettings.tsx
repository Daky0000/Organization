import { useEffect, useMemo, useState } from 'react';
import { HelpCircle, Loader2 } from 'lucide-react';
import SocialTemplatePreview from './SocialTemplatePreview';
import { getNetworkConfig } from './networkConfig';
import {
  socialTemplateService,
  type FacebookContentType,
  type SocialTemplateContentSource,
  type SocialTemplateSettings,
} from '../../services/socialTemplateService';

function settingsEqual(a: SocialTemplateSettings, b: SocialTemplateSettings) {
  return (
    a.platform === b.platform &&
    a.content_source === b.content_source &&
    a.template_string === b.template_string &&
    a.status_limit === b.status_limit &&
    a.max_status_limit === b.max_status_limit &&
    a.share_limit_per_post === b.share_limit_per_post &&
    a.add_categories_as_tags === b.add_categories_as_tags &&
    a.remove_css === b.remove_css &&
    a.show_thumbnail === b.show_thumbnail &&
    a.add_image_link === b.add_image_link &&
    a.content_type === b.content_type &&
    a.enabled === b.enabled
  );
}

export default function SocialTemplateSettingsPanel({
  platform,
  onSaved,
  onError,
}: {
  platform: string;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const config = getNetworkConfig(platform);
  const [settings, setSettings] = useState<SocialTemplateSettings | null>(null);
  const [original, setOriginal] = useState<SocialTemplateSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const hasChanges = useMemo(() => {
    if (!settings || !original) return false;
    return !settingsEqual(settings, original);
  }, [original, settings]);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setSettings(null);
    setOriginal(null);

    socialTemplateService
      .getSettings(platform)
      .then((data) => {
        if (canceled) return;
        setSettings(data);
        setOriginal(data);
      })
      .catch((e: any) => {
        if (canceled) return;
        onError(e?.message || 'Failed to load template settings');
      })
      .finally(() => {
        if (canceled) return;
        setLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [onError, platform]);

  const update = <K extends keyof SocialTemplateSettings>(key: K, value: SocialTemplateSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const maxStatusLimit = config?.maxStatusLimit ?? settings?.max_status_limit ?? 280;

  const save = async () => {
    if (!settings) return;
    if (!settings.template_string.trim()) {
      onError('Template cannot be empty');
      return;
    }

    setSaving(true);
    try {
      const saved = await socialTemplateService.updateSettings(platform, {
        ...settings,
        status_limit: Math.min(Math.max(1, settings.status_limit), maxStatusLimit),
      });
      setSettings(saved);
      setOriginal(saved);
      onSaved(`${config?.label || platform} template saved`);
    } catch (e: any) {
      onError(e?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        Unknown platform: {platform}
      </div>
    );
  }

  if (loading || !settings) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 flex items-center justify-center text-slate-500">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading…
      </div>
    );
  }

  const setContentSource = (value: SocialTemplateContentSource) => update('content_source', value);
  const setContentType = (value: FacebookContentType) => update('content_type', value);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-5">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <div className="text-sm font-bold text-slate-900">{config.label} Template</div>
          <div className="text-xs text-slate-500">
            Use placeholders: <span className="font-mono">{'{title}'}</span>,{' '}
            <span className="font-mono">{'{content}'}</span>,{' '}
            <span className="font-mono">{'{url}'}</span>,{' '}
            <span className="font-mono">{'{featured_image}'}</span>,{' '}
            <span className="font-mono">{'{tags}'}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!hasChanges || saving}
          className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
            hasChanges && !saving
              ? 'bg-slate-900 text-white hover:bg-slate-800'
              : 'border border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
          }`}
        >
          {saving ? (
            <>
              <Loader2 size={14} className="inline-block animate-spin mr-2" /> Saving…
            </>
          ) : hasChanges ? (
            'Save Changes'
          ) : (
            'All Saved'
          )}
        </button>
      </div>

      {config.features.contentTypeToggle ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="text-sm font-semibold text-slate-800">Content Type</div>
            <HelpCircle size={14} className="text-slate-400" />
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {(['STATUS', 'LINK', 'STATUS_PLUS_LINK'] as const).map((value) => (
              <label key={value} className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="contentType"
                  checked={settings.content_type === value}
                  onChange={() => setContentType(value)}
                />
                <span className="text-sm text-slate-700">{value.replace(/_/g, ' ')}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-800">Add categories/tags as hashtags</div>
              <div className="text-xs text-slate-500">Adds a {`{tags}`} string based on your post metadata.</div>
            </div>
            <input
              type="checkbox"
              checked={settings.add_categories_as_tags}
              onChange={(e) => update('add_categories_as_tags', e.target.checked)}
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="text-sm font-semibold text-slate-800">Content Source</div>
            <HelpCircle size={14} className="text-slate-400" />
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            {(['EXCERPT', 'CONTENT'] as const).map((value) => (
              <label key={value} className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="contentSource"
                  checked={settings.content_source === value}
                  onChange={() => setContentSource(value)}
                />
                <span className="text-slate-700">{value === 'EXCERPT' ? 'Use excerpt' : 'Use full content'}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="text-sm font-semibold text-slate-800 mb-2">Template</div>
        <textarea
          value={settings.template_string}
          onChange={(e) => update('template_string', e.target.value)}
          rows={6}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-mono outline-none focus:border-slate-400"
          placeholder="{title}\n\n{content}\n\n{url}\n\n{featured_image}\n\n{tags}"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-800 mb-2">Status Limit</div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={settings.status_limit}
              onChange={(e) => update('status_limit', Number(e.target.value) || 0)}
              min={1}
              max={maxStatusLimit}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <div className="text-xs text-slate-500 whitespace-nowrap">Max: {maxStatusLimit}</div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-800 mb-2">Share Limit Per Post</div>
          <input
            type="number"
            value={settings.share_limit_per_post}
            onChange={(e) => update('share_limit_per_post', Math.max(0, Number(e.target.value) || 0))}
            min={0}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
          />
          <div className="mt-2 text-xs text-slate-500">0 = unlimited</div>
        </div>
      </div>

      {config.features.removeCss ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-800">Remove HTML</div>
            <div className="text-xs text-slate-500">Strip tags and formatting from content.</div>
          </div>
          <input type="checkbox" checked={settings.remove_css} onChange={(e) => update('remove_css', e.target.checked)} />
        </div>
      ) : null}

      {config.features.addImageLink ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-800">Add Image Link</div>
            <div className="text-xs text-slate-500">Include a direct link to the image where supported.</div>
          </div>
          <input
            type="checkbox"
            checked={settings.add_image_link}
            onChange={(e) => update('add_image_link', e.target.checked)}
          />
        </div>
      ) : null}

      {config.features.showThumbnail ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-800">Show Thumbnail</div>
            <div className="text-xs text-slate-500">Controls link preview behavior where applicable.</div>
          </div>
          <input
            type="checkbox"
            checked={settings.show_thumbnail}
            onChange={(e) => update('show_thumbnail', e.target.checked)}
          />
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-bold text-slate-900 mb-2">Preview</div>
        <div className="text-xs text-slate-500 mb-3">
          Preview uses your current (even unsaved) settings.
        </div>
        <SocialTemplatePreview platform={platform} settings={settings} />
      </div>
    </div>
  );
}

