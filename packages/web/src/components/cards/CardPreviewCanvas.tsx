import { CSSProperties, DragEvent, Ref } from 'react';
import CardElement from './CardElement';
import { AspectRatio, CardTemplate, DecorativeShape } from '../../types/cardTemplate';

interface CardPreviewCanvasProps {
  template: CardTemplate;
  selectedElementId: string | null;
  onSelectElement?: (elementId: string | null) => void;
  interactive?: boolean;
  cardRef?: Ref<HTMLDivElement>;
  compact?: boolean;
  stageTone?: 'light' | 'dark';
  onElementDrop?: (elementId: string, x: number, y: number) => void;
}

const aspectRatioMap: Record<AspectRatio, string> = {
  '1:1': '1 / 1',
  '4:5': '4 / 5',
  '16:9': '16 / 9',
  '9:16': '9 / 16',
};

const getContainerBackground = (template: CardTemplate) => {
  if (template.background.backgroundType === 'gradient') {
    return `${template.background.backgroundGradientType}-gradient(${template.background.backgroundGradientAngle}deg, ${template.background.backgroundGradientFrom} ${template.background.backgroundGradientFromStop}%, ${template.background.backgroundGradientTo} ${template.background.backgroundGradientToStop}%)`;
  }

  if (template.background.backgroundType === 'image' && template.background.backgroundImage) {
    return `url("${template.background.backgroundImage}")`;
  }

  return undefined;
};

const shapeStyle = (shape: DecorativeShape): CSSProperties => ({
  position: 'absolute',
  left: `${shape.x}%`,
  top: `${shape.y}%`,
  width: `${shape.width}%`,
  height: `${shape.height}%`,
  borderRadius: shape.shape === 'circle' || shape.shape === 'ring' ? '999px' : '28px',
  transform: shape.rotate ? `rotate(${shape.rotate}deg)` : undefined,
  opacity: shape.opacity ?? 1,
  background:
    shape.shape === 'ring'
      ? 'transparent'
      : shape.gradientFrom && shape.gradientTo
        ? `linear-gradient(135deg, ${shape.gradientFrom}, ${shape.gradientTo})`
        : shape.color,
  border:
    shape.shape === 'ring'
      ? `${shape.borderWidth ?? 2}px solid ${shape.borderColor ?? shape.color ?? '#cbd5e1'}`
      : 'none',
});

const CardPreviewCanvas = ({
  template,
  selectedElementId,
  onSelectElement,
  interactive = false,
  cardRef,
  compact = false,
  stageTone = 'light',
  onElementDrop,
}: CardPreviewCanvasProps) => {
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!onElementDrop) {
      return;
    }

    event.preventDefault();
    const elementId = event.dataTransfer.getData('application/x-card-builder-item');
    if (!elementId) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    const y = ((event.clientY - bounds.top) / bounds.height) * 100;
    onElementDrop(elementId, x, y);
  };

  return (
    <div
      className={`mx-auto w-full ${compact ? 'max-w-[320px]' : 'max-w-[720px]'}`}
      style={{ aspectRatio: aspectRatioMap[template.aspectRatio] }}
    >
      <div
        ref={cardRef}
        className={`relative h-full w-full overflow-hidden ${stageTone === 'dark' ? 'bg-slate-900' : 'bg-white'}`}
        style={{
          borderRadius: `${template.background.borderRadius}px`,
          backgroundColor:
            template.background.backgroundType === 'solid' ? template.background.backgroundColor : undefined,
          backgroundImage: getContainerBackground(template),
          backgroundSize: template.background.backgroundType === 'image' ? 'cover' : undefined,
          backgroundPosition: template.background.backgroundType === 'image' ? 'center' : undefined,
          backgroundRepeat: template.background.backgroundType === 'image' ? 'no-repeat' : undefined,
          border:
            template.background.borderWidth > 0
              ? `${template.background.borderWidth}px ${template.background.borderStyle} ${template.background.borderColor}`
              : 'none',
          padding: `${template.background.padding.top}px ${template.background.padding.right}px ${template.background.padding.bottom}px ${template.background.padding.left}px`,
          margin: `${template.background.margin.top}px ${template.background.margin.right}px ${template.background.margin.bottom}px ${template.background.margin.left}px`,
        }}
        onClick={() => onSelectElement?.(null)}
        onDragOver={onElementDrop ? (event) => event.preventDefault() : undefined}
        onDrop={onElementDrop ? handleDrop : undefined}
      >
        {template.decorations.map((shape) => (
          <div key={shape.id} style={shapeStyle(shape)} />
        ))}

        {template.elements.map((element) => (
          <CardElement
            key={element.id}
            element={element}
            selected={selectedElementId === element.id}
            interactive={interactive}
            onSelect={onSelectElement}
          />
        ))}
      </div>
    </div>
  );
};

export default CardPreviewCanvas;
