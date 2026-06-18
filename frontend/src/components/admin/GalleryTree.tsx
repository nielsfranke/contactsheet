// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { GalleryResponse, OverviewSort, SortDir } from "@/lib/types";
import { api } from "@/lib/api";
import { sortGalleries, galleryPath } from "@/lib/gallery-sort";
import { Button } from "@/components/ui/button";
import { CreateGalleryDialog } from "./CreateGalleryDialog";
import { CreateSubGalleryDialog } from "./CreateSubGalleryDialog";
import {
  GALLERY_DROP_PREFIX,
  TOPLEVEL_DROP_PREFIX,
  useAdminDndActive,
} from "./AdminDnd";
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, Plus, Search } from "lucide-react";
import { InputClearButton } from "@/components/chrome/InputClearButton";
import { cn } from "@/lib/utils";

interface Props {
  galleries: GalleryResponse[];
}

/** When filtering: collect ids of matching nodes + every ancestor of a match (the path to reveal). */
function matchTree(galleries: GalleryResponse[], q: string): { visible: Set<string>; expand: Set<string> } {
  const visible = new Set<string>();
  const expand = new Set<string>();
  const walk = (g: GalleryResponse): boolean => {
    const selfMatch = g.name.toLowerCase().includes(q);
    let childMatch = false;
    for (const c of g.children) if (walk(c)) childMatch = true;
    if (selfMatch || childMatch) {
      visible.add(g.id);
      if (childMatch) expand.add(g.id); // open the branch so the match is reachable
    }
    return selfMatch || childMatch;
  };
  galleries.forEach(walk);
  return { visible, expand };
}

export function GalleryTree({ galleries }: Props) {
  const t = useTranslations("admin.tree");
  const tc = useTranslations("common");
  const params = useParams();
  const searchParams = useSearchParams();
  const detailId = params?.id as string | undefined;
  const folderId = searchParams.get("folder") ?? undefined;
  // What the canvas is showing: a folder being browsed (`?folder=`) or a gallery's detail page.
  const selectedId = folderId ?? detailId;
  const active = useAdminDndActive();
  const { data: settings } = useQuery({ queryKey: ["admin-settings"], queryFn: () => api.adminSettings.get() });
  const sort: OverviewSort = settings?.overview_sort ?? "created";
  const dir: SortDir = settings?.overview_sort_dir ?? "asc";
  const [createParentId, setCreateParentId] = useState<string | null | undefined>(undefined);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const q = filter.trim().toLowerCase();
  const { visible, expand } = q ? matchTree(galleries, q) : { visible: null, expand: null };
  const roots = sortGalleries(visible ? galleries.filter((g) => visible.has(g.id)) : galleries, sort, dir);
  // When not filtering, auto-expand the branch leading to the selected folder/gallery so it's visible.
  const pathExpand = q ? null : new Set(galleryPath(galleries, selectedId).map((g) => g.id));
  const forceExpand = q ? expand : pathExpand;

  return (
    <>
      <TreeHeader onNew={() => setCreateParentId(null)} dragging={active?.kind === "gallery"} />
      <div className="px-2 mb-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("filterGalleries")}
            className="w-full h-7 pl-7 pr-7 text-sm rounded-md border border-sidebar-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
          />
          {filter && <InputClearButton onClick={() => setFilter("")} label={tc("clear")} />}
        </div>
      </div>
      <div className="space-y-0.5 px-1">
        {roots.map((g) => (
          <TreeNode
            key={g.id}
            g={g}
            depth={0}
            sort={sort}
            dir={dir}
            currentId={selectedId}
            activeGalleryId={active?.kind === "gallery" ? active.galleryId : undefined}
            expanded={expanded}
            toggleExpand={toggleExpand}
            onAddSub={(id) => { setCreateParentId(id); toggleExpand(id); }}
            visibleIds={visible}
            forceExpand={forceExpand}
          />
        ))}
        {galleries.length === 0 && (
          <p className="text-xs text-muted-foreground/70 px-3 py-2">{t("noGalleries")}</p>
        )}
        {galleries.length > 0 && roots.length === 0 && (
          <p className="text-xs text-muted-foreground/70 px-3 py-2">{t("noMatch", { query: filter.trim() })}</p>
        )}
      </div>

      <CreateGalleryDialog
        open={createParentId === null}
        onOpenChange={(open) => { if (!open) setCreateParentId(undefined); }}
      />

      <CreateSubGalleryDialog
        key={createParentId ?? "closed"}
        open={typeof createParentId === "string"}
        onOpenChange={(open) => { if (!open) setCreateParentId(undefined); }}
        parentId={typeof createParentId === "string" ? createParentId : ""}
        parentMode={galleryPath(galleries, createParentId).at(-1)?.mode ?? "presentation"}
      />
    </>
  );
}

