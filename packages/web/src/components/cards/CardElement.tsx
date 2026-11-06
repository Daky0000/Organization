import { CSSProperties } from 'react';
import { CardElement as CardElementModel } from '../../types/cardTemplate';

interface CardElementProps {
  element: CardElementModel;
  selected: boolean;
  interactive: boolean;
  onSelect?: (elementId: string) => void;
}

const getBackgroundImage = (element: CardElementModel) => {
  if (element.styles.backgroundType === 'gradient') {
    return `${element.styles.backgroundGradientType}-gradient(${element.styles.backgroundGradientAngle}deg, ${element.styles.backgroundGradientFrom} ${element.styles.backgroundGradientFromStop}%, ${element.styles.backgroundGradientTo} ${element.styles.backgroundGradientToStop}%)`;
  }

  if (element.styles.backgroundType === 'image' && element.styles.backgroundImage) {
    return `url("${element.styles.backgroundImage}")`;
  }

  return undefined;
};

const CardElement = ({ element, selected, interactive, onSelect }: CardElementProps) => {
  const selectionColor = '#2563eb';
  const isTextLikeElement = element.type === 'text' || element.type === 'heading' || element.type === 'icon';
  const baseStyle: CSSProperties = {
    position: 'absolute',
    left: `${element.frame.x}%`,
    top: `${element.frame.y}%`,
    width: `${element.frame.width}%`,
    height: `${element.frame.height}%`,
    borderRadius: `${element.styles.borderRadius}px`,
    borderWidth: `${element.styles.borderWidth}px`,
    borderStyle: element.styles.borderWidth === 0 ? 'none' : element.styles.borderStyle,
    borderColor: element.styles.borderColor,
    color: element.styles.color,
    fontFamily: element.styles.fontFamily,
    fontSize: `${element.styles.fontSize}px`,
    fontWeight: element.styles.fontWeight,
    textAlign: element.styles.textAlign,
    lineHeight: element.styles.lineHeight,
    letterSpacing: `${element.styles.letterSpacing}px`,
    wordSpacing: `${element.styles.wordSpacing}px`,
    textTransform: element.styles.textTransform,
    textDecoration: element.styles.textDecoration,
    fontStyle: element.styles.fontStyle,
    direction: element.styles.direction,
    opacity: element.styles.opacity,
    padding: isTextLikeElement
      ? '0'
      : `${element.styles.padding.top}px ${element.styles.padding.right}px ${element.styles.padding.bottom}px ${element.styles.padding.left}px`,
    margin: `${element.styles.margin.top}px ${element.styles.margin.right}px ${element.styles.margin.bottom}px ${element.styles.margin.left}px`,
    backgroundColor:
      element.styles.backgroundType === 'solid' ? element.styles.backgroundColor : 'transparent',
    backgroundImage: getBackgroundImage(element),
    backgroundSize: element.styles.backgroundType === 'image' ? element.styles.objectFit : undefined,
    backgroundPosition: element.styles.backgroundType === 'image' ? 'center' : undefined,
    backgroundRepeat: element.styles.backgroundType === 'image' ? 'no-repeat' : undefined,
    appearance: 'none',
    WebkitAppearance: 'none',
    background: 'none',
    boxSizing: 'border-box',
    paddingInline: undefined,
    paddingBlock: undefined,
    overflow: 'visible',
    cursor: interactive ? 'pointer' : 'default',
    display: 'flex',
    alignItems: 'center',
    justifyContent:
      element.styles.textAlign === 'center'
        ? 'center'
        : element.styles.textAlign === 'right'
          ? 'flex-end'
          : 'flex-start',
  };

  const overlayStyle: CSSProperties = {
    position: 'absolute',
    inset: '-4px',
    borderRadius: `${Math.max(element.styles.borderRadius, 10)}px`,
    border: `1px ${selected ? 'dashed' : 'solid'} ${selected ? selectionColor : 'transparent'}`,
    pointerEvents: 'none',
    transition: 'border-color 120ms ease',
  };

  const cornerHandleStyle = (x: 'left' | 'right', y: 'top' | 'bottom'): CSSProperties => ({
    position: 'absolute',
    width: '8px',
    height: '8px',
    borderRadius: '999px',
    backgroundColor: selectionColor,
    border: 'none',
    pointerEvents: 'none',
    [x]: '-6px',
    [y]: '-6px',
  });

  const contentStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    borderRadius: `${element.styles.borderRadius}px`,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent:
      element.styles.textAlign === 'center'
        ? 'center'
        : element.styles.textAlign === 'right'
          ? 'flex-end'
          : 'flex-start',
  };

  const textSelectionWrapperStyle: CSSProperties = {
    position: 'relative',
    display: 'inline-block',
    maxWidth: '100%',
    padding: `${element.styles.padding.top}px ${element.styles.padding.right}px ${element.styles.padding.bottom}px ${element.styles.padding.left}px`,
  };

  const handleSelect = () => {
    if (interactive && onSelect) {
      onSelect(element.id);
    }
  };

  if (element.type === 'image') {
    return (
      <button
        type="button"
        style={baseStyle}
        onClick={(event) => {
          event.stopPropagation();
          handleSelect();
        }}
        className={interactive ? 'group' : undefined}
      >
        <span
          style={{
            ...overlayStyle,
            borderColor: selected ? selectionColor : undefined,
          }}
          className={interactive && !selected ? 'group-hover:border-sky-300' : undefined}
        />
        {selected && (
          <>
            <span style={cornerHandleStyle('left', 'top')} />
            <span style={cornerHandleStyle('right', 'top')} />
            <span style={cornerHandleStyle('left', 'bottom')} />
            <span style={cornerHandleStyle('right', 'bottom')} />
          </>
        )}
        <span style={contentStyle}>
          <img
            src={element.src}
            alt={element.alt || ''}
            style={{
              width: '100%',
              height: '100%',
              objectFit: element.styles.objectFit,
              borderRadius: `${element.styles.borderRadius}px`,
            }}
          />
        </span>
      </button>
    );
  }

  const textContent = element.content || (element.type === 'button' ? 'Button' : '');

  return (
    <button
      type="button"
      style={baseStyle}
      onClick={(event) => {
        event.stopPropagation();
        handleSelect();
      }}
      className={interactive ? 'group' : undefined}
    >
      <span style={contentStyle}>
        <span style={textSelectionWrapperStyle}>
          <span
            style={{
              ...overlayStyle,
              borderColor: selected ? selectionColor : undefined,
            }}
            className={interactive && !selected ? 'group-hover:border-sky-300' : undefined}
          />
          {selected && (
            <>
              <span style={cornerHandleStyle('left', 'top')} />
              <span style={cornerHandleStyle('right', 'top')} />
              <span style={cornerHandleStyle('left', 'bottom')} />
              <span style={cornerHandleStyle('right', 'bottom')} />
            </>
          )}
          <span
            style={{
              display: 'inline-block',
              maxWidth: '100%',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {textContent}
          </span>
        </span>
      </span>
    </button>
  );
};

export default CardElement;
