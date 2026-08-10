'use client';

// A sticker embedded in rendered markdown (detected by the /api/uploads/stickers/
// URL prefix in MarkdownRenderer). Renders at a fixed constrained box — explicit
// width/height so clamped feed cards measure overflow correctly before the image
// loads — and, like WeChat, clicking someone's sticker offers 添加到表情包.
//
// This is a client leaf imported by the (server-rendered) MarkdownRenderer; all
// interactivity must live here, never inline in the renderer's component map.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, SmilePlus } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { pushToast } from '@/components/Toaster';
import { stickerKeyFromSrc } from '@/lib/stickers';

const STICKER_BOX = 112; // px — WeChat renders received stickers around this size

export function StickerImage({ src, alt }: { src: string; alt?: string }) {
  const t = useTranslations('stickers');
  const router = useRouter();
  const pathname = usePathname();

  const wrapRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      // The menu is portaled — check BOTH trees or a mousedown on the menu
      // button unmounts it before its click can fire.
      if (wrapRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onScroll = () => close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [menu, close]);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      // Cards wrap bodies in stretched links — the sticker click must not navigate.
      e.preventDefault();
      e.stopPropagation();
      if (menu) {
        close();
        return;
      }
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenu({
        top: rect.bottom + 6,
        left: Math.min(Math.max(8, rect.left), window.innerWidth - 168),
      });
    },
    [menu, close],
  );

  const addToMine = useCallback(async () => {
    const key = stickerKeyFromSrc(src);
    if (!key || busy) return;
    setBusy(true);
    try {
      const res = await fetch(withBasePath('/api/stickers/add'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (res.status === 401) {
        pushToast('error', t('login_hint'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; existed?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        pushToast('error', data?.error === 'sticker_limit' ? t('err_limit') : t('err_action_failed'));
        return;
      }
      pushToast('success', data.existed ? t('already_added') : t('added'));
    } catch {
      pushToast('error', t('err_action_failed'));
    } finally {
      setBusy(false);
      close();
    }
  }, [src, busy, t, router, pathname, close]);

  return (
    <span ref={wrapRef} className="not-prose relative z-10 my-1 inline-block align-bottom">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={withBasePath(src)}
        alt={alt || t('sticker_alt')}
        loading="lazy"
        width={STICKER_BOX}
        height={STICKER_BOX}
        draggable={false}
        onClick={onClick}
        className="cursor-pointer rounded-lg object-contain"
        style={{ width: STICKER_BOX, height: STICKER_BOX }}
      />
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="surface fixed z-[100] w-40 rounded-xl p-1 shadow-lg"
            style={{ top: menu.top, left: menu.left }}
            // Keep clicks inside the menu from bubbling into stretched-link cards.
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <button
              type="button"
              disabled={busy}
              onClick={addToMine}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-zinc-100 disabled:opacity-60 dark:hover:bg-zinc-800"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SmilePlus className="h-4 w-4" />
              )}
              {t('add_to_mine')}
            </button>
          </div>,
          document.body,
        )}
    </span>
  );
}
