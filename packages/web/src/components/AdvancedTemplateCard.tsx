import { useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import CardPreviewCanvas from './cards/CardPreviewCanvas';
import SettingsPanel, { BuilderPaletteItem } from './cards/SettingsPanel';
import { CardElement, CardTemplate, createSpacing, createStyleConfig } from '../types/cardTemplate';

interface AdvancedTemplateCardProps {
  template: CardTemplate;
  onTemplateChange: (template: CardTemplate) => void;
  mode?: 'builder' | 'editor';
}

const BUILDER_ITEMS: BuilderPaletteItem[] = [
  { id: 'heading', label: 'Heading', type: 'heading', description: 'Large title text' },
  { id: 'text', label: 'Text Block', type: 'text', description: 'Paragraph or supporting copy' },
  { id: 'image', label: 'Image', type: 'image', description: 'Photo or illustration' },
  { id: 'button', label: 'Button', type: 'button', description: 'Call-to-action button' },
  { id: 'icon', label: 'Icon Badge', type: 'icon', description: 'Small label or tag' },
];

const clampPercent = (value: number) => Math.max(0, Math.min(88, value));

const createElementFromPalette = (elementId: string, index: number, x: number, y: number): CardElement => {
  const id = `${elementId}-${index + 1}`;

  if (elementId === 'heading') {
    return {
      id,
      type: 'heading',
      content: 'New heading',
      frame: { x, y, width: 42, height: 16 },
      styles: createStyleConfig({
        fontSize: 32,
        fontWeight: 800,
        color: '#f8fafc',
        padding: createSpacing(0),
      }),
    };
  }

  if (elementId === 'text') {
    return {
      id,
      type: 'text',
      content: 'Add supporting copy here.',
      frame: { x, y, width: 40, height: 14 },
      styles: createStyleConfig({
        fontSize: 16,
        fontWeight: 500,
        color: '#e2e8f0',
        padding: createSpacing(0),
      }),
    };
  }

  if (elementId === 'image') {
    return {
      id,
      type: 'image',
      src: 'https://placehold.co/800x600/1f2937/f8fafc?text=Drop+Image',
      alt: 'Placeholder image',
      frame: { x, y, width: 28, height: 28 },
      styles: createStyleConfig({
        backgroundType: 'solid',
        backgroundColor: '#334155',
        borderRadius: 18,
        objectFit: 'cover',
      }),
    };
  }

  if (elementId === 'button') {
    return {
      id,
      type: 'button',
      content: 'Call to action',
      frame: { x, y, width: 26, height: 10 },
      styles: createStyleConfig({
        backgroundType: 'solid',
        backgroundColor: '#2563eb',
        borderRadius: 999,
        fontSize: 15,
        fontWeight: 700,
        color: '#ffffff',
        textAlign: 'center',
        padding: { top: 12, right: 16, bottom: 12, left: 16 },
      }),
    };
  }

  return {
    id,
    type: 'icon',
    content: 'NEW',
    frame: { x, y, width: 18, height: 8 },
    styles: createStyleConfig({
      backgroundType: 'solid',
      backgroundColor: '#f97316',
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 800,
      color: '#fff7ed',
      textAlign: 'center',
      padding: { top: 10, right: 12, bottom: 10, left: 12 },
    }),
  };
};

const AdvancedTemplateCard = ({ template, onTemplateChange, mode = 'editor' }: AdvancedTemplateCardProps) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);

  const handleDownload = async () => {
    if (!cardRef.current) {
      return;
    }

    const canvas = await html2canvas(cardRef.current, {
      backgroundColor: null,
      scale: 2,
      useCORS: true,
    });

    const link = document.createElement('a');
    link.download = `${template.id}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
  };

  const addBuilderElement = (item: BuilderPaletteItem, x = 8, y = 8) => {
    const nextElement = createElementFromPalette(item.id, template.elements.length, clampPercent(x), clampPercent(y));
    onTemplateChange({
      ...template,
      elements: [...template.elements, nextElement],
    });
    setSelectedElementId(nextElement.id);
  };

  const handleDropElement = (elementId: string, x: number, y: number) => {
    const item = BUILDER_ITEMS.find((entry) => entry.id === elementId);
    if (!item) {
      return;
    }

    addBuilderElement(item, x, y);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_420px]">
      <section className="rounded-[28px] border border-slate-200 bg-white p-6">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            {mode === 'builder' ? 'Builder Canvas' : 'Card Preview'}
          </p>
          <h2 className="mt-1 text-2xl font-black text-slate-900">{template.name}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {mode === 'builder'
              ? 'Drag elements from the Builder panel into the dark stage, then refine each layer.'
              : 'Click any layer to edit it. Hover outlines show what can be customized.'}
          </p>
        </div>

        <div
          className={`rounded-[28px] border p-4 md:p-6 ${
            mode === 'builder' ? 'border-slate-700 bg-[#30353f]' : 'border-slate-100 bg-slate-50'
          }`}
        >
          <CardPreviewCanvas
            template={template}
            selectedElementId={selectedElementId}
            onSelectElement={setSelectedElementId}
            interactive
            cardRef={cardRef}
            stageTone={mode === 'builder' ? 'dark' : 'light'}
            onElementDrop={mode === 'builder' ? handleDropElement : undefined}
          />
        </div>
      </section>

      <SettingsPanel
        mode={mode}
        template={template}
        selectedElementId={selectedElementId}
        onTemplateChange={onTemplateChange}
        onClearSelection={() => setSelectedElementId(null)}
        onDownload={handleDownload}
        builderItems={BUILDER_ITEMS}
        onAddElement={mode === 'builder' ? addBuilderElement : undefined}
      />
    </div>
  );
};

export default AdvancedTemplateCard;
