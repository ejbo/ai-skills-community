'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import DOMPurify from 'dompurify';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { CodeViewer } from '@/components/CodeViewer';
import { buildFileTree, type TreeNode } from '@/lib/skill-tree';

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
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
      <div className="surface max-h-[70vh] overflow-auto rounded-2xl p-2">
        <TreeView
          nodes={tree}
          selected={selected}
          expanded={expanded}
          onToggle={toggle}
          onSelect={setSelected}
        />
      </div>
      <div className="surface min-h-[40vh] overflow-auto rounded-2xl p-4">
        {!selected ? (
          <div className="text-sm text-muted">{t('select')}</div>
        ) : loadingContent ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
          </div>
        ) : content ? (
          <FileView content={content} truncatedLabel={t('truncated')} binaryLabel={t('binary')} />
        ) : (
          <div className="text-sm text-muted">{t('select')}</div>
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
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between border-b border-zinc-100 pb-2 dark:border-zinc-800">
        <span className="font-mono text-xs text-muted">{content.path}</span>
        <span className="font-mono text-[10px] text-muted">{(content.size / 1024).toFixed(1)} KB</span>
      </div>
      {!content.isText || content.content === null ? (
        <div className="text-sm text-muted">{binaryLabel}</div>
      ) : isMarkdown ? (
        <MarkdownRenderer content={content.content} />
      ) : isHtml ? (
        <HtmlViewer html={content.content} />
      ) : (
        <CodeViewer path={content.path} content={content.content} />
      )}
      {content.truncated && <div className="text-[11px] text-warn">{truncatedLabel}</div>}
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
