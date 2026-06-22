'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Code2, Eye, FileText, Folder, FolderOpen, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import DOMPurify from 'dompurify';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { CodeViewer } from '@/components/CodeViewer';
import { buildFileTree, type TreeNode } from '@/lib/skill-tree';
import { splitFrontmatter } from '@/lib/frontmatter';

interface FileMeta {
  path: string;
  size: number;
  isText: boolean;
}
interface ContentResp {
  path: string;
  isText: boolean;
  content: string | null;
  truncated: boolean;
  size: number;
}

function pickDefault(files: FileMeta[]): string | null {
  const skillMd = files.find((f) => /(^|\/)SKILL\.md$/i.test(f.path));
  if (skillMd) return skillMd.path;
  const readme = files.find((f) => /(^|\/)readme/i.test(f.path));
  if (readme) return readme.path;
  return files[0]?.path ?? null;
}

export function FilesTab({ slug }: { slug: string }) {
  const t = useTranslations('detail.files');
  const [files, setFiles] = useState<FileMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<ContentResp | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    fetch(`/api/skills/${slug}/files`)
      .then(async (res) => {
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setError(data.reason ?? data.error ?? '加载失败');
          return;
        }
        setFiles(data.files);
        const top = new Set<string>(
          (data.files as FileMeta[])
            .filter((f) => f.path.includes('/'))
            .map((f) => f.path.split('/')[0]),
        );
        setExpanded(top);
        const def = pickDefault(data.files);
        if (def) setSelected(def);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : '加载失败'));
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setLoadingContent(true);
    setContent(null);
    fetch(`/api/skills/${slug}/files/content?path=${encodeURIComponent(selected)}`)
      .then(async (res) => {
        const data = await res.json();
        if (alive && res.ok) setContent(data);
      })
      .finally(() => alive && setLoadingContent(false));
    return () => {
      alive = false;
    };
  }, [slug, selected]);

  const tree = useMemo(() => (files ? buildFileTree(files) : []), [files]);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  if (error) {
    return (
      <div className="surface rounded-2xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
        {error}
      </div>
    );
  }
  if (!files) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
      </div>
    );
  }
  if (files.length === 0) {
    return <div className="text-sm text-muted">{t('empty')}</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:h-[78vh] md:grid-cols-[260px_1fr]">
      {/* File tree — scrolls on its own */}
      <div className="surface max-h-[45vh] overflow-auto rounded-2xl p-2 md:max-h-none md:h-full">
        <TreeView
          nodes={tree}
          selected={selected}
          expanded={expanded}
          onToggle={toggle}
          onSelect={setSelected}
        />
      </div>
      {/* Content — pinned header, body scrolls on its own */}
      <div className="surface flex max-h-[80vh] min-h-[50vh] flex-col overflow-hidden rounded-2xl md:max-h-none md:h-full">
        {!selected ? (
          <div className="p-4 text-sm text-muted">{t('select')}</div>
        ) : loadingContent ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
          </div>
        ) : content ? (
          <FileView content={content} truncatedLabel={t('truncated')} binaryLabel={t('binary')} />
        ) : (
          <div className="p-4 text-sm text-muted">{t('select')}</div>
        )}
      </div>
    </div>
  );
}

