import { Download, Trash2 } from 'lucide-react';
import { CardTemplate } from '../../types/cardTemplate';
import EditorTabs from './EditorTabs';
import ColorPickerField from './ColorPickerField';
import GradientPickerField from './GradientPickerField';

export interface BuilderPaletteItem {
  id: string;
  label: string;
  type: 'heading' | 'text' | 'image' | 'button' | 'icon';
  description: string;
}

interface SettingsPanelProps {
  mode?: 'builder' | 'editor';
  template: CardTemplate;
  selectedElementId: string | null;
  onTemplateChange: (template: CardTemplate) => void;
  onClearSelection: () => void;
  onDownload: () => void;
  builderItems?: BuilderPaletteItem[];
  onAddElement?: (item: BuilderPaletteItem, x?: number, y?: number) => void;
}

const SettingsPanel = ({
  mode = 'editor',
  template,
  selectedElementId,
  onTemplateChange,
  onClearSelection,
  onDownload,
  builderItems = [],
  onAddElement,
}: SettingsPanelProps) => {
  const selectedElement = template.elements.find((el) => el.id === selectedElementId);
  const tabs = mode === 'builder' ? ['Palette', 'Properties'] : ['Properties'];
  const activeTab = mode === 'builder' ? 'Palette' : 'Properties';

  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col shadow-lg">
      {/* Header */}
      <div className="border-b border-gray-200 px-4 pt-4">
        {mode === 'builder' && (
          <EditorTabs tabs={tabs} activeTab={activeTab} onChange={() => {}} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {mode === 'builder' && builderItems.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900 text-sm">Palette</h3>
            {builderItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onAddElement?.(item)}
                className="w-full p-3 text-left bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg hover:shadow-md transition"
              >
                <p className="font-medium text-sm text-gray-900">{item.label}</p>
                <p className="text-xs text-gray-600">{item.description}</p>
              </button>
            ))}
          </div>
        )}

        {selectedElement && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Content</label>
              <input
                type="text"
                value={selectedElement.content}
                onChange={(e) => {
                  onTemplateChange({
                    ...template,
                    elements: template.elements.map((el) =>
                      el.id === selectedElement.id
                        ? { ...el, content: e.target.value }
                        : el
                    ),
                  });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>

            {selectedElement.styles?.color && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Text Color
                </label>
                <ColorPickerField
                  value={selectedElement.styles.color}
                  onChange={(color) => {
                    onTemplateChange({
                      ...template,
                      elements: template.elements.map((el) =>
                        el.id === selectedElement.id
                          ? { ...el, styles: { ...el.styles, color } }
                          : el
                      ),
                    });
                  }}
                />
              </div>
            )}

            {selectedElement.styles?.backgroundColor && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Background Color
                </label>
                <ColorPickerField
                  value={selectedElement.styles.backgroundColor}
                  onChange={(backgroundColor) => {
                    onTemplateChange({
                      ...template,
                      elements: template.elements.map((el) =>
                        el.id === selectedElement.id
                          ? {
                              ...el,
                              styles: { ...el.styles, backgroundColor },
                            }
                          : el
                      ),
                    });
                  }}
                />
              </div>
            )}

            <button
              onClick={() => {
                onTemplateChange({
                  ...template,
                  elements: template.elements.filter((el) => el.id !== selectedElement.id),
                });
                onClearSelection();
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition text-sm font-medium"
            >
              <Trash2 size={16} />
              Delete Element
            </button>
          </div>
        )}

        {!selectedElement && mode !== 'builder' && (
          <div className="text-center py-8 text-gray-500">
            <p className="text-sm">Select an element to edit</p>
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-gray-200">
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Card Background</h3>
          <GradientPickerField
            styles={template.background}
            onChange={(bg) => {
              onTemplateChange({ ...template, background: { ...template.background, ...bg } });
            }}
          />
        </div>
      </div>

      {/* Footer Actions */}
      <div className="border-t border-gray-200 p-4 flex gap-2">
        <button
          onClick={onDownload}
          className="flex-1 flex items-center justify-center gap-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition text-sm font-medium"
        >
          <Download size={16} />
          Preview
        </button>
      </div>
    </div>
  );
};

export default SettingsPanel;
