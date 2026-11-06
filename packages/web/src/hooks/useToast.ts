import { createContext, useContext, useState, useCallback } from 'react';

export type ToastType = 'success' | 'error' | 'info';
export type Toast = { id: number; type: ToastType; message: string };

type ToastContextValue = {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, durationMs?: number) => void;
  removeToast: (id: number) => void;
};

let _nextId = 1;

export const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  addToast: () => undefined,
  removeToast: () => undefined,
});

export function useToast() {
  return useContext(ToastContext);
}

export function useToastState(): ToastContextValue {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string, durationMs = 4500) => {
    const id = _nextId++;
    setToasts((prev) => [...prev.slice(-4), { id, type, message }]);
    setTimeout(() => removeToast(id), durationMs);
  }, [removeToast]);

  return { toasts, addToast, removeToast };
}