function TreeView({
  nodes,
  selected,
  expanded,
  onToggle,
  onSelect,
  depth = 0,
}: {
  nodes: TreeNode[];
  selected: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => {
        const isOpen = expanded.has(node.path);
        if (node.type === 'dir') {
          return (
            <li key={node.path}>
              <button
                onClick={() => onToggle(node.path)}
                className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                style={{ paddingLeft: `${depth * 12 + 6}px` }}
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
                {isOpen ? (
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent-500" />
                ) : (
                  <Folder className="h-3.5 w-3.5 shrink-0 text-accent-500" />
                )}
                <span className="truncate">{node.name}</span>
              </button>
              {isOpen && node.children && (
                <TreeView
                  nodes={node.children}
                  selected={selected}
                  expanded={expanded}
                  onToggle={onToggle}
                  onSelect={onSelect}
                  depth={depth + 1}
                />
              )}
            </li>
          );
        }
        const active = node.path === selected;
        return (
          <li key={node.path}>
            <button
              onClick={() => onSelect(node.path)}
              className={`flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-sm ${
                active
                  ? 'bg-accent-500/10 text-accent-700 dark:text-accent-300'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
              }`}
              style={{ paddingLeft: `${depth * 12 + 22}px` }}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted" />
              <span className="truncate">{node.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function FileView({
  content,
  truncatedLabel,
  binaryLabel,
}: {
  content: ContentResp;
  truncatedLabel: string;
  binaryLabel: string;
}) {
  const isMarkdown = /\.(md|markdown)$/i.test(content.path);
  const isHtml = /\.(html?|xhtml)$/i.test(content.path);
  const renderable = (isMarkdown || isHtml) && content.isText && content.content !== null;
  const [view, setView] = useState<'rendered' | 'raw'>('rendered');
  // Each newly opened file defaults to the rendered view.
  useEffect(() => setView('rendered'), [content.path]);

  const showRendered = renderable && view === 'rendered';

  return (
    <>
      {/* Pinned header — never scrolls */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted" />
          <Breadcrumb path={content.path} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {renderable && <ViewToggle view={view} onChange={setView} />}
          <span className="font-mono text-[10px] text-muted">{(content.size / 1024).toFixed(1)} KB</span>
        </div>
      </div>

      {/* Body — scrolls independently of the tree and the header */}
      <div className="min-h-0 flex-1 overflow-auto">
        {!content.isText || content.content === null ? (
          <div className="p-4 text-sm text-muted">{binaryLabel}</div>
        ) : showRendered ? (
          <div className="p-4">
            {isMarkdown ? (
              <MarkdownFile content={content.content} />
            ) : (
              <HtmlViewer html={content.content} />
            )}
          </div>
        ) : (
          <CodeViewer path={content.path} content={content.content} lineNumbers />
        )}
        {content.truncated && <div className="px-4 py-2 text-[11px] text-warn">{truncatedLabel}</div>}
      </div>
    </>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: 'rendered' | 'raw';
  onChange: (v: 'rendered' | 'raw') => void;
}) {
  const base = 'inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition';
  const on = 'bg-accent-500/10 text-accent-700 dark:text-accent-300';
  const off = 'text-muted hover:bg-zinc-100 dark:hover:bg-zinc-800';
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <button onClick={() => onChange('rendered')} className={`${base} ${view === 'rendered' ? on : off}`}>
        <Eye className="h-3 w-3" /> 渲染
      </button>
      <button
        onClick={() => onChange('raw')}
        className={`${base} border-l border-zinc-200 dark:border-zinc-800 ${view === 'raw' ? on : off}`}
      >
        <Code2 className="h-3 w-3" /> 原始
      </button>
    </div>
  );
}

function Breadcrumb({ path }: { path: string }) {
  const parts = path.split('/');
  return (
    <span className="truncate font-mono text-xs">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="text-zinc-300 dark:text-zinc-600"> / </span>}
          <span
            className={
              i === parts.length - 1 ? 'font-medium text-zinc-700 dark:text-zinc-200' : 'text-muted'
            }
          >
            {p}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Render a markdown file. SKILL.md leads with a `---` YAML frontmatter block that
 * markdown would otherwise turn into a giant setext heading; pull it out and show
 * it as a tidy metadata panel, then render the body normally.
 */
function MarkdownFile({ content }: { content: string }) {
  const { fields, body } = useMemo(() => splitFrontmatter(content), [content]);
  return (
    <div className="space-y-4">
      {fields && <FrontmatterPanel fields={fields} />}
      <MarkdownRenderer content={body} />
    </div>
  );
}

function FrontmatterPanel({ fields }: { fields: Array<{ key: string; value: string }> }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Frontmatter
      </div>
      <dl className="space-y-1.5">
        {fields.map((f) => (
          <div key={f.key} className="grid grid-cols-[88px_1fr] gap-2 text-xs">
            <dt className="font-mono font-medium text-muted">{f.key}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300">
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Render a standalone .html file, sanitized in the browser with DOMPurify. */
function HtmlViewer({ html }: { html: string }) {
  const clean = useMemo(
    () => (typeof window === 'undefined' ? '' : DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })),
    [html],
  );
  return (
    <div
      className="prose prose-zinc max-w-none text-[15px] leading-relaxed dark:prose-invert"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
