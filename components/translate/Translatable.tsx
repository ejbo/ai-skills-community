'use client';

// 站内翻译 — the ONE affordance (X's 「翻译 / 显示原文」). A render-prop, so every
// surface keeps its own renderer and layout and only swaps the TEXT it renders:
//
//   <Translatable kind="post_comment" id={c.id} fields={{ body: c.bodyMd }}>
//     {(t) => (
//       <div ref={t.ref}>
//         {t.note}                                    ← 译自中文 · GLM · 显示原文 · ⚙ (only while translated)
//         <MarkdownRenderer content={t.body} compact />
//         <div className="action-row">… {t.control}</div>   ← 翻译 / 翻译中… / 显示译文
//       </div>
//     )}
//   </Translatable>
//
// Do NOT fork this per surface (the like-button lesson). What it guarantees:
//   · The link renders only when it can do something: an engine exists, the viewer
//     may use it, the text has prose, and its language is neither the viewer's nor
//     one they marked 「不翻译」. All of that is decided from props + the server-
//     seeded context with PURE functions, so SSR and hydration agree.
//   · A translation is viewer-side render state. 显示原文 is always one click away,
//     auto-translated items included; nothing is ever written to content.
//   · 自动翻译: when the item nears the viewport it asks the cache-only batch route;
//     `pending` items go through the single route (where the model and the rate
//     limit live). Failures in auto mode are SILENT — the manual link stays.
//   · The client never sends text: `{kind, id}` only. `fields` is what THIS page
//     already rendered; it is hashed for the local cache key, and that is all.
//
// Chrome is ink (配色契约): a quiet text link + a one-line muted attribution. No
// pill, no accent, no sparkle. `tone` exists because three grounds are in play:
// the site theme, the 知识库 reader's own theme (`dark:` is wrong there half the
// time) and always-dark surfaces (投票 lightbox, shorts).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Languages, Loader2, Settings2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { useAnchoredPanel } from '@/components/useAnchoredPanel';
import { currentLoginHref } from '@/lib/auth/callback-path';
import { detectContentLang, worthOffering } from '@/lib/translate/detect';
import { TRANSLATE_KINDS, type ContentLang, type FieldName, type TranslateKind, type TranslationView } from '@/lib/translate/shared';
import { useTranslatePrefs } from './TranslatePrefs';
import { peekTranslation, requestCached, requestTranslation, type TranslateAsk } from './translate-client';

export type TranslateTone = 'default' | 'reader' | 'onDark';

export interface TranslatableRender {
  /** The text to render NOW — the translation while it is showing, else the original. */
  title: string;
  summary: string;
  body: string;
  translated: boolean;
  /** Attach to the item's container: 自动翻译 waits until it nears the viewport. Optional. */
  ref: (el: Element | null) => void;
  /** 翻译 / 翻译中… / 显示译文 — null while the translation is showing or when there is nothing to offer. */
  control: ReactNode;
  /** 「译自{lang} · {engine} · 显示原文 · ⚙」 — null unless the translation is showing. */
  note: ReactNode;
}

interface Props {
  kind: TranslateKind;
  id: string;
  fields: Partial<Record<FieldName, string | null | undefined>>;
  tone?: TranslateTone;
  /** Turn the affordance off (a tombstoned comment, an item being edited in place). */
  disabled?: boolean;
  children: (t: TranslatableRender) => ReactNode;
}

const TONES: Record<TranslateTone, { link: string; note: string; rule: string }> = {
  default: {
    link: 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
    note: 'text-zinc-500 dark:text-zinc-400',
    rule: 'border-zinc-200 dark:border-zinc-800',
  },
  reader: {
    link: 'r-muted hover:text-[var(--reader-fg)]',
    note: 'r-muted',
    rule: 'border-[var(--reader-border)]',
  },
  onDark: { link: 'text-white/60 hover:text-white', note: 'text-white/60', rule: 'border-white/20' },
};

const NOOP_REF = () => undefined;