/** "Galleries" header that doubles as a "move to top level" drop target during a gallery drag. */
function TreeHeader({ onNew, dragging }: { onNew: () => void; dragging: boolean }) {
  const t = useTranslations("admin.tree");
  const { setNodeRef, isOver } = useDroppable({ id: `${TOPLEVEL_DROP_PREFIX}:tree`, data: { topLevel: true } });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "px-3 mb-2 flex items-center justify-between rounded-md transition-colors",
        isOver && "ring-1 ring-primary bg-primary/10",
      )}
    >
      <Link
        href="/admin/galleries"
        title={t("showAll")}
        className="text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
      >
        {dragging ? t("dropToUnnest") : t("galleries")}
      </Link>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 gap-1 text-muted-foreground hover:text-foreground"
        onClick={onNew}
        title={t("createNew")}
      >
        <Plus size={14} /> <span className="text-xs">{t("new")}</span>
      </Button>
    </div>
  );
}

function TreeNode({
  g, depth, sort, dir, currentId, activeGalleryId, expanded, toggleExpand, onAddSub, visibleIds, forceExpand,
}: {
  g: GalleryResponse;
  depth: number;
  sort: OverviewSort;
  dir: SortDir;
  currentId: string | undefined;
  activeGalleryId: string | undefined;
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  onAddSub: (id: string) => void;
  visibleIds: Set<string> | null;
  forceExpand: Set<string> | null;
}) {
  const t = useTranslations("admin.tree");
  const router = useRouter();
  // When filtering, only show children on the match path and keep their branch open.
  const childNodes = sortGalleries(visibleIds ? g.children.filter((c) => visibleIds.has(c.id)) : g.children, sort, dir);
  const hasChildren = childNodes.length > 0;
  const isExpanded = (forceExpand?.has(g.id) ?? false) || expanded.has(g.id);
  const isActive = g.id === currentId;
  const dimmed = activeGalleryId === g.id;

  const drag = useDraggable({ id: `${g.id}:tree`, data: { reparent: true, galleryId: g.id, parentId: g.parent_id, name: g.name } });
  const drop = useDroppable({ id: `${GALLERY_DROP_PREFIX}${g.id}:tree`, data: { galleryId: g.id } });
  const setRef = (el: HTMLElement | null) => { drag.setNodeRef(el); drop.setNodeRef(el); };

  return (
    <div>
      <div
        ref={setRef}
        {...drag.listeners}
        {...drag.attributes}
        className={cn(
          "flex items-center gap-1 px-2 py-1.5 rounded-md cursor-grab active:cursor-grabbing text-sm group",
          isActive ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold" : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
          dimmed && "opacity-30",
          drop.isOver && "ring-1 ring-primary bg-primary/10",
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => router.push(`/admin/galleries/${g.id}`)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); toggleExpand(g.id); }}
            onPointerDown={(e) => e.stopPropagation()}
            title={isExpanded ? t("collapse") : t("expand")}
            aria-label={isExpanded ? t("collapse") : t("expand")}
            className="flex items-center justify-center h-5 w-5 -ml-0.5 flex-shrink-0 rounded text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-5 flex-shrink-0" />
        )}
        {hasChildren && isExpanded ? (
          <FolderOpen size={14} className="flex-shrink-0" />
        ) : (
          <Folder size={14} className="flex-shrink-0" />
        )}
        <span className="flex-1 truncate">{g.name}</span>
        <span className="text-xs text-muted-foreground/70">{g.image_count}</span>
        <button
          title={t("addSubGallery")}
          onClick={(e) => { e.stopPropagation(); onAddSub(g.id); }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
        >
          <FolderPlus size={13} />
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {childNodes.map((c) => (
            <TreeNode
              key={c.id}
              g={c}
              depth={depth + 1}
              sort={sort}
              dir={dir}
              currentId={currentId}
              activeGalleryId={activeGalleryId}
              expanded={expanded}
              toggleExpand={toggleExpand}
              onAddSub={onAddSub}
              visibleIds={visibleIds}
              forceExpand={forceExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}
