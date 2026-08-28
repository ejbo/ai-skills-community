'use client';

// 技术专区 Wiki — collapsible page tree (left rail). Pure client state over
// the server-provided `tree`; reorder mode (canWiki) exposes 上移/下移/升级/降级
// buttons per row — no drag library. Every move rewrites a LOCAL copy of the
// tree, renumbers every sibling list, and POSTs the WHOLE flattened order set
// to /wiki/reorder (the server validates ids + cycles); on failure the previous
// tree is restored. A successful move refreshes the RSC so the server truth
// replaces the optimistic copy.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  FileText,
  IndentDecrease,
  IndentIncrease,
  ListTree,
} from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { zoneWikiHref } from '@/lib/zones/shared';
import type { WikiTreeNode } from '@/lib/zones/types';
import { currentLoginHref } from '@/lib/auth/callback-path';

export interface WikiTreeProps {
  zoneSlug: string;
  tree: WikiTreeNode[];
  activeId: string | null;
  canWiki: boolean;
  /** Case-insensitive title filter; non-empty switches to a flat result list. */
  filter?: string;
}

interface OrderRow {
  id: string;
  parentId: string | null;
  sortOrder: number;
}

interface Located {
  list: WikiTreeNode[];
  index: number;
  parentId: string | null;
}

// ── Pure tree helpers ────────────────────────────────────────────────────────

function cloneTree(nodes: WikiTreeNode[]): WikiTreeNode[] {
  return nodes.map((n) => ({ ...n, children: cloneTree(n.children) }));
}

function locate(nodes: WikiTreeNode[], id: string, parentId: string | null = null): Located | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.id === id) return { list: nodes, index: i, parentId };
    const hit = locate(n.children, id, n.id);
    if (hit) return hit;
  }
  return null;
}

function renumber(nodes: WikiTreeNode[], parentId: string | null = null): void {
  nodes.forEach((n, i) => {
    n.sortOrder = i;
    n.parentId = parentId;
    renumber(n.children, n.id);
  });
}

function flattenOrders(nodes: WikiTreeNode[], out: OrderRow[] = []): OrderRow[] {
  for (const n of nodes) {
    out.push({ id: n.id, parentId: n.parentId, sortOrder: n.sortOrder });
    flattenOrders(n.children, out);
  }
  return out;
}

/** Ids of every ancestor of `id` (root first); [] when not found / root-level. */
function ancestorIds(nodes: WikiTreeNode[], id: string | null, trail: string[] = []): string[] {
  if (!id) return [];
  for (const n of nodes) {
    if (n.id === id) return trail;
    const hit = ancestorIds(n.children, id, [...trail, n.id]);
    if (hit.length > 0) return hit;
  }
  return [];
}

function idsWithChildren(nodes: WikiTreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.children.length > 0) {
      out.push(n.id);
      idsWithChildren(n.children, out);
    }
  }
  return out;
}

interface FlatRow {
  node: WikiTreeNode;
  path: string[];
}

function flattenWithPath(nodes: WikiTreeNode[], path: string[] = [], out: FlatRow[] = []): FlatRow[] {
  for (const n of nodes) {
    out.push({ node: n, path });
    flattenWithPath(n.children, [...path, n.title], out);
  }
  return out;
}

// ── Component ────────────────────────────────────────────────────────────────

