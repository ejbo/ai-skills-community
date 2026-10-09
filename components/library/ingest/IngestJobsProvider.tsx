'use client';

// 收录任务 store — mounted ONCE in the root layout so an upload keeps going while
// the member browses elsewhere (client-side navigation keeps this tree alive; a
// hard reload is the one thing that drops an in-flight upload, as in any browser).
//
// It owns: the dialog's open/minimized state, the list of jobs, the requests
// (fetch for a URL, XHR for a file — progress events), and the poll that follows
// a new doc until extraction and the AI 导读 have settled. The dialog and the
// bottom-right dock are just views over this state; the 「添加内容」 button only
// calls `openDialog()`.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { isActiveJob, settleFromPoll, type IngestJob, type IngestKind } from '@/lib/library/ingest-shared';
import { AddDocDialog } from './AddDocDialog';
import { IngestDock } from './IngestDock';

export interface IngestOptions {
  docType?: string;
  categories?: string[];
}

export interface IngestApi {
  jobs: IngestJob[];
  dialogOpen: boolean;
  openDialog: () => void;
  /** Close = minimize while anything runs (nothing is lost); plain close otherwise. */
  closeDialog: () => void;
  minimize: () => void;
  startUrl: (url: string, opts: IngestOptions) => void;
  startFile: (file: File, opts: IngestOptions) => void;
  /** Remove a finished job from the list (and the dock). */
  dismiss: (id: string) => void;
  dismissFinished: () => void;
}

const NOOP: IngestApi = {
  jobs: [],
  dialogOpen: false,
  openDialog: () => {},
  closeDialog: () => {},
  minimize: () => {},
  startUrl: () => {},
  startFile: () => {},
  dismiss: () => {},
  dismissFinished: () => {},
};

const Ctx = createContext<IngestApi>(NOOP);

/** Safe outside the provider (no-ops), so the button renders anywhere. */
export function useIngestJobs(): IngestApi {
  return useContext(Ctx);
}

const POLL_MS = 3000;
/** Give up following a doc after this long; the 站内通知 still arrives when it finishes. */
const POLL_MAX_MS = 15 * 60 * 1000;

// API error code → library_ui key (codes are never shown raw).
const ERROR_KEYS: Record<string, string> = {
  invalid_url: 'err_invalid_url',
  fetch_failed: 'err_fetch_failed',
  unsupported_content: 'err_unsupported_content',
  unsupported_type: 'err_unsupported_type',
  file_too_large: 'err_file_too_large',
  too_large: 'err_file_too_large',
  rate_limited: 'err_rate_limited',
};

interface CreateResponse {
  doc?: { id: string; slug: string; status: string };
  existing?: boolean;
  error?: string;
  reason?: string;
}

