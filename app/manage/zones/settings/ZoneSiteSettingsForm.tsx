'use client';

// 技术专区首页设置表单（/manage 全站中文）：三种语言的文案 tab + 四个模块开关，一个保存按钮。
// PUT /api/admin/zones/settings { copy, showWall, showTotals, showHotRail, showFeatured }。
// 每个输入框的 placeholder 就是该语言的系统默认文案，留空即用默认。

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import {
  ZONE_COPY_FIELDS,
  ZONE_COPY_LIMITS,
  ZONE_COPY_LOCALES,
  type ZoneCopyField,
  type ZoneCopyLocale,
  type ZoneHubCopy,
  type ZoneSiteCopy,
  type ZoneSiteSettingView,
} from '@/lib/zones/site-settings-shared';
import { ADMIN_INPUT_CLS, ADMIN_PRIMARY_BTN, adminJson } from '../_components/admin-fetch';

const LOCALE_LABEL: Record<ZoneCopyLocale, string> = { 'zh-CN': '中文', en: 'English', fr: 'Français' };

const FIELD_META: Record<ZoneCopyField, { label: string; hint: string; multiline?: boolean }> = {
  eyebrow: { label: '顶部小字', hint: '标题上方的一行小字（等宽、大写字距），如「各实验室的技术阵地」。' },
  title: { label: '标题', hint: '首页大标题，也用作浏览器标签页标题。' },
  subtitle: { label: '副标题', hint: '标题下面的一句话，说明技术专区是做什么的。', multiline: true },
  createTitle: { label: '「开一个版块」卡片标题', hint: '动态流右侧「开一个版块」卡片的标题（仅有创建权限的成员可见）。' },
  createDesc: { label: '「开一个版块」卡片说明', hint: '同一张卡片下面的说明文字。', multiline: true },
};

const TOGGLES: ReadonlyArray<{ key: 'showWall' | 'showTotals' | 'showHotRail' | 'showFeatured'; label: string; hint: string }> = [
  { key: 'showWall', label: '显示版块墙', hint: '首页右侧的 3D 版块墙（宽屏才显示）。关闭后左侧文案占满整行。' },
  { key: 'showTotals', label: '显示统计数字', hint: '标题下的 版块 / 帖子 / 成员 三个数字。' },
  { key: 'showHotRail', label: '显示热门版块侧栏', hint: '「动态」tab 右侧的热门版块榜与「开一个版块」卡片。' },
  { key: 'showFeatured', label: '显示精选版块', hint: '「版块」tab 顶部的精选版块横条（在版块管理里标记精选）。' },
];

type CopyDraft = Record<ZoneCopyLocale, ZoneHubCopy>;

function seedDraft(copy: ZoneSiteCopy): CopyDraft {
  const out = {} as CopyDraft;
  for (const locale of ZONE_COPY_LOCALES) {
    const block = copy[locale] ?? {};
    const entry = {} as ZoneHubCopy;
    for (const field of ZONE_COPY_FIELDS) entry[field] = block[field] ?? '';
    out[locale] = entry;
  }
  return out;
}

export function ZoneSiteSettingsForm({
  initial,
  defaults,
}: {
  initial: ZoneSiteSettingView;
  defaults: Record<ZoneCopyLocale, ZoneHubCopy>;
}) {
  const router = useRouter();
  const [locale, setLocale] = useState<ZoneCopyLocale>('zh-CN');
  const [copy, setCopy] = useState<CopyDraft>(() => seedDraft(initial.copy));
  const [toggles, setToggles] = useState({
    showWall: initial.showWall,
    showTotals: initial.showTotals,
    showHotRail: initial.showHotRail,
    showFeatured: initial.showFeatured,
  });
  const [saving, setSaving] = useState(false);

  function setField(field: ZoneCopyField, value: string) {
    setCopy((prev) => ({ ...prev, [locale]: { ...prev[locale], [field]: value } }));
  }

  function filledCount(l: ZoneCopyLocale): number {
    return ZONE_COPY_FIELDS.filter((f) => copy[l][f].trim()).length;
  }

  async function save() {
    setSaving(true);
    try {
      await adminJson('/api/admin/zones/settings', { method: 'PUT', json: { copy, ...toggles } }, '保存失败');
      pushToast('success', '已保存，首页约 30 秒内生效');
      router.refresh();
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  const textareaCls =
    'min-h-[72px] w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-[13px] outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600';

  return (
    <div className="space-y-4">
      <section className="surface rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">首页文案</h3>
          <div className="flex items-center gap-1 rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
            {ZONE_COPY_LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  locale === l
                    ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                }`}
              >
                {LOCALE_LABEL[l]}
                {filledCount(l) > 0 && <span className="ml-1 font-mono tabular-nums opacity-70">{filledCount(l)}</span>}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs text-muted">
          灰色占位文字就是当前语言的系统默认。留空 = 用默认；英文 / 法文留空而中文填了，则显示中文。
        </p>

        <div className="mt-4 space-y-4">
          {ZONE_COPY_FIELDS.map((field) => {
            const meta = FIELD_META[field];
            const value = copy[locale][field];
            const limit = ZONE_COPY_LIMITS[field];
            return (
              <div key={field}>
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor={`copy-${locale}-${field}`} className="text-xs font-medium">
                    {meta.label}
                  </label>
                  <span className="font-mono text-[11px] tabular-nums text-muted">
                    {value.length}/{limit}
                  </span>
                </div>
                {meta.multiline ? (
                  <textarea
                    id={`copy-${locale}-${field}`}
                    value={value}
                    maxLength={limit}
                    onChange={(e) => setField(field, e.target.value)}
                    placeholder={defaults[locale][field]}
                    className={`mt-1 ${textareaCls}`}
                  />
                ) : (
                  <input
                    id={`copy-${locale}-${field}`}
                    value={value}
                    maxLength={limit}
                    onChange={(e) => setField(field, e.target.value)}
                    placeholder={defaults[locale][field]}
                    className={`mt-1 ${ADMIN_INPUT_CLS} w-full`}
                  />
                )}
                <p className="mt-1 text-[11px] text-muted">{meta.hint}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="surface rounded-xl p-4">
        <h3 className="text-sm font-semibold">首页模块</h3>
        <ul className="mt-3 space-y-2">
          {TOGGLES.map((tg) => (
            <li key={tg.key}>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={toggles[tg.key]}
                  onChange={(e) => setToggles((prev) => ({ ...prev, [tg.key]: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
                />
                <span>
                  <span className="block text-[13px] font-medium">{tg.label}</span>
                  <span className="block text-[11px] text-muted">{tg.hint}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex justify-end">
        <button type="button" disabled={saving} onClick={save} className={ADMIN_PRIMARY_BTN}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存
        </button>
      </div>
    </div>
  );
}
