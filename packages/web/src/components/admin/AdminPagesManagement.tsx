import { useEffect, useState } from 'react';
import { Save, RefreshCw, Plus, Trash2 } from 'lucide-react';
import {
  defaultHomepageContent,
  HomepageContent,
  FeatureItem,
  StatItem,
} from '../../pages/Landing';
import { defaultToolsContent, ToolsPageContent, ToolItem } from '../../pages/Tools';
import { fetchPageContent, savePageContent } from '../../services/pageContentService';

// ─── Generic field helpers ────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 resize-none focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
      )}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-6 py-4">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      </div>
      <div className="px-6 py-5 flex flex-col gap-4">{children}</div>
    </div>
  );
}

// ─── ICON options ─────────────────────────────────────────────────────────────

const ICON_OPTIONS = ['Calendar', 'Share2', 'Image', 'BarChart3', 'Globe', 'Zap', 'Star', 'Heart', 'Award'];

// ─── Homepage Editor ──────────────────────────────────────────────────────────

function HomepageEditor() {
  const [content, setContent] = useState<HomepageContent>(defaultHomepageContent);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void fetchPageContent<HomepageContent>('homepage').then((data) => {
      if (data) setContent(data);
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const ok = await savePageContent('homepage', content);
    setSaving(false);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  const setHero = (key: keyof HomepageContent['hero'], value: string) =>
    setContent((c) => ({ ...c, hero: { ...c.hero, [key]: value } }));

  const setFeaturesMeta = (key: 'title' | 'subtitle', value: string) =>
    setContent((c) => ({ ...c, features: { ...c.features, [key]: value } }));

  const setFeatureItem = (index: number, key: keyof FeatureItem, value: string) =>
    setContent((c) => {
      const items = [...c.features.items];
      items[index] = { ...items[index], [key]: value };
      return { ...c, features: { ...c.features, items } };
    });

  const addFeatureItem = () =>
    setContent((c) => ({
      ...c,
      features: {
        ...c.features,
        items: [...c.features.items, { icon: 'Zap', title: 'New Feature', description: 'Describe this feature.' }],
      },
    }));

  const removeFeatureItem = (index: number) =>
    setContent((c) => {
      const items = c.features.items.filter((_, i) => i !== index);
      return { ...c, features: { ...c.features, items } };
    });

  const setStatItem = (index: number, key: keyof StatItem, value: string) =>
    setContent((c) => {
      const items = [...c.stats.items];
      items[index] = { ...items[index], [key]: value };
      return { ...c, stats: { ...c.stats, items } };
    });

  const addStatItem = () =>
    setContent((c) => ({ ...c, stats: { items: [...c.stats.items, { value: '0', label: 'New stat' }] } }));

  const removeStatItem = (index: number) =>
    setContent((c) => ({ ...c, stats: { items: c.stats.items.filter((_, i) => i !== index) } }));

  const setCta = (key: keyof HomepageContent['cta'], value: string) =>
    setContent((c) => ({ ...c, cta: { ...c.cta, [key]: value } }));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw size={20} className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Save bar */}
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <div>
          <div className="text-sm font-bold text-slate-900">Homepage</div>
          <div className="text-xs text-slate-500 mt-0.5">Public page at /</div>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs font-semibold text-emerald-600">Saved!</span>}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* Hero section */}
      <SectionCard title="Hero Section">
        <Field label="Badge text" value={content.hero.badge} onChange={(v) => setHero('badge', v)} />
        <Field
          label="Headline (use \\n for line break)"
          value={content.hero.headline}
          onChange={(v) => setHero('headline', v)}
          multiline
        />
        <Field
          label="Sub-headline"
          value={content.hero.subheadline}
          onChange={(v) => setHero('subheadline', v)}
          multiline
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Primary CTA text"
            value={content.hero.ctaPrimary}
            onChange={(v) => setHero('ctaPrimary', v)}
          />
          <Field
            label="Secondary CTA text"
            value={content.hero.ctaSecondary}
            onChange={(v) => setHero('ctaSecondary', v)}
          />
        </div>
      </SectionCard>

      {/* Features section */}
      <SectionCard title="Features Section">
        <Field label="Section title" value={content.features.title} onChange={(v) => setFeaturesMeta('title', v)} />
        <Field label="Section subtitle" value={content.features.subtitle} onChange={(v) => setFeaturesMeta('subtitle', v)} />

        <div className="flex flex-col gap-3 mt-1">
          {content.features.items.map((item, i) => (
            <div key={i} className="rounded-xl border border-slate-100 bg-slate-50 p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">Feature {i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeFeatureItem(i)}
                  className="text-slate-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Icon</label>
                  <select
                    value={item.icon}
                    onChange={(e) => setFeatureItem(i, 'icon', e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  >
                    {ICON_OPTIONS.map((icon) => (
                      <option key={icon} value={icon}>{icon}</option>
                    ))}
                  </select>
                </div>
                <Field label="Title" value={item.title} onChange={(v) => setFeatureItem(i, 'title', v)} />
              </div>
              <Field
                label="Description"
                value={item.description}
                onChange={(v) => setFeatureItem(i, 'description', v)}
                multiline
              />
            </div>
          ))}
          <button
            type="button"
            onClick={addFeatureItem}
            className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-colors"
          >
            <Plus size={14} />
            Add feature
          </button>
        </div>
      </SectionCard>

      {/* Stats section */}
      <SectionCard title="Stats Section">
        <div className="flex flex-col gap-3">
          {content.stats.items.map((s, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="flex-1 grid grid-cols-2 gap-3">
                <Field label="Value" value={s.value} onChange={(v) => setStatItem(i, 'value', v)} />
                <Field label="Label" value={s.label} onChange={(v) => setStatItem(i, 'label', v)} />
              </div>
              <button
                type="button"
                onClick={() => removeStatItem(i)}
                className="mt-5 text-slate-400 hover:text-red-500 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addStatItem}
            className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-colors"
          >
            <Plus size={14} />
            Add stat
          </button>
        </div>
      </SectionCard>

      {/* CTA section */}
      <SectionCard title="CTA Banner">
        <Field label="Headline" value={content.cta.headline} onChange={(v) => setCta('headline', v)} />
        <Field label="Sub-headline" value={content.cta.subheadline} onChange={(v) => setCta('subheadline', v)} multiline />
        <Field label="Button text" value={content.cta.buttonText} onChange={(v) => setCta('buttonText', v)} />
      </SectionCard>
    </div>
  );
}

// ─── Tools editor ────────────────────────────────────────────────────────────

function ToolsEditor() {
  const [content, setContent] = useState<ToolsPageContent>(defaultToolsContent);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void fetchPageContent<ToolsPageContent>('tools').then((data) => {
      if (data) setContent(data);
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const ok = await savePageContent('tools', content);
    setSaving(false);
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
  };

  const setHero = (key: keyof ToolsPageContent['hero'], value: string) =>
    setContent((c) => ({ ...c, hero: { ...c.hero, [key]: value } }));

  const setCta = (key: keyof ToolsPageContent['cta'], value: string) =>
    setContent((c) => ({ ...c, cta: { ...c.cta, [key]: value } }));

  const setToolField = (index: number, key: keyof ToolItem, value: string) =>
    setContent((c) => {
      const tools = [...c.tools];
      tools[index] = { ...tools[index], [key]: value };
      return { ...c, tools };
    });

  const setToolBullet = (toolIndex: number, bulletIndex: number, value: string) =>
    setContent((c) => {
      const tools = [...c.tools];
      const bullets = [...tools[toolIndex].bullets];
      bullets[bulletIndex] = value;
      tools[toolIndex] = { ...tools[toolIndex], bullets };
      return { ...c, tools };
    });

  const addBullet = (toolIndex: number) =>
    setContent((c) => {
      const tools = [...c.tools];
      tools[toolIndex] = { ...tools[toolIndex], bullets: [...tools[toolIndex].bullets, ''] };
      return { ...c, tools };
    });

  const removeBullet = (toolIndex: number, bulletIndex: number) =>
    setContent((c) => {
      const tools = [...c.tools];
      tools[toolIndex] = { ...tools[toolIndex], bullets: tools[toolIndex].bullets.filter((_, i) => i !== bulletIndex) };
      return { ...c, tools };
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw size={20} className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Save bar */}
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <div>
          <div className="text-sm font-bold text-slate-900">Tools Page</div>
          <div className="text-xs text-slate-500 mt-0.5">Public page at /tools</div>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs font-semibold text-emerald-600">Saved!</span>}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* Hero */}
      <SectionCard title="Hero Section">
        <Field label="Badge" value={content.hero.badge} onChange={(v) => setHero('badge', v)} />
        <Field label="Headline (use \\n for line break)" value={content.hero.headline} onChange={(v) => setHero('headline', v)} multiline />
        <Field label="Sub-headline" value={content.hero.subheadline} onChange={(v) => setHero('subheadline', v)} multiline />
      </SectionCard>

      {/* Tools */}
      <SectionCard title="Tool Cards">
        <div className="flex flex-col gap-4">
          {content.tools.map((tool, i) => (
            <div key={i} className="rounded-xl border border-slate-100 bg-slate-50 p-4 flex flex-col gap-3">
              <span className="text-xs font-bold text-slate-500">Tool {i + 1}</span>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Icon</label>
                  <select
                    value={tool.icon}
                    onChange={(e) => setToolField(i, 'icon', e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  >
                    {ICON_OPTIONS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
                  </select>
                </div>
                <Field label="Name" value={tool.name} onChange={(v) => setToolField(i, 'name', v)} />
              </div>
              <Field label="Tagline" value={tool.tagline} onChange={(v) => setToolField(i, 'tagline', v)} />
              <Field label="Description" value={tool.description} onChange={(v) => setToolField(i, 'description', v)} multiline />
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Bullet points</label>
                {tool.bullets.map((b, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={b}
                      onChange={(e) => setToolBullet(i, j, e.target.value)}
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                    <button type="button" onClick={() => removeBullet(i, j)} className="text-slate-400 hover:text-red-500 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addBullet(i)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors w-fit"
                >
                  <Plus size={12} /> Add bullet
                </button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* CTA */}
      <SectionCard title="CTA Banner">
        <Field label="Headline" value={content.cta.headline} onChange={(v) => setCta('headline', v)} />
        <Field label="Sub-headline" value={content.cta.subheadline} onChange={(v) => setCta('subheadline', v)} multiline />
        <Field label="Button text" value={content.cta.buttonText} onChange={(v) => setCta('buttonText', v)} />
      </SectionCard>
    </div>
  );
}

// ─── Legal editor (simple placeholder for privacy/terms stored separately) ────

function LegalPageEditor({ slug, title, path }: { slug: string; title: string; path: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <p className="text-slate-500 text-sm">
        <strong className="text-slate-800">{title}</strong> is a static page rendered at{' '}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{path}</code>.
      </p>
      <p className="text-slate-400 text-sm mt-3">
        To edit its content, update{' '}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">src/pages/{slug === 'privacy' ? 'PrivacyPolicy' : 'TermsOfService'}.tsx</code>{' '}
        in the codebase and redeploy.
      </p>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

type Props = {
  activePage: string;
};

export default function AdminPagesManagement({ activePage }: Props) {
  if (activePage === 'pages-home') return <HomepageEditor />;
  if (activePage === 'pages-tools') return <ToolsEditor />;
  if (activePage === 'pages-pricing-public') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-slate-500 text-sm">
          <strong className="text-slate-800">Public Pricing Page</strong> is available at{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">/pricing</code>.
        </p>
        <p className="text-slate-400 text-sm mt-3">
          Plans are managed under <strong className="text-slate-600">Pricing Plans</strong> in the sidebar — any active plans appear on the public pricing page automatically.
        </p>
      </div>
    );
  }
  if (activePage === 'pages-login') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-slate-500 text-sm">
          <strong className="text-slate-800">Login / Signup Page</strong> is available at{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">/login</code>.
        </p>
        <p className="text-slate-400 text-sm mt-3">
          To edit it, update <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">src/pages/Auth.tsx</code> and redeploy.
        </p>
      </div>
    );
  }
  if (activePage === 'pages-privacy') {
    return <LegalPageEditor slug="privacy" title="Privacy Policy" path="/privacy" />;
  }
  if (activePage === 'pages-terms') {
    return <LegalPageEditor slug="terms" title="Terms of Service" path="/terms" />;
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8">
      <p className="text-slate-500 text-sm">
        This page editor is coming soon. Select a page from the sidebar to begin editing.
      </p>
    </div>
  );
}
