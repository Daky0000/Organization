import { Wand2 } from 'lucide-react';

interface CardDesignAssistantProps {
  cardDesign: any;
  setCardDesign: (design: any) => void;
}

const CardDesignAssistant = ({ cardDesign, setCardDesign }: CardDesignAssistantProps) => {
  const applyMinimalStyle = () => {
    setCardDesign({
      ...cardDesign,
      background: { ...cardDesign.background, type: 'solid', solidColor: '#ffffff', overlayOpacity: 0 },
      typography: { ...cardDesign.typography, fontSize: Math.max(24, cardDesign.typography.fontSize - 8), fontWeight: 400, letterSpacing: 1 },
      branding: { ...cardDesign.branding, colorPalette: ['#ffffff', '#000000', '#cccccc', '#666666'] },
      layouts: { ...cardDesign.layouts, padding: 60 },
    });
  };

  const applyBoldStyle = () => {
    setCardDesign({
      ...cardDesign,
      background: { ...cardDesign.background, type: 'gradient', gradientStart: '#000000', gradientEnd: '#1a1a1a', gradientAngle: 135, overlayOpacity: 0.4 },
      typography: { ...cardDesign.typography, fontSize: Math.min(60, cardDesign.typography.fontSize + 16), fontWeight: 800, letterSpacing: 0 },
      branding: { ...cardDesign.branding, colorPalette: ['#ff0000', '#ffff00', '#00ff00', '#ffffff'] },
    });
  };

  const applyCorporateStyle = () => {
    setCardDesign({
      ...cardDesign,
      background: { ...cardDesign.background, type: 'solid', solidColor: '#1e3a5f', overlayOpacity: 0 },
      typography: { ...cardDesign.typography, fontFamily: 'Georgia', fontSize: 28, fontWeight: 600, letterSpacing: 0.5 },
      branding: { ...cardDesign.branding, colorPalette: ['#1e3a5f', '#3b5998', '#6c8cba', '#a6b9d1'], fontSet: ['Georgia', 'Roboto'] },
    });
  };

  const applyViralStyle = () => {
    setCardDesign({
      ...cardDesign,
      background: { ...cardDesign.background, type: 'gradient', gradientStart: '#ff6b9d', gradientEnd: '#c06c84', gradientAngle: 135, overlayOpacity: 0.2 },
      typography: { ...cardDesign.typography, fontFamily: 'Poppins', fontSize: 40, fontWeight: 700, letterSpacing: 1, lineHeight: 1.2 },
      branding: { ...cardDesign.branding, colorPalette: ['#ff6b9d', '#c06c84', '#ffd93d', '#6bcf7f'], fontSet: ['Poppins', 'Inter'] },
    });
  };

  const aiStyles = [
    { name: 'Make it Minimal', description: 'Clean, spacious design', onClick: applyMinimalStyle, color: 'bg-gray-100 hover:bg-gray-200 text-gray-900' },
    { name: 'Make it Bold', description: 'High contrast impact', onClick: applyBoldStyle, color: 'bg-black hover:bg-gray-900 text-white' },
    { name: 'Make it Corporate', description: 'Professional & trustworthy', onClick: applyCorporateStyle, color: 'bg-blue-100 hover:bg-blue-200 text-blue-900' },
    { name: 'Make it Viral', description: 'Trendy & engaging', onClick: applyViralStyle, color: 'bg-pink-100 hover:bg-pink-200 text-pink-900' },
  ];

  return (
    <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg shadow-md p-6 border-2 border-blue-200">
      <div className="flex items-center gap-2 mb-4">
        <Wand2 size={20} className="text-blue-600 animate-pulse" />
        <h3 className="text-lg font-bold text-gray-900">AI Design Assistant</h3>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Transform your card with AI-powered design suggestions
      </p>

      <div className="grid grid-cols-1 gap-3">
        {aiStyles.map((style) => (
          <button
            key={style.name}
            onClick={style.onClick}
            className={`${style.color} p-4 rounded-lg font-semibold transition-all border-2 border-transparent hover:border-gray-300 text-left`}
          >
            <div className="font-bold">{style.name}</div>
            <div className="text-sm opacity-75">{style.description}</div>
          </button>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-gray-300">
        <p className="text-xs text-gray-600 text-center italic">
          💡 Tip: Mix and match suggestions to create your perfect design
        </p>
      </div>
    </div>
  );
};

export default CardDesignAssistant;