export function WikiTree({ zoneSlug, tree, activeId, canWiki, filter = '' }: WikiTreeProps) {
  const t = useTranslations('zones');
  const router = useRouter();
  // Adjust-state-on-prop-change (React docs pattern): a router.refresh() hands
  // us a new tree identity, which must win over the optimistic local copy.
  const [nodes, setNodes] = useState<WikiTreeNode[]>(tree);
  const [prevTree, setPrevTree] = useState(tree);
  if (prevTree !== tree) {
    setPrevTree(tree);
    setNodes(tree);
  }

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(idsWithChildren(tree)));
  const [prevActive, setPrevActive] = useState(activeId);
  if (prevActive !== activeId) {
    setPrevActive(activeId);
    const next = new Set(expanded);
    for (const id of ancestorIds(tree, activeId)) next.add(id);
    setExpanded(next);
  }

  const [reorder, setReorder] = useState(false);
  const [busy, setBusy] = useState(false);

  const query = filter.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return [];
    return flattenWithPath(nodes).filter((r) => r.node.title.toLowerCase().includes(query));
  }, [nodes, query]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyMove(op: (draft: WikiTreeNode[]) => boolean) {
    if (busy) return;
    const draft = cloneTree(nodes);
    if (!op(draft)) return;
    renumber(draft);
    const previous = nodes;
    setNodes(draft);
    setBusy(true);
    try {
      const res = await fetch(`/api/zones/${zoneSlug}/wiki/reorder`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orders: flattenOrders(draft) }),
      });
      if (res.status === 401) {
        setNodes(previous);
        pushToast('error', t('wiki_login_required'));
        router.push(currentLoginHref());
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
      if (!res.ok) {
        setNodes(previous);
        pushToast('error', data.reason ?? t('wiki_reorder_failed'));
        return;
      }
      router.refresh();
    } catch {
      setNodes(previous);
      pushToast('error', t('wiki_reorder_failed'));
    } finally {
      setBusy(false);
    }
  }

  const moveUp = (id: string) =>
    applyMove((d) => {
      const loc = locate(d, id);
      if (!loc || loc.index === 0) return false;
      const { list, index } = loc;
      [list[index - 1], list[index]] = [list[index], list[index - 1]];
      return true;
    });

  const moveDown = (id: string) =>
    applyMove((d) => {
      const loc = locate(d, id);
      if (!loc || loc.index >= loc.list.length - 1) return false;
      const { list, index } = loc;
      [list[index], list[index + 1]] = [list[index + 1], list[index]];
      return true;
    });

  /** 升级: become a sibling of the parent, placed right after it. */
  const outdent = (id: string) =>
    applyMove((d) => {
      const loc = locate(d, id);
      if (!loc || loc.parentId === null) return false;
      const parentLoc = locate(d, loc.parentId);
      if (!parentLoc) return false;
      const [node] = loc.list.splice(loc.index, 1);
      parentLoc.list.splice(parentLoc.index + 1, 0, node);
      return true;
    });

  /** 降级: become the last child of the previous sibling. */
  const indent = (id: string) =>
    applyMove((d) => {
      const loc = locate(d, id);
      if (!loc || loc.index === 0) return false;
      const prev = loc.list[loc.index - 1];
      const [node] = loc.list.splice(loc.index, 1);
      prev.children.push(node);
      setExpanded((e) => new Set(e).add(prev.id));
      return true;
    });

  if (nodes.length === 0) {
    return <p className="px-2 py-3 text-sm text-muted">{t('wiki_tree_empty')}</p>;
  }

  if (query) {
    return (
      <div>
        {matches.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted">{t('wiki_no_match')}</p>
        ) : (
          <ul className="space-y-0.5">
            {matches.map(({ node, path }) => {
              const active = node.id === activeId;
              return (
                <li key={node.id}>
                  <Link
                    href={zoneWikiHref(zoneSlug, node.slug)}
                    aria-current={active ? 'page' : undefined}
                    className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                      active
                        ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                        : 'text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50'
                    }`}
                  >
                    <span className="block truncate">{node.title}</span>
                    {path.length > 0 && (
                      <span className="block truncate text-[11px] text-muted">{path.join(' / ')}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div>
      {canWiki && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={() => setReorder((v) => !v)}
            aria-pressed={reorder}
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition ${
              reorder
                ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900'
                : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            {reorder ? <Check className="h-3.5 w-3.5" /> : <ListTree className="h-3.5 w-3.5" />}
            {reorder ? t('wiki_reorder_done') : t('wiki_reorder_mode')}
          </button>
        </div>
      )}
      <ul role="tree" className="space-y-0.5">
        {nodes.map((n, i) => (
          <TreeRow
            key={n.id}
            node={n}
            depth={0}
            index={i}
            siblingCount={nodes.length}
            activeId={activeId}
            zoneSlug={zoneSlug}
            expanded={expanded}
            onToggle={toggle}
            reorder={reorder && canWiki}
            busy={busy}
            actions={{ moveUp, moveDown, outdent, indent }}
            labels={{
              up: t('wiki_move_up'),
              down: t('wiki_move_down'),
              outdent: t('wiki_outdent'),
              indent: t('wiki_indent'),
              expand: t('wiki_expand'),
              collapse: t('wiki_collapse'),
            }}
          />
        ))}
      </ul>
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────

interface RowActions {
  moveUp: (id: string) => void;
  moveDown: (id: string) => void;
  outdent: (id: string) => void;
  indent: (id: string) => void;
}

interface RowLabels {
  up: string;
  down: string;
  outdent: string;
  indent: string;
  expand: string;
  collapse: string;
}

function TreeRow({
  node,
  depth,
  index,
  siblingCount,
  activeId,
  zoneSlug,
  expanded,
  onToggle,
  reorder,
  busy,
  actions,
  labels,
}: {
  node: WikiTreeNode;
  depth: number;
  index: number;
  siblingCount: number;
  activeId: string | null;
  zoneSlug: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  reorder: boolean;
  busy: boolean;
  actions: RowActions;
  labels: RowLabels;
}) {
  const hasChildren = node.children.length > 0;
  const open = hasChildren && expanded.has(node.id);
  const active = node.id === activeId;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={active}>
      <div
        className={`group flex items-center gap-0.5 rounded-md pr-1 transition-colors ${
          active
            ? 'bg-zinc-100 dark:bg-zinc-800'
            : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'
        }`}
        style={{ paddingLeft: depth * 12 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-label={open ? labels.collapse : labels.expand}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 transition hover:text-zinc-800 dark:hover:text-zinc-100"
          >
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
            />
          </button>
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center text-zinc-300 dark:text-zinc-700">
            <FileText className="h-3 w-3" />
          </span>
        )}
        <Link
          href={zoneWikiHref(zoneSlug, node.slug)}
          aria-current={active ? 'page' : undefined}
          className={`min-w-0 flex-1 truncate py-1.5 pr-1 text-sm ${
            active
              ? 'font-medium text-zinc-900 dark:text-zinc-50'
              : 'text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50'
          }`}
        >
          {node.title}
        </Link>
        {reorder && (
          <div className="flex shrink-0 items-center">
            <RowButton
              label={labels.up}
              disabled={busy || index === 0}
              onClick={() => actions.moveUp(node.id)}
            >
              <ArrowUp className="h-3 w-3" />
            </RowButton>
            <RowButton
              label={labels.down}
              disabled={busy || index >= siblingCount - 1}
              onClick={() => actions.moveDown(node.id)}
            >
              <ArrowDown className="h-3 w-3" />
            </RowButton>
            <RowButton
              label={labels.outdent}
              disabled={busy || depth === 0}
              onClick={() => actions.outdent(node.id)}
            >
              <IndentDecrease className="h-3 w-3" />
            </RowButton>
            <RowButton
              label={labels.indent}
              disabled={busy || index === 0}
              onClick={() => actions.indent(node.id)}
            >
              <IndentIncrease className="h-3 w-3" />
            </RowButton>
          </div>
        )}
      </div>
      {hasChildren && open && (
        <ul role="group" className="mt-0.5 space-y-0.5">
          {node.children.map((c, i) => (
            <TreeRow
              key={c.id}
              node={c}
              depth={depth + 1}
              index={i}
              siblingCount={node.children.length}
              activeId={activeId}
              zoneSlug={zoneSlug}
              expanded={expanded}
              onToggle={onToggle}
              reorder={reorder}
              busy={busy}
              actions={actions}
              labels={labels}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function RowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-zinc-700 dark:hover:text-zinc-50"
    >
      {children}
    </button>
  );
}
