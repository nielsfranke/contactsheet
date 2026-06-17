// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GalleryResponse, OverviewSort, SortDir } from "@/lib/types";

/**
 * The direction each sort field starts in when first selected (before the user flips it):
 * Name A→Z, Photos most-first, Created keeps the manual/API order.
 */
export const NATURAL_SORT_DIR: Record<OverviewSort, SortDir> = {
  created: "asc",
  name: "asc",
  photos: "desc",
};

/**
 * Order a list of sibling galleries by the instance-wide `overview_sort` + direction.
 * The base comparator is ascending; `desc` reverses it. `created` orders by `created_at`
 * (newest-first when `dir === "desc"`, the default).
 * Shared by the overview grid (`/admin/galleries`) and the left nav tree.
 */
export function sortGalleries(list: GalleryResponse[], sort: OverviewSort, dir: SortDir): GalleryResponse[] {
  let out: GalleryResponse[];
  if (sort === "name") out = [...list].sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === "photos") out = [...list].sort((a, b) => a.image_count - b.image_count);
  else out = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return dir === "desc" ? out.reverse() : out;
}

/**
 * Depth-first flatten of a gallery tree into a flat list, each entry tagged with its nesting
 * depth. Shared by the image "Move to gallery…" picker and the overview's tree-wide pinned shelf.
 */
export function flattenTree(tree: GalleryResponse[], depth = 0): { g: GalleryResponse; depth: number }[] {
  return tree.flatMap((g) => [{ g, depth }, ...flattenTree(g.children, depth + 1)]);
}

/**
 * Path from a root down to (and including) the gallery with `id`, or `[]` if not found.
 * Used for the overview breadcrumb and to auto-expand the nav tree to the current folder.
 */
export function galleryPath(roots: GalleryResponse[], id: string | null | undefined): GalleryResponse[] {
  if (!id) return [];
  const path: GalleryResponse[] = [];
  const walk = (nodes: GalleryResponse[]): boolean => {
    for (const n of nodes) {
      path.push(n);
      if (n.id === id || walk(n.children)) return true;
      path.pop();
    }
    return false;
  };
  walk(roots);
  return path;
}