export function Translatable({ kind, id, fields, tone = 'default', disabled = false, children }: Props) {
  const t = useTranslations('translate');
  const tl = useTranslations('labels');
  const prefs = useTranslatePrefs();
  const router = useRouter();

  const original = useMemo(
    () => ({ title: fields.title ?? '', summary: fields.summary ?? '', body: fields.body ?? '' }),
    [fields.title, fields.summary, fields.body],
  );
  const all = useMemo(() => [original.title, original.summary, original.body].filter(Boolean).join('\n\n'), [original]);
  const detected = useMemo(() => detectContentLang(original.body || all) ?? detectContentLang(all), [original.body, all]);

  const allowed = prefs.signedIn || TRANSLATE_KINDS[kind].public;
  const eligible =
    !disabled && prefs.available && allowed && detected !== prefs.viewerLang && !(detected && prefs.skipLangs.includes(detected)) && worthOffering(all);

  const ask: TranslateAsk = useMemo(() => ({ kind, id, target: prefs.viewerLang, text: all }), [kind, id, prefs.viewerLang, all]);

  const [view, setView] = useState<TranslationView | null>(null);
  const [showing, setShowing] = useState(false);
  const [loading, setLoading] = useState(false);
  /** The server said `same` / `nothing` — the link has nothing to do here. */
  const [spent, setSpent] = useState(false);
  const askRef = useRef(ask);
  askRef.current = ask;

  // New text (an in-place edit) or a new target language ⇒ start over — from whatever this
  // page already knows. In 自动翻译 a known translation is SHOWN straight away: an item that
  // re-mounts (a feed preview swapping for the full thread, a drawer reopening) used to fall
  // back to the original, because the auto effect only runs while there is no view yet.
  // Flipping the mode re-runs this too: ON reveals what is cached, OFF returns to originals.
  useEffect(() => {
    const known = peekTranslation(ask);
    setView(known?.status === 'ok' ? known : null);
    setSpent(known?.status === 'same' || known?.status === 'nothing');
    setShowing(known?.status === 'ok' && prefs.autoTranslate);
    setLoading(false);
  }, [ask, prefs.autoTranslate]);

  const settle = useCallback(
    (outcome: Awaited<ReturnType<typeof requestTranslation>>, mine: TranslateAsk, manual: boolean): boolean => {
      if (askRef.current !== mine) return false; // the item changed under us
      if (outcome.status === 'ok') {
        setView(outcome);
        setShowing(true);
        return true;
      }
      if (outcome.status === 'same' || outcome.status === 'nothing') {
        setSpent(true);
        return true;
      }
      if (!manual) return false; // 自动翻译 fails silently; the manual link stays
      if (outcome.status === 'pending' || (outcome.status === 'error' && outcome.error === 'unauthenticated')) {
        pushToast('error', t('login_required'));
        router.push(currentLoginHref());
      } else if (outcome.status === 'error') {
        if (outcome.error === 'translate_unavailable') prefs.markUnavailable();
        pushToast(
          'error',
          outcome.error === 'translate_too_long'
            ? t('too_long')
            : outcome.error === 'translate_rate_limited'
              ? t('rate_limited')
              : outcome.error === 'translate_unavailable'
                ? t('unavailable')
                : t('failed_retry'),
        );
      }
      return false;
    },
    [prefs, router, t],
  );

  const translateNow = useCallback(async () => {
    if (loading) return;
    if (view) {
      setShowing(true);
      return;
    }
    const mine = askRef.current;
    setLoading(true);
    try {
      settle(await requestTranslation(mine), mine, true);
    } finally {
      if (askRef.current === mine) setLoading(false);
    }
  }, [loading, view, settle]);

  // ── 自动翻译 ──────────────────────────────────────────────────────────────
  // The container lives in a REF, not in state: a callback ref runs during commit, so the
  // effect below already sees the element on its first run. With state, the first run saw
  // `null`, fired at once, and was then cancelled by the re-run the state update caused —
  // and because `autoTried` was already set, the dropped answer was never asked for again
  // (nothing ever auto-translated). For the same reason an in-flight request is NEVER
  // cancelled by an effect re-run: only the item changing (`settle` checks `askRef`) or the
  // component unmounting may discard it.
  const targetRef = useRef<Element | null>(null);
  const setTarget = useCallback((el: Element | null) => {
    targetRef.current = el;
  }, []);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const settleRef = useRef(settle);
  settleRef.current = settle;
  const autoTried = useRef<TranslateAsk | null>(null);
  const wantAuto = eligible && prefs.autoTranslate && !view && !spent;
  const signedIn = prefs.signedIn;
  useEffect(() => {
    if (!wantAuto || autoTried.current === ask) return;
    const run = async () => {
      if (autoTried.current === ask) return;
      autoTried.current = ask;
      const first = await requestCached(ask);
      if (!aliveRef.current) return;
      if (first.status === 'pending' && signedIn) {
        if (askRef.current === ask) setLoading(true);
        try {
          const second = await requestTranslation(ask);
          if (aliveRef.current) settleRef.current(second, ask, false);
        } finally {
          if (aliveRef.current && askRef.current === ask) setLoading(false);
        }
      } else settleRef.current(first, ask, false);
    };
    const el = targetRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      void run();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void run();
        }
      },
      { rootMargin: '300px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [wantAuto, ask, signedIn]);

  const tn = TONES[tone];
  const linkCls = `inline-flex items-center gap-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:underline disabled:cursor-default ${tn.link}`;
  const translated = showing && view !== null;

  let control: ReactNode = null;
  if (eligible && !spent && !translated) {
    control = loading ? (
      <span className={`inline-flex items-center gap-1 text-xs font-medium ${tn.note}`} aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        {t('translating')}
      </span>
    ) : (
      <button type="button" onClick={() => void translateNow()} className={linkCls}>
        <Languages className="h-3.5 w-3.5" aria-hidden />
        {view ? t('show_translation') : t('translate')}
      </button>
    );
  }

  const note: ReactNode =
    translated && view ? (
      <TranslationNote
        view={view}
        tone={tone}
        langName={tl(`lang.${view.sourceLang ?? 'unknown'}`)}
        onShowOriginal={() => setShowing(false)}
      />
    ) : null;

  return (
    <>
      {children({
        title: translated ? view?.fields.title ?? original.title : original.title,
        summary: translated ? view?.fields.summary ?? original.summary : original.summary,
        body: translated ? view?.fields.body ?? original.body : original.body,
        translated,
        ref: eligible ? setTarget : NOOP_REF,
        control,
        note,
      })}
    </>
  );
}

/** 「译自中文 · GLM-5.1 · 部分段落未翻译 · 显示原文 ⚙」 */
function TranslationNote({ view, tone, langName, onShowOriginal }: { view: TranslationView; tone: TranslateTone; langName: string; onShowOriginal: () => void }) {
  const t = useTranslations('translate');
  const tn = TONES[tone];
  return (
    <div className={`mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 border-l-2 pl-2 text-[11px] leading-5 ${tn.note} ${tn.rule}`}>
      <Languages className="h-3 w-3 shrink-0" aria-hidden />
      <span>{view.engine ? t('translated_from', { lang: langName, engine: view.engine }) : t('translated_from_plain', { lang: langName })}</span>
      {view.state === 'partial' && (
        <>
          <span aria-hidden>·</span>
          <span>{t('partial')}</span>
        </>
      )}
      <span aria-hidden>·</span>
      <button type="button" onClick={onShowOriginal} className={`font-medium underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:underline ${tn.link}`}>
        {t('show_original')}
      </button>
      <TranslateGear sourceLang={view.sourceLang} langName={langName} tone={tone} />
    </div>
  );
}

const GEAR_W = 232;

/** The per-language escape hatch X users begged for: 「不翻译{lang}」 + the 自动翻译 switch, on every translated item. */
function TranslateGear({ sourceLang, langName, tone }: { sourceLang: ContentLang | null; langName: string; tone: TranslateTone }) {
  const t = useTranslations('translate');
  const prefs = useTranslatePrefs();
  const panel = useAnchoredPanel<HTMLButtonElement>({ width: GEAR_W, height: 120, align: 'left' });
  if (!prefs.signedIn) return null;
  const tn = TONES[tone];

  const row =
    'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-xs text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:bg-zinc-100 focus-visible:outline-none dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800';

  return (
    <>
      <button
        ref={panel.triggerRef}
        type="button"
        onClick={panel.toggle}
        aria-label={t('settings_aria')}
        aria-expanded={panel.open}
        title={t('settings_aria')}
        className={`grid h-5 w-5 place-items-center rounded transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current ${tn.link}`}
      >
        <Settings2 className="h-3 w-3" aria-hidden />
      </button>
      {panel.open &&
        panel.host &&
        createPortal(
          <div
            ref={panel.panelRef}
            role="menu"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                panel.close(true);
              }
            }}
            // Portaled: cards are `overflow-hidden` / `card-hover`-transformed and would clip or re-parent a fixed box.
            className="fixed z-[115] rounded-xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
            style={{ left: panel.pos?.left ?? 0, top: panel.pos?.top ?? 0, width: GEAR_W, visibility: panel.pos ? 'visible' : 'hidden' }}
          >
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={prefs.autoTranslate}
              className={row}
              onClick={async () => {
                const next = !prefs.autoTranslate;
                if (!(await prefs.setAutoTranslate(next))) pushToast('error', t('save_failed'));
              }}
            >
              <span>{t('auto_translate')}</span>
              <span className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${prefs.autoTranslate ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-300 dark:bg-zinc-700'}`} aria-hidden>
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all dark:bg-zinc-900 ${prefs.autoTranslate ? 'left-3.5' : 'left-0.5'}`} />
              </span>
            </button>
            {sourceLang && (
              <button
                type="button"
                role="menuitem"
                className={row}
                onClick={async () => {
                  panel.close();
                  if (!(await prefs.setSkipLang(sourceLang, true))) pushToast('error', t('save_failed'));
                }}
              >
                {t('never_translate', { lang: langName })}
              </button>
            )}
          </div>,
          panel.host,
        )}
    </>
  );
}
