import { X } from 'lucide-react';
import AdvancedTemplateCard from './AdvancedTemplateCard';
import { useTemplateEditor } from '../hooks/useTemplateEditor';

const AdvancedTemplateCardModal = () => {
  const { isOpen, template, source, onSave, closeEditor, updateTemplate } = useTemplateEditor();

  if (!isOpen || !template || !onSave) {
    return null;
  }

  const handleSave = () => {
    onSave(template);
    closeEditor();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[95vh] w-full flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="sticky top-0 flex shrink-0 items-center justify-between border-b bg-white p-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {source === 'admin' ? 'Template Builder' : 'Advanced Template Editor'}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {source === 'admin' ? 'Admin builder' : 'User editor'} | Editing: {template.name}
            </p>
          </div>
          <button onClick={closeEditor} className="text-gray-500 transition hover:text-gray-700">
            <X size={28} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded-lg bg-gray-50 p-6">
            <AdvancedTemplateCard
              template={template}
              onTemplateChange={updateTemplate}
              mode={source === 'admin' ? 'builder' : 'editor'}
            />
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-3 border-t bg-white p-4">
          <button
            onClick={closeEditor}
            className="rounded-lg border border-gray-300 px-6 py-2 font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-lg bg-blue-600 px-6 py-2 font-medium text-white transition hover:bg-blue-700"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdvancedTemplateCardModal;
