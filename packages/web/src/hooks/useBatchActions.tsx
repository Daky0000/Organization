import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { blogService, type BlogPost } from '../services/blogService';

type UndoAction = {
  id: string;
  action: string;
  postIds: string[];
  previousState: BlogPost[];
};

const MAX_STACK = 10;
const UNDO_WINDOW_MS = 30_000;

export const useBatchActions = () => {
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const recordUndo = useCallback((action: string, postIds: string[], previousState: BlogPost[]) => {
    const id = crypto.randomUUID();
    const entry: UndoAction = { id, action, postIds, previousState };

    setUndoStack((prev) => {
      const next = [entry, ...prev].slice(0, MAX_STACK);
      const nextIds = new Set(next.map((item) => item.id));
      prev.forEach((item) => {
        if (nextIds.has(item.id)) return;
        const timerId = timers.current.get(item.id);
        if (timerId) {
          window.clearTimeout(timerId);
          timers.current.delete(item.id);
        }
      });
      return next;
    });

    const timerId = window.setTimeout(() => {
      setUndoStack((prev) => prev.filter((item) => item.id !== id));
      timers.current.delete(id);
    }, UNDO_WINDOW_MS);

    timers.current.set(id, timerId);
  }, []);

  const undo = useCallback(async () => {
    const latest = undoStack[0];
    if (!latest) return;

    const timerId = timers.current.get(latest.id);
    if (timerId) {
      window.clearTimeout(timerId);
      timers.current.delete(latest.id);
    }

    await blogService.batchRestore(latest.previousState);
    setUndoStack((prev) => prev.slice(1));
  }, [undoStack]);

  const canUndo = useMemo(() => undoStack.length > 0, [undoStack.length]);

  useEffect(() => {
    return () => {
      timers.current.forEach((timerId) => window.clearTimeout(timerId));
      timers.current.clear();
    };
  }, []);

  return { recordUndo, undo, canUndo };
};
