import { createContext, useContext, useState, type ReactNode } from 'react';
import type { CardTemplate } from '../types/cardTemplate';

interface TemplateEditorContextType {
  isOpen: boolean;
  template: CardTemplate | null;
  source: 'admin' | 'user' | null;
  onSave: ((template: CardTemplate) => void) | null;
  openEditor: (
    template: CardTemplate,
    source: 'admin' | 'user',
    onSave: (template: CardTemplate) => void
  ) => void;
  closeEditor: () => void;
  updateTemplate: (template: CardTemplate) => void;
}

const TemplateEditorContext = createContext<TemplateEditorContextType | undefined>(undefined);

export function TemplateEditorProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [template, setTemplate] = useState<CardTemplate | null>(null);
  const [source, setSource] = useState<'admin' | 'user' | null>(null);
  const [onSave, setOnSave] = useState<((template: CardTemplate) => void) | null>(null);

  const openEditor = (
    newTemplate: CardTemplate,
    editorSource: 'admin' | 'user',
    saveCallback: (template: CardTemplate) => void
  ) => {
    setTemplate(newTemplate);
    setSource(editorSource);
    setOnSave(() => saveCallback);
    setIsOpen(true);
  };

  const closeEditor = () => {
    setIsOpen(false);
    setTemplate(null);
    setSource(null);
    setOnSave(null);
  };

  const updateTemplate = (updatedTemplate: CardTemplate) => {
    setTemplate(updatedTemplate);
  };

  const value: TemplateEditorContextType = {
    isOpen,
    template,
    source,
    onSave,
    openEditor,
    closeEditor,
    updateTemplate,
  };

  return <TemplateEditorContext.Provider value={value}>{children}</TemplateEditorContext.Provider>;
}

export function useTemplateEditor() {
  const context = useContext(TemplateEditorContext);
  if (context === undefined) {
    throw new Error('useTemplateEditor must be used within TemplateEditorProvider');
  }

  return context;
}
