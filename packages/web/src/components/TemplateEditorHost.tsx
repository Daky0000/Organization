import { lazy, Suspense } from 'react';
import { useTemplateEditor } from '../hooks/useTemplateEditor';

const Editor=lazy(()=>import('./AdvancedTemplateCardModal'));
export default function TemplateEditorHost() {
  const { isOpen }=useTemplateEditor();
  if (!isOpen) return null;
  return <Suspense fallback={<div role="status" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 text-white">Loading editor…</div>}><Editor /></Suspense>;
}
