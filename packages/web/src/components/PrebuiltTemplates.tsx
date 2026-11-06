import CardPreviewCanvas from './cards/CardPreviewCanvas';
import { CardTemplate } from '../types/cardTemplate';

interface PrebuiltTemplatesProps {
  templates: CardTemplate[];
  onSelectTemplate: (template: CardTemplate) => void;
}

const PrebuiltTemplates = ({ templates, onSelectTemplate }: PrebuiltTemplatesProps) => {
  return (
    <div className="space-y-8">
      <div className="max-w-3xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Template Gallery</p>
        <h2 className="text-3xl font-black text-slate-900">Pick a social card and start editing</h2>
        <p className="text-base text-slate-600">
          Every template already includes the finished composition: background, decorative shapes, text, avatar,
          icons, and call-to-action buttons.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((template) => (
          <article
            key={template.id}
            className="overflow-hidden rounded-[28px] border border-slate-200 bg-white transition-colors hover:border-slate-900"
          >
            <div className="border-b border-slate-100 bg-slate-50 p-4">
              <CardPreviewCanvas template={template} selectedElementId={null} interactive={false} compact />
            </div>

            <div className="space-y-4 p-5">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{template.name}</h3>
                <p className="mt-1 text-sm text-slate-600">{template.description}</p>
              </div>

              <button
                type="button"
                onClick={() => onSelectTemplate(template)}
                className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
              >
                Use Template
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};

export default PrebuiltTemplates;