export function IngestJobsProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('library_ui');
  const tv = useTranslations('video');
  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const pollTimers = useRef(new Map<string, number>());

  const patch = useCallback((id: string, p: Partial<IngestJob>) => {
    setJobs((list) => list.map((j) => (j.id === id ? { ...j, ...p } : j)));
  }, []);

  const errorText = useCallback(
    (status: number, data: CreateResponse): string => {
      if (data.reason) return data.reason;
      if (data.error === 'unauthenticated' || status === 401) return tv('login_required');
      if (data.error && ERROR_KEYS[data.error]) return t(ERROR_KEYS[data.error]);
      if (status === 415) return t('err_unsupported_type');
      if (status === 413) return t('err_file_too_large');
      if (status === 502) return t('err_fetch_failed');
      if (status === 429) return t('err_rate_limited');
      return t('action_failed');
    },
    [t, tv],
  );

  /** Follow a created doc until extraction + 导读 settle (or the poll budget runs out). */
  const follow = useCallback(
    (jobId: string, docId: string) => {
      const started = Date.now();
      const tick = async () => {
        try {
          const res = await fetch(`/api/library/docs/${docId}`);
          const doc = (await res.json().catch(() => null)) as
            | { title?: string; slug?: string; status: string; aiIndexState: string; processingError?: string | null }
            | null;
          if (res.ok && doc) {
            const settled = settleFromPoll(doc);
            const titled = doc.title ? { title: doc.title, slug: doc.slug ?? null } : {};
            if (settled) {
              patch(jobId, { ...titled, stage: settled.stage, aiOk: settled.aiOk, error: settled.error, percent: null });
              pollTimers.current.delete(jobId);
              return;
            }
            if (doc.title) patch(jobId, titled);
          }
        } catch {
          /* transient — try again */
        }
        if (Date.now() - started > POLL_MAX_MS) {
          // Stop following; the 站内通知 covers the ending.
          patch(jobId, { stage: 'done', aiOk: null });
          pollTimers.current.delete(jobId);
          return;
        }
        pollTimers.current.set(jobId, window.setTimeout(tick, POLL_MS));
      };
      pollTimers.current.set(jobId, window.setTimeout(tick, POLL_MS));
    },
    [patch],
  );

  useEffect(() => {
    const timers = pollTimers.current;
    return () => timers.forEach((h) => window.clearTimeout(h));
  }, []);

  /** The create call answered: either a doc to follow, a duplicate, or an error. */
  const settleCreate = useCallback(
    (jobId: string, status: number, data: CreateResponse) => {
      if (status >= 200 && status < 300 && data.doc) {
        if (data.existing) {
          patch(jobId, { stage: 'existing', docId: data.doc.id, slug: data.doc.slug, percent: null });
          return;
        }
        patch(jobId, { stage: 'indexing', docId: data.doc.id, slug: data.doc.slug, percent: null });
        follow(jobId, data.doc.id);
        return;
      }
      patch(jobId, { stage: 'failed', error: errorText(status, data), percent: null });
    },
    [errorText, follow, patch],
  );

  const newJob = useCallback((kind: IngestKind, label: string, stage: IngestJob['stage']): IngestJob => {
    return {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      label,
      stage,
      percent: kind === 'file' ? 0 : null,
      docId: null,
      slug: null,
      title: null,
      aiOk: null,
      error: null,
      startedAt: Date.now(),
    };
  }, []);

  const startUrl = useCallback(
    (url: string, opts: IngestOptions) => {
      const job = newJob('url', url, 'fetching');
      setJobs((list) => [job, ...list]);
      void (async () => {
        try {
          const res = await fetch('/api/library/docs', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              url,
              ...(opts.docType && opts.docType !== 'auto' ? { docType: opts.docType } : {}),
              ...(opts.categories?.length ? { categories: opts.categories } : {}),
            }),
          });
          const data = (await res.json().catch(() => ({}))) as CreateResponse;
          settleCreate(job.id, res.status, data);
        } catch {
          patch(job.id, { stage: 'failed', error: t('network_error') });
        }
      })();
    },
    [newJob, patch, settleCreate, t],
  );

  const startFile = useCallback(
    (file: File, opts: IngestOptions) => {
      const job = newJob('file', file.name, 'uploading');
      setJobs((list) => [job, ...list]);
      // XHR (not fetch) for upload progress; the fetch basePath shim does not cover XHR.
      const xhr = new XMLHttpRequest();
      xhr.open('POST', withBasePath('/api/library/upload'));
      xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
      if (opts.docType && opts.docType !== 'auto') xhr.setRequestHeader('x-doc-type', opts.docType);
      if (opts.categories?.length) xhr.setRequestHeader('x-categories', JSON.stringify(opts.categories));
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable || e.total <= 0) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        patch(job.id, pct >= 100 ? { stage: 'parsing', percent: 100 } : { stage: 'uploading', percent: pct });
      };
      xhr.upload.onload = () => patch(job.id, { stage: 'parsing', percent: 100 });
      xhr.onerror = () => patch(job.id, { stage: 'failed', error: t('network_error'), percent: null });
      xhr.onload = () => {
        let data: CreateResponse = {};
        try {
          data = JSON.parse(xhr.responseText) as CreateResponse;
        } catch {
          /* non-JSON → generic error */
        }
        settleCreate(job.id, xhr.status, data);
      };
      xhr.send(file);
    },
    [newJob, patch, settleCreate, t],
  );

  const active = useMemo(() => jobs.some(isActiveJob), [jobs]);
  const openDialog = useCallback(() => setDialogOpen(true), []);
  const minimize = useCallback(() => {
    setDialogOpen(false);
    if (active) pushToast('info', t('ingest_minimized_toast'));
  }, [active, t]);
  const closeDialog = useCallback(() => {
    if (active) minimize();
    else setDialogOpen(false);
  }, [active, minimize]);
  const dismiss = useCallback((id: string) => setJobs((list) => list.filter((j) => j.id !== id || isActiveJob(j))), []);
  const dismissFinished = useCallback(() => setJobs((list) => list.filter(isActiveJob)), []);

  const api = useMemo<IngestApi>(
    () => ({ jobs, dialogOpen, openDialog, closeDialog, minimize, startUrl, startFile, dismiss, dismissFinished }),
    [jobs, dialogOpen, openDialog, closeDialog, minimize, startUrl, startFile, dismiss, dismissFinished],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <AddDocDialog />
      <IngestDock />
    </Ctx.Provider>
  );
}
