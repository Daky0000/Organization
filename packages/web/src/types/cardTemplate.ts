export type AspectRatio = '1:1' | '4:5' | '16:9' | '9:16';

export type BackgroundMode = 'none' | 'solid' | 'gradient' | 'image';
export type BorderMode = 'none' | 'solid' | 'dashed' | 'dotted';
export type TextAlignMode = 'left' | 'center' | 'right';
export type CardElementType = 'image' | 'text' | 'heading' | 'button' | 'icon';
export type GradientMode = 'linear';
export type TextTransformMode = 'none' | 'uppercase' | 'lowercase' | 'capitalize';
export type TextDecorationMode = 'none' | 'underline' | 'line-through' | 'overline';
export type FontStyleMode = 'normal' | 'italic';
export type DirectionMode = 'ltr' | 'rtl';

export interface Spacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ElementFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StyleConfig {
  backgroundType: BackgroundMode;
  backgroundColor: string;
  backgroundGradientFrom: string;
  backgroundGradientTo: string;
  backgroundGradientType: GradientMode;
  backgroundGradientFromStop: number;
  backgroundGradientToStop: number;
  backgroundGradientAngle: number;
  backgroundImage: string;
  borderWidth: number;
  borderStyle: BorderMode;
  borderColor: string;
  borderRadius: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700 | 800;
  textAlign: TextAlignMode;
  lineHeight: number;
  letterSpacing: number;
  wordSpacing: number;
  textTransform: TextTransformMode;
  textDecoration: TextDecorationMode;
  fontStyle: FontStyleMode;
  direction: DirectionMode;
  color: string;
  opacity: number;
  objectFit: 'cover' | 'contain';
  padding: Spacing;
  margin: Spacing;
}

export interface DecorativeShape {
  id: string;
  shape: 'circle' | 'rounded-rect' | 'ring';
  x: number;
  y: number;
  width: number;
  height: number;
  rotate?: number;
  color?: string;
  gradientFrom?: string;
  gradientTo?: string;
  opacity?: number;
  borderColor?: string;
  borderWidth?: number;
}

export interface CardElement {
  id: string;
  type: CardElementType;
  frame: ElementFrame;
  content?: string;
  src?: string;
  alt?: string;
  styles: StyleConfig;
}

export interface CardTemplate {
  id: string;
  name: string;
  description: string;
  aspectRatio: AspectRatio;
  background: StyleConfig;
  decorations: DecorativeShape[];
  elements: CardElement[];
}

export const createSpacing = (value = 0): Spacing => ({
  top: value,
  right: value,
  bottom: value,
  left: value,
});

export const createStyleConfig = (overrides: Partial<StyleConfig> = {}): StyleConfig => ({
  backgroundType: 'none',
  backgroundColor: 'transparent',
  backgroundGradientFrom: '#ffffff',
  backgroundGradientTo: '#f3f4f6',
  backgroundGradientType: 'linear',
  backgroundGradientFromStop: 0,
  backgroundGradientToStop: 100,
  backgroundGradientAngle: 135,
  backgroundImage: '',
  borderWidth: 0,
  borderStyle: 'solid',
  borderColor: '#d1d5db',
  borderRadius: 0,
  fontFamily: 'Urbanist',
  fontSize: 18,
  fontWeight: 500,
  textAlign: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  wordSpacing: 0,
  textTransform: 'none',
  textDecoration: 'none',
  fontStyle: 'normal',
  direction: 'ltr',
  color: '#111827',
  opacity: 1,
  objectFit: 'cover',
  padding: createSpacing(0),
  margin: createSpacing(0),
  ...overrides,
});

// ── Fabric.js design data (new builder format) ────────────────────────────────
export interface FabricDesignData {
  fabricVersion: true;
  canvasWidth: number;
  canvasHeight: number;
  fabricJson: Record<string, unknown>;
}

export function isFabricDesign(data: CardTemplate | FabricDesignData | Record<string, unknown>): data is FabricDesignData {
  return (data as FabricDesignData).fabricVersion === true;
}

// Admin Card Template Types
export interface AdminCardTemplate {
  id: string;
  name: string;
  description: string;
  designData: CardTemplate | FabricDesignData;
  coverImageUrl?: string;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAdminCardTemplateInput {
  name: string;
  description?: string;
  designData: CardTemplate | FabricDesignData;
}

export interface UpdateAdminCardTemplateInput {
  name: string;
  description?: string;
  designData: CardTemplate | FabricDesignData;
  coverImageUrl?: string | null;
}

export interface PublishCardTemplateInput {
  coverImageUrl: string;
}

export interface CardTemplateResponse {
  success: boolean;
  template?: AdminCardTemplate;
  templates?: AdminCardTemplate[];
  error?: string;
  message?: string;
}
