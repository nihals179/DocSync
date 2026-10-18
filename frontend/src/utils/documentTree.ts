export type TreeNode<T extends { id: string; parentId?: string | null; sortOrder?: number }> = T & {
  children: TreeNode<T>[];
};

export function buildDocumentTree<T extends { id: string; parentId?: string | null; sortOrder?: number }>(
  docs: T[],
): TreeNode<T>[] {
  const map = new Map<string, TreeNode<T>>();
  for (const doc of docs) {
    map.set(doc.id, { ...doc, children: [] });
  }

  const roots: TreeNode<T>[] = [];
  for (const doc of docs) {
    const node = map.get(doc.id);
    if (!node) continue;
    if (doc.parentId && map.has(doc.parentId)) {
      map.get(doc.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortLevel = (nodes: TreeNode<T>[]) => {
    nodes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (const node of nodes) sortLevel(node.children);
  };

  sortLevel(roots);
  return roots;
}
