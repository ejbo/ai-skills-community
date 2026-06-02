export interface FileEntry {
  path: string;
  size: number;
  isText: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  isText?: boolean;
  children?: TreeNode[];
}

export function buildFileTree(entries: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', type: 'dir', children: [] };

  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean);
    let cursor = root;
    for (let i = 0; i < parts.length; i++) {
      const isLeaf = i === parts.length - 1;
      const name = parts[i];
      const path = parts.slice(0, i + 1).join('/');
      cursor.children = cursor.children ?? [];
      let next = cursor.children.find(
        (child) => child.name === name && (isLeaf ? child.type === 'file' : child.type === 'dir'),
      );
      if (!next) {
        next = isLeaf
          ? { name, path, type: 'file', size: entry.size, isText: entry.isText }
          : { name, path, type: 'dir', children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    }
  }

  sortNode(root);
  return root.children ?? [];
}

function sortNode(node: TreeNode): void {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortNode(child);
}
