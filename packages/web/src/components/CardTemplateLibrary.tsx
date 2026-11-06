import { Layout } from 'lucide-react';
import { cardTemplates } from '../data/cardTemplates';

const CardTemplateLibrary = () => {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="mb-4 flex items-center gap-2">
        <Layout size={20} className="text-slate-900" />
        <h3 className="text-lg font-bold text-slate-900">Template Library</h3>
      </div>

      <div className="space-y-3">
        {cardTemplates.map((template) => (
          <div key={template.id} className="rounded-xl border border-slate-200 p-4">
            <div className="font-semibold text-slate-900">{template.name}</div>
            <div className="text-sm text-slate-600">{template.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CardTemplateLibrary;
