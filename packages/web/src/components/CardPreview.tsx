import CardPreviewCanvas from './cards/CardPreviewCanvas';
import { CardTemplate } from '../types/cardTemplate';

interface CardPreviewProps {
  template?: CardTemplate;
  design?: any;
}

const CardPreview = ({ template, design }: CardPreviewProps) => {
  if (template) {
    return <CardPreviewCanvas template={template} selectedElementId={null} interactive={false} />;
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="rounded-2xl bg-slate-50 p-6 text-center text-slate-600">
        <div className="text-lg font-bold text-slate-900">{design?.title || 'Card Preview'}</div>
        <p className="mt-2 text-sm">{design?.content || 'The cards editor now uses the new template preview system.'}</p>
      </div>
    </div>
  );
};

export default CardPreview;
