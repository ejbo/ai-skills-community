'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<{ push: (kind: ToastKind, message: string) => void } | null>(
  null,
);

let nextId = 1;
const subscribers = new Set<(t: Toast) => void>();
export function pushToast(kind: ToastKind, message: string) {
  const toast = { id: nextId++, kind, message };
  subscribers.forEach((s) => s(toast));
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const handler = (t: Toast) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => remove(t.id), 4000);
    };
    subscribers.add(handler);
    return () => {
      subscribers.delete(handler);
    };
  }, [remove]);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="pointer-events-auto surface flex min-w-[260px] items-center gap-2 rounded-xl px-3 py-2 shadow-lg"
          >
            <Icon kind={t.kind} />
            <span className="text-sm">{t.message}</span>
            <button
              onClick={() => remove(t.id)}
              className="ml-auto text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Icon({ kind }: { kind: ToastKind }) {
  if (kind === 'success') return <CheckCircle2 className="h-4 w-4 text-ok" />;
  if (kind === 'error') return <AlertCircle className="h-4 w-4 text-danger" />;
  return <Info className="h-4 w-4 text-info" />;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  return ctx ?? { push: (kind: ToastKind, message: string) => pushToast(kind, message) };
}
