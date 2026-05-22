'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export function LogDetailsModal({ details, action }: { details: unknown; action: string }) {
  const [open, setOpen] = useState(false);
  if (details === null || details === undefined) return <span className="text-muted text-xs">—</span>;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] text-accent-600 hover:text-accent-700 hover:underline"
      >
        查看
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 8, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="surface w-full max-w-lg rounded-2xl p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{action}</h3>
                <button
                  onClick={() => setOpen(false)}
                  className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <pre className="max-h-96 overflow-auto rounded-lg bg-zinc-100 p-3 font-mono text-[11px] dark:bg-zinc-900">
                {JSON.stringify(details, null, 2)}
              </pre>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
