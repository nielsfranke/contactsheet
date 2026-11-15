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
  activity: "desc",
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
  // A folder's own image_count is usually 0 — rank by the whole subtree so containers sort by
  // what they actually hold.
  else if (sort === "photos") out = [...list].sort((a, b) => totalImageCount(a) - totalImageCount(b));
  // Most recent client activity anywhere in the subtree; galleries nobody touched yet sort as the
  // oldest, among themselves by creation date.
  else if (sort === "activity")
    out = [...list].sort(
      (a, b) =>
        (lastClientActivity(a) ?? "").localeCompare(lastClientActivity(b) ?? "") ||
        a.created_at.localeCompare(b.created_at),
    );
  else out = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return dir === "desc" ? out.reverse() : out;
}

/** Newest client activity in a gallery or any descendant (ISO string), or null. */
export function lastClientActivity(g: GalleryResponse): string | null {
  return g.children.reduce<string | null>((best, c) => {
    const v = lastClientActivity(c);
    return v && (!best || v > best) ? v : best;
  }, g.last_client_activity_at ?? null);
}

/** Client activity the photographer hasn't seen yet — on this gallery itself. */
export function hasNewActivity(g: GalleryResponse): boolean {
  const last = g.last_client_activity_at;
  if (!last) return false;
  return !g.admin_seen_at || new Date(last).getTime() > new Date(g.admin_seen_at).getTime();
}

/** Unseen client activity on this gallery or anywhere below it (a folder lights up for its children). */
export function subtreeHasNewActivity(g: GalleryResponse): boolean {
  return hasNewActivity(g) || g.children.some(subtreeHasNewActivity);
}

/** Photos in a gallery plus all its descendants — the count a folder tile / tree row shows. */
export function totalImageCount(g: GalleryResponse): number {
  return g.children.reduce((n, c) => n + totalImageCount(c), g.image_count);
}

/**
 * Up to `max` cover URLs for a folder's mosaic: one per direct child, in tree order. A child with
 * no cover of its own contributes the first cover found in its own subtree, so nested folders
 * still show a photo. Duplicates are skipped (a cover can't appear twice in one mosaic).
 */
export function mosaicCovers(g: GalleryResponse, max = 4): string[] {
  const firstCover = (n: GalleryResponse): string | null => {
    if (n.cover_image_url) return n.cover_image_url;
    for (const c of n.children) {
      const u = firstCover(c);
      if (u) return u;
    }
    return null;
  };
  const out: string[] = [];
  for (const c of g.children) {
    const u = firstCover(c);
    if (u && !out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
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
