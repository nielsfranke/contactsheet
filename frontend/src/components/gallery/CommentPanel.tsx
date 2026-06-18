// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Comment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, MessageCircle, Trash2 } from "lucide-react";
import { Icons } from "@/lib/ui-icons";
import { useTranslations } from "next-intl";
import { useReviewerStore } from "@/store/reviewer";
import { ConfirmDialog } from "@/components/chrome/ConfirmDialog";
import type { LightboxTones } from "@/lib/lightbox-theme";

interface Props {
  imageId: string;
  /** Public access via a share token (client galleries). */
  shareToken?: string;
  galleryToken?: string;
  /** Admin access via the gallery id (uses the admin-authenticated comments endpoint). */
  adminGalleryId?: string;
  /** Mark number per comment id (annotations) — shared with the overlay so labels match. */
  annoNumbers?: Record<string, number>;
  /** Comment id currently highlighted (hovered in the overlay or here). */
  hoveredId?: string | null;
  onHover?: (id: string | null) => void;
  /** Lightbox backdrop tones — so the panel matches a light vs dark backdrop. */
  tones: LightboxTones;
}

export function CommentPanel({
  shareToken,
  imageId,
  galleryToken,
  adminGalleryId,
  annoNumbers,
  hoveredId,
  onHover,
  tones,
}: Props) {
  const t = useTranslations("gallery.comments");
  const tc = useTranslations("common");
  const qc = useQueryClient();
  const reviewerName = useReviewerStore((s) => s.name);
  const [authorName, setAuthorName] = useState("");
  const [text, setText] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Comment | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const queryKey = adminGalleryId
    ? ["admin-comments", adminGalleryId, imageId]
    : ["comments", shareToken, imageId];

  const { data: comments = [], isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      adminGalleryId
        ? api.galleries.imageComments(adminGalleryId, imageId)
        : api.public.getComments(shareToken!, imageId, galleryToken),
  });

  const addMutation = useMutation({
    mutationFn: () =>
      adminGalleryId
        ? api.galleries.addImageComment(adminGalleryId, imageId, { author_name: authorName, text })
        : api.public.addComment(shareToken!, imageId, { author_name: authorName, text }, galleryToken),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      if (adminGalleryId) qc.invalidateQueries({ queryKey: ["gallery-images", adminGalleryId] });
      else qc.invalidateQueries({ queryKey: ["public-images", shareToken] });
      setText("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      adminGalleryId
        ? api.galleries.deleteImageComment(adminGalleryId, imageId, id)
        : api.public.deleteComment(shareToken!, imageId, id, reviewerName ?? "", galleryToken),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      if (adminGalleryId) qc.invalidateQueries({ queryKey: ["gallery-images", adminGalleryId] });
      else qc.invalidateQueries({ queryKey: ["public-images", shareToken] });
    },
  });

  // Editing is admin-only (the photographer's tool); no public edit endpoint exists.
  const editMutation = useMutation({
    mutationFn: (vars: { id: string; text: string }) =>
      api.galleries.updateImageComment(adminGalleryId!, imageId, vars.id, { text: vars.text }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["gallery-images", adminGalleryId] });
      setEditingId(null);
    },
  });

  // Admin may delete any; a public viewer only their own (author matches their reviewer name).
  function canDelete(c: Comment): boolean {
    if (adminGalleryId) return true;
    const me = (reviewerName ?? "").trim().toLowerCase();
    return !!me && c.author_name.trim().toLowerCase() === me;
  }

  const canEdit = !!adminGalleryId;

  function startEdit(c: Comment) {
    setEditingId(c.id);
    setEditText(c.text);
  }

  function saveEdit() {
    if (!editingId || !editText.trim() || editMutation.isPending) return;
    editMutation.mutate({ id: editingId, text: editText.trim() });
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    deleteMutation.mutate(pendingDelete.id, { onSuccess: () => setPendingDelete(null) });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!authorName.trim() || !text.trim()) return;
    addMutation.mutate();
  }

  return (
    <div className={`border-t ${tones.borderTone} px-4 py-3 flex-shrink-0 max-h-64 flex flex-col gap-2`}>
      <div className={`flex items-center gap-2 text-xs ${tones.muted} font-medium uppercase tracking-wider`}>
        <MessageCircle size={12} />
        {t("title")}
      </div>

      {/* Comment list */}
      <div className="overflow-y-auto overflow-x-hidden flex-1 space-y-2 min-h-0">
        {isLoading ? (
          <Loader2 size={14} className={`animate-spin ${tones.faint} mx-auto`} />
        ) : comments.length === 0 ? (
          <p className={`text-xs ${tones.faint}`}>{t("empty")}</p>
        ) : (
          comments.map((c: Comment) => {
            const num = annoNumbers?.[c.id];
            const hot = hoveredId === c.id;
            const markColor = c.anchor?.color ?? "#e11d48";
            return (
              <div
                key={c.id}
                className={`group/c text-xs rounded px-1.5 py-1 transition-colors ${hot ? tones.rowHot : ""} ${num ? "cursor-pointer" : ""}`}
                onMouseEnter={num ? () => onHover?.(c.id) : undefined}
                onMouseLeave={num ? () => onHover?.(null) : undefined}
              >
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${tones.strong} inline-flex items-center gap-1.5 min-w-0`}>
                    {num != null && (
                      <span
                        className="w-4 h-4 rounded-full text-[10px] font-bold text-white inline-flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: markColor }}
                      >
                        {num}
                      </span>
                    )}
                    <span className="truncate">{c.author_name}</span>
                  </span>
                  <span className={`${tones.faint} truncate`}>{new Date(c.created_at).toLocaleString()}</span>
                  {(canEdit || canDelete(c)) && editingId !== c.id && (
                    <span className="ml-auto flex-shrink-0 flex items-center gap-1.5 opacity-0 group-hover/c:opacity-100 focus-within:opacity-100 transition-opacity">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => startEdit(c)}
                          title={t("edit")}
                          className={`${tones.faint} ${tones.hoverStrong} transition-colors`}
                        >
                          <Icons.rename size={12} />
                        </button>
                      )}
                      {canDelete(c) && (
                        <button
                          type="button"
                          onClick={() => setPendingDelete(c)}
                          title={t("delete")}
                          className={`${tones.faint} hover:text-red-400 transition-colors`}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {editingId === c.id ? (
                  <div className="mt-1">
                    <textarea
                      autoFocus
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      maxLength={2000}
                      rows={2}
                      className={`w-full resize-none rounded-md border ${tones.field} text-xs p-2 focus:outline-none focus:ring-1 focus:ring-zinc-500`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <div className="flex justify-end gap-2 mt-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={`h-7 text-xs px-3 ${tones.strong} ${tones.hoverBg} ${tones.hoverStrong}`}
                        onClick={() => setEditingId(null)}
                      >
                        {tc("cancel")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs px-3"
                        disabled={!editText.trim() || editMutation.isPending}
                        onClick={saveEdit}
                      >
                        {editMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : tc("save")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className={`${tones.body} mt-0.5 break-words leading-relaxed`}>{c.text}</p>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add comment form */}
      <form onSubmit={handleSubmit} className={`flex gap-2 pt-1 border-t ${tones.borderTone}`}>
        <Input
          value={authorName}
          onChange={(e) => setAuthorName(e.target.value)}
          placeholder={t("yourName")}
          className={`${tones.field} text-xs h-7 w-28 flex-shrink-0`}
          maxLength={100}
        />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("placeholder")}
          className={`${tones.field} text-xs h-7 flex-1`}
          maxLength={2000}
        />
        <Button
          type="submit"
          size="sm"
          className="h-7 text-xs px-3"
          disabled={!authorName.trim() || !text.trim() || addMutation.isPending}
        >
          {addMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : t("post")}
        </Button>
      </form>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title={t("deleteConfirm")}
        confirmLabel={t("delete")}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
