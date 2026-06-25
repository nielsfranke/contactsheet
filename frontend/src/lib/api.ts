// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { clearAuthenticated } from "./auth";
import type {
  ActivityPage,
  AppSettings,
  AppSettingsUpdate,
  BackupJob,
  Collection,
  Comment,
  CommentCreate,
  CommentUpdate,
  GalleryCreate,
  GalleryResponse,
  GalleryUpdate,
  ImageResponse,
  ImageUpdate,
  GlobalSearchResult,
  PhotoPage,
  PublicGalleryResult,
  SemanticSearchStatus,
  UploadResponse,
  Vote,
  VoteSummary,
  ZipFilterType,
  ZipJob,
} from "./types";

const API_BASE = "";

/** Readable message from a FastAPI error body. `detail` is a string for raised HTTPExceptions but a
 *  list of `{loc, msg}` objects for 422 validation errors — stringifying that gives "[object Object]". */
function errorDetail(body: { detail?: unknown }, fallback: string): string {
  const d = body?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    const msgs = d.map((e) => (e && typeof e === "object" ? (e as { msg?: string }).msg : null)).filter(Boolean);
    if (msgs.length) return msgs.join("; ");
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && window.location.pathname.startsWith("/admin")) {
      clearAuthenticated();
      window.location.href = "/login";
    }
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(errorDetail(body, res.statusText)), { status: res.status, body });
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function authHeaders(token?: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Pull the backend's stable machine-readable error `code` out of a thrown API error, if any.
 * `request()` attaches the full JSON body (so `body.code`); the XHR upload paths attach `code`
 * directly. Returns undefined for network errors or untagged (English-detail-only) failures, so
 * callers fall back to the raw `error.message` detail.
 */
export function getErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    const direct = (err as { code?: unknown }).code;
    if (typeof direct === "string") return direct;
    const code = (err as { body?: { code?: unknown } }).body?.code;
    if (typeof code === "string") return code;
    // The rate limiter (slowapi) returns a 429 with no detail/code — surface a stable code so
    // callers can show a localized "slow down" message.
    if ((err as { status?: unknown }).status === 429) return "rate_limited";
  }
  return undefined;
}

export const api = {
  setup: {
    status: () =>
      request<{
        setup_complete: boolean;
        admin_theme: "light" | "dark";
        accent_color: string;
        accent_gradient: boolean;
        logo_url: string | null;
      }>("/api/setup/status"),
    complete: (username: string, password: string) =>
      request<{ ok: boolean }>("/api/setup", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      }),
  },

  auth: {
    login: (username: string, password: string, remember = false) =>
      request<{ access_token: string; token_type: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password, remember }),
      }),
    logout: () => request<void>("/api/auth/logout", { method: "POST" }),
    logoutAll: () =>
      request<{ ok: boolean; token_version: number }>("/api/auth/logout-all", { method: "POST" }),
    changePassword: (current_password: string, new_password: string) =>
      request<{ ok: boolean }>("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password, new_password }),
      }),
    changeUsername: (new_username: string, current_password: string) =>
      request<{ ok: boolean; username: string }>("/api/auth/change-username", {
        method: "POST",
        body: JSON.stringify({ new_username, current_password }),
      }),
    me: () => request<{ username: string }>("/api/auth/me"),
  },

  // Instance-wide semantic photo search (admin). Hits span every gallery, each tagged with its
  // gallery name + share token. 503 when the feature is off / the ML sidecar is unreachable.
  search: {
    photos: (q: string, threshold?: number) => {
      const params = new URLSearchParams({ q });
      if (threshold !== undefined) params.set("threshold", String(threshold));
      return request<GlobalSearchResult[]>(`/api/search?${params.toString()}`);
    },
  },

  // Cross-gallery "All Photos" browser — every photo, sorted + paginated (load-more). Optional `q`
  // filters by filename (the fallback search when semantic content search is off).
  photos: {
    list: (params: { sort: "date" | "name"; dir: "asc" | "desc"; limit: number; offset: number; q?: string }) => {
      const qs = new URLSearchParams({
        sort: params.sort,
        dir: params.dir,
        limit: String(params.limit),
        offset: String(params.offset),
      });
      if (params.q) qs.set("q", params.q);
      return request<PhotoPage>(`/api/photos?${qs.toString()}`);
    },
  },

  galleries: {
    list: () => request<GalleryResponse[]>("/api/galleries"),
    get: (id: string) => request<GalleryResponse>(`/api/galleries/${id}`),
    create: (data: GalleryCreate) =>
      request<GalleryResponse>("/api/galleries", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: GalleryUpdate) =>
      request<GalleryResponse>(`/api/galleries/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    delete: (id: string) => request<void>(`/api/galleries/${id}`, { method: "DELETE" }),
    empty: (id: string) => request<void>(`/api/galleries/${id}/contents`, { method: "DELETE" }),
    setCover: (id: string, imageId: string | null) =>
      request<GalleryResponse>(`/api/galleries/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ cover_image_id: imageId }),
      }),
    images: (id: string) => request<ImageResponse[]>(`/api/galleries/${id}/images`),
    // Semantic content search within this gallery + its sub-galleries. `threshold` (0..1)
    // overrides the configured accuracy cutoff for this query. 503 = feature unavailable.
    search: (id: string, q: string, threshold?: number) => {
      const params = new URLSearchParams({ q });
      if (threshold !== undefined) params.set("threshold", String(threshold));
      return request<ImageResponse[]>(`/api/galleries/${id}/search?${params.toString()}`);
    },
    reorder: (id: string, imageIds: string[]) =>
      request<void>(`/api/galleries/${id}/reorder`, {
        method: "POST",
        body: JSON.stringify({ image_ids: imageIds }),
      }),
    // Reparent a gallery: targetParentId = null moves it to the top level.
    move: (id: string, targetParentId: string | null) =>
      request<GalleryResponse>(`/api/galleries/${id}/move`, {
        method: "POST",
        body: JSON.stringify({ target_parent_id: targetParentId }),
      }),
    // Create a new gallery from a set of this gallery's images (collection / filter / selection).
    // parent_id = null → top-level, or the source gallery id → sub-gallery.
    derive: (
      id: string,
      body: { name: string; image_ids: string[]; parent_id: string | null; operation: "copy" | "move" },
    ) =>
      request<GalleryResponse>(`/api/galleries/${id}/derive`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    // Copy or move a set of this gallery's images into an existing target gallery.
    transferImages: (
      id: string,
      body: { image_ids: string[]; target_gallery_id: string; operation: "copy" | "move" },
    ) =>
      request<{ count: number; target_gallery_id: string }>(`/api/galleries/${id}/images/transfer`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    activity: (id: string, page = 1, limit = 20) =>
      request<ActivityPage>(`/api/galleries/${id}/activity?page=${page}&limit=${limit}`),
    votesSummary: (id: string) => request<VoteSummary>(`/api/galleries/${id}/votes/summary`),
    createZip: (id: string, filterType: ZipFilterType) =>
      request<ZipJob>(`/api/galleries/${id}/export/zip`, {
        method: "POST",
        body: JSON.stringify({ filter_type: filterType }),
      }),
    createMultiZip: (id: string, subgalleryIds: string[]) =>
      request<ZipJob>(`/api/galleries/${id}/export/zip`, {
        method: "POST",
        body: JSON.stringify({ subgallery_ids: subgalleryIds }),
      }),
    createFilteredZip: (id: string, imageIds: string[]) =>
      request<ZipJob>(`/api/galleries/${id}/export/zip`, {
        method: "POST",
        body: JSON.stringify({ image_ids: imageIds }),
      }),
    zipDownloadUrl: (id: string, jobId: string) => `/api/galleries/${id}/export/zip/${jobId}/download`,
    listCollections: (id: string) => request<Collection[]>(`/api/galleries/${id}/collections`),
    createCollection: (id: string, name: string, imageIds: string[]) =>
      request<Collection>(`/api/galleries/${id}/collections`, {
        method: "POST",
        body: JSON.stringify({ name, image_ids: imageIds }),
      }),
    updateCollection: (id: string, collectionId: string, data: { name?: string; image_ids?: string[] }) =>
      request<Collection>(`/api/galleries/${id}/collections/${collectionId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    deleteCollection: (id: string, collectionId: string) =>
      request<void>(`/api/galleries/${id}/collections/${collectionId}`, { method: "DELETE" }),
    listZips: (id: string) => request<ZipJob[]>(`/api/galleries/${id}/export/zip`),
    getZip: (id: string, jobId: string) => request<ZipJob>(`/api/galleries/${id}/export/zip/${jobId}`),
    deleteZip: (id: string, jobId: string) =>
      request<void>(`/api/galleries/${id}/export/zip/${jobId}`, { method: "DELETE" }),
    imageComments: (galleryId: string, imageId: string) =>
      request<Comment[]>(`/api/galleries/${galleryId}/images/${imageId}/comments`),
    addImageComment: (galleryId: string, imageId: string, data: CommentCreate) =>
      request<Comment>(`/api/galleries/${galleryId}/images/${imageId}/comments`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateImageComment: (galleryId: string, imageId: string, commentId: string, data: CommentUpdate) =>
      request<Comment>(`/api/galleries/${galleryId}/images/${imageId}/comments/${commentId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    deleteImageComment: (galleryId: string, imageId: string, commentId: string) =>
      request<void>(`/api/galleries/${galleryId}/images/${imageId}/comments/${commentId}`, {
        method: "DELETE",
      }),
    exportUrl: (id: string, options?: { flag?: string; include_flag?: boolean }) => {
      const params = new URLSearchParams();
      if (options?.flag) params.set("flag", options.flag);
      if (options?.include_flag) params.set("include_flag", "true");
      const qs = params.toString();
      return `/api/galleries/${id}/export${qs ? `?${qs}` : ""}`;
    },
    uploadHeaderImage: (id: string, file: File): Promise<GalleryResponse> => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${API_BASE}/api/galleries/${id}/header-image`, {
        method: "POST",
        credentials: "include",
        body: form,
      }).then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw Object.assign(new Error(body.detail ?? res.statusText), { status: res.status });
        }
        return res.json();
      });
    },
    deleteHeaderImage: (id: string) =>
      request<void>(`/api/galleries/${id}/header-image`, { method: "DELETE" }),
    uploadCoverImage: (id: string, file: File): Promise<GalleryResponse> => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${API_BASE}/api/galleries/${id}/cover-image`, {
        method: "POST",
        credentials: "include",
        body: form,
      }).then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw Object.assign(new Error(body.detail ?? res.statusText), { status: res.status });
        }
        return res.json();
      });
    },
    deleteCoverImage: (id: string) =>
      request<void>(`/api/galleries/${id}/cover-image`, { method: "DELETE" }),
    setFocusPoint: (id: string, x: number, y: number) =>
      request<GalleryResponse>(`/api/galleries/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ header_focus_x: x, header_focus_y: y }),
      }),
    setHeaderImageFromGalleryImage: (galleryId: string, imageId: string) =>
      request<GalleryResponse>(`/api/galleries/${galleryId}/header-image/from-image`, {
        method: "POST",
        body: JSON.stringify({ image_id: imageId }),
      }),
    setShareToken: (id: string, body: { strategy: "named" | "random" | "custom"; value?: string }) =>
      request<GalleryResponse>(`/api/galleries/${id}/share-token`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },

  adminSettings: {
    get: () => request<AppSettings>("/api/admin/settings"),
    update: (data: AppSettingsUpdate) =>
      request<AppSettings>("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    uploadLogo: (file: File): Promise<AppSettings> => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${API_BASE}/api/admin/settings/logo`, {
        method: "POST",
        credentials: "include",
        body: form,
      }).then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw Object.assign(new Error(body.detail ?? res.statusText), { status: res.status });
        }
        return res.json();
      });
    },
    deleteLogo: () => request<void>("/api/admin/settings/logo", { method: "DELETE" }),
    // Semantic-search index progress + ML sidecar health (for the settings panel).
    semanticStatus: () =>
      request<SemanticSearchStatus>("/api/admin/settings/semantic-search/status"),
    // Re-queue every image that still needs indexing (manual nudge after errors).
    reindexSemantic: () =>
      request<SemanticSearchStatus>("/api/admin/settings/semantic-search/reindex", {
        method: "POST",
      }),
    testNotification: (data: {
      channel_id?: string;
      type?: string;
      params?: Record<string, string>;
      url?: string;
    }) =>
      request<{ ok: boolean }>("/api/admin/settings/notifications/test", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    reset: (password: string) =>
      request<{ ok: boolean }>("/api/admin/settings/reset", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    // Backup & restore (see docs/architecture/backup-restore.md).
    backupCreate: (scope: "full" | "metadata", include_renditions: boolean) =>
      request<BackupJob>("/api/admin/settings/backup", {
        method: "POST",
        body: JSON.stringify({ scope, include_renditions }),
      }),
    backupGet: (id: string) => request<BackupJob>(`/api/admin/settings/backup/${id}`),
    backupList: () => request<BackupJob[]>("/api/admin/settings/backup"),
    backupDownloadUrl: (id: string) => `${API_BASE}/api/admin/settings/backup/${id}/download`,
    backupDelete: (id: string) =>
      request<void>(`/api/admin/settings/backup/${id}`, { method: "DELETE" }),
    // Restore streams a (potentially large) archive upload; XHR gives progress + a typed
    // error code. On success the server has rotated the runtime key, so the caller must
    // re-login (hard redirect) — this session's cookie is already dead.
    restore: (file: File, password: string, onProgress?: (pct: number) => void): Promise<{ ok: boolean }> =>
      new Promise((resolve, reject) => {
        const form = new FormData();
        form.append("file", file);
        form.append("password", password);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE}/api/admin/settings/restore`);
        xhr.withCredentials = true;
        if (onProgress) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
          };
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText || "{}"));
          } else {
            let detail = xhr.statusText;
            let code: string | undefined;
            try {
              const parsed = JSON.parse(xhr.responseText || "{}");
              detail = parsed.detail ?? detail;
              code = typeof parsed.code === "string" ? parsed.code : undefined;
            } catch { /* non-JSON error body */ }
            reject(Object.assign(new Error(detail), { status: xhr.status, code }));
          }
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(form);
      }),
  },

  images: {
    upload: (galleryId: string, files: File[], onProgress?: (pct: number) => void, signal?: AbortSignal): Promise<UploadResponse[]> => {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(Object.assign(new Error("Upload cancelled"), { aborted: true }));
          return;
        }
        const form = new FormData();
        files.forEach((f) => form.append("files", f));
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE}/api/galleries/${galleryId}/images`);
        xhr.withCredentials = true;
        if (onProgress) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
          };
        }
        // Cancel support: aborting the signal aborts the in-flight request (onabort rejects below).
        if (signal) signal.addEventListener("abort", () => xhr.abort(), { once: true });
        xhr.onabort = () => reject(Object.assign(new Error("Upload cancelled"), { aborted: true }));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            let detail = xhr.statusText;
            let code: string | undefined;
            try {
              const parsed = JSON.parse(xhr.responseText || "{}");
              detail = parsed.detail ?? detail;
              code = typeof parsed.code === "string" ? parsed.code : undefined;
            } catch { /* non-JSON error body */ }
            reject(Object.assign(new Error(detail), { status: xhr.status, code }));
          }
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(form);
      });
    },
    update: (id: string, data: ImageUpdate) =>
      request<ImageResponse>(`/api/images/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    delete: (id: string) => request<void>(`/api/images/${id}`, { method: "DELETE" }),
    move: (id: string, targetGalleryId: string) =>
      request<ImageResponse>(`/api/images/${id}/move`, {
        method: "POST",
        body: JSON.stringify({ target_gallery_id: targetGalleryId }),
      }),
    approve: (galleryId: string, imageId: string) =>
      request<ImageResponse>(`/api/galleries/${galleryId}/images/${imageId}/approve`, {
        method: "POST",
      }),
    approveBulk: (galleryId: string, imageIds: string[]) =>
      request<{ approved: number }>(`/api/galleries/${galleryId}/images/approve`, {
        method: "POST",
        body: JSON.stringify({ image_ids: imageIds }),
      }),
  },

  public: {
    getGallery: (token: string, galleryToken?: string) =>
      request<PublicGalleryResult>(`/api/public/g/${token}`, {
        headers: authHeaders(galleryToken),
      }),
    auth: (token: string, password: string) =>
      request<{ access_token: string; token_type: string }>(`/api/public/g/${token}/auth`, {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    images: (token: string, galleryToken?: string) =>
      request<ImageResponse[]>(`/api/public/g/${token}/images`, {
        headers: authHeaders(galleryToken),
      }),
    uploadImages: (
      token: string,
      files: File[],
      uploader: string,
      galleryToken?: string,
      onProgress?: (pct: number) => void,
      signal?: AbortSignal,
    ): Promise<UploadResponse[]> => {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(Object.assign(new Error("Upload cancelled"), { aborted: true }));
          return;
        }
        const form = new FormData();
        files.forEach((f) => form.append("files", f));
        form.append("uploader", uploader);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE}/api/public/g/${token}/images`);
        if (galleryToken) xhr.setRequestHeader("Authorization", `Bearer ${galleryToken}`);
        if (onProgress) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
          };
        }
        // Cancel support: aborting the signal aborts the in-flight request (onabort rejects below).
        if (signal) signal.addEventListener("abort", () => xhr.abort(), { once: true });
        xhr.onabort = () => reject(Object.assign(new Error("Upload cancelled"), { aborted: true }));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            let detail = xhr.statusText;
            let code: string | undefined;
            try {
              const parsed = JSON.parse(xhr.responseText || "{}");
              detail = parsed.detail ?? detail;
              code = typeof parsed.code === "string" ? parsed.code : undefined;
            } catch { /* non-JSON error body */ }
            reject(Object.assign(new Error(detail), { status: xhr.status, code }));
          }
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(form);
      });
    },
    collections: (token: string, galleryToken?: string) =>
      request<Collection[]>(`/api/public/g/${token}/collections`, {
        headers: authHeaders(galleryToken),
      }),
    createCollection: (token: string, name: string, imageIds: string[], creator: string, galleryToken?: string) =>
      request<Collection>(`/api/public/g/${token}/collections`, {
        method: "POST",
        body: JSON.stringify({ name, image_ids: imageIds, creator }),
        headers: authHeaders(galleryToken),
      }),
    updateCollection: (
      token: string,
      collectionId: string,
      data: { name?: string; image_ids?: string[]; actor: string },
      galleryToken?: string,
    ) =>
      request<Collection>(`/api/public/g/${token}/collections/${collectionId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
        headers: authHeaders(galleryToken),
      }),
    deleteCollection: (token: string, collectionId: string, reviewer: string, galleryToken?: string) =>
      request<void>(`/api/public/g/${token}/collections/${collectionId}?reviewer=${encodeURIComponent(reviewer)}`, {
        method: "DELETE",
        headers: authHeaders(galleryToken),
      }),
    flagImage: (token: string, imageId: string, flag: string, galleryToken?: string) =>
      request<ImageResponse>(`/api/public/g/${token}/images/${imageId}/flag`, {
        method: "POST",
        body: JSON.stringify({ flag }),
        headers: authHeaders(galleryToken),
      }),
    rateImage: (token: string, imageId: string, rating: number, galleryToken?: string) =>
      request<ImageResponse>(`/api/public/g/${token}/images/${imageId}/rate`, {
        method: "POST",
        body: JSON.stringify({ rating }),
        headers: authHeaders(galleryToken),
      }),
    likeImage: (token: string, imageId: string, reviewer: string, galleryToken?: string) =>
      request<ImageResponse>(`/api/public/g/${token}/images/${imageId}/like`, {
        method: "POST",
        body: JSON.stringify({ reviewer }),
        headers: authHeaders(galleryToken),
      }),
    getLikes: (token: string, reviewer: string, galleryToken?: string) =>
      request<string[]>(`/api/public/g/${token}/likes?reviewer=${encodeURIComponent(reviewer)}`, {
        headers: authHeaders(galleryToken),
      }),
    getComments: (token: string, imageId: string, galleryToken?: string) =>
      request<Comment[]>(`/api/public/g/${token}/images/${imageId}/comments`, {
        headers: authHeaders(galleryToken),
      }),
    addComment: (token: string, imageId: string, data: CommentCreate, galleryToken?: string) =>
      request<Comment>(`/api/public/g/${token}/images/${imageId}/comments`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: authHeaders(galleryToken),
      }),
    deleteComment: (token: string, imageId: string, commentId: string, reviewer: string, galleryToken?: string) =>
      request<void>(
        `/api/public/g/${token}/images/${imageId}/comments/${commentId}?reviewer=${encodeURIComponent(reviewer)}`,
        { method: "DELETE", headers: authHeaders(galleryToken) },
      ),
    getVotes: (token: string, reviewerName: string, galleryToken?: string) =>
      request<Vote[]>(`/api/public/g/${token}/votes?reviewer=${encodeURIComponent(reviewerName)}`, {
        headers: authHeaders(galleryToken),
      }),
    setVote: (token: string, imageId: string, reviewerName: string, colorFlag: string, galleryToken?: string) =>
      request<Vote>(`/api/public/g/${token}/images/${imageId}/vote`, {
        method: "PUT",
        body: JSON.stringify({ reviewer_name: reviewerName, color_flag: colorFlag }),
        headers: authHeaders(galleryToken),
      }),
    setRatingVote: (token: string, imageId: string, reviewerName: string, rating: number, galleryToken?: string) =>
      request<Vote>(`/api/public/g/${token}/images/${imageId}/vote`, {
        method: "PUT",
        body: JSON.stringify({ reviewer_name: reviewerName, rating }),
        headers: authHeaders(galleryToken),
      }),
    createZip: (token: string, subgalleryShareTokens: string[], galleryToken?: string) =>
      request<ZipJob>(`/api/public/g/${token}/zip`, {
        method: "POST",
        body: JSON.stringify({ subgallery_share_tokens: subgalleryShareTokens }),
        headers: authHeaders(galleryToken),
      }),
    createFilteredZip: (token: string, imageIds: string[], galleryToken?: string) =>
      request<ZipJob>(`/api/public/g/${token}/zip`, {
        method: "POST",
        body: JSON.stringify({ image_ids: imageIds }),
        headers: authHeaders(galleryToken),
      }),
    getZip: (token: string, jobId: string, galleryToken?: string) =>
      request<ZipJob>(`/api/public/g/${token}/zip/${jobId}`, {
        headers: authHeaders(galleryToken),
      }),
    zipDownloadUrl: (token: string, jobId: string) =>
      `/api/public/g/${token}/zip/${jobId}/download`,
    // Streaming download: one GET the browser navigates to — no job, no poll, no "preparing".
    // The gallery JWT rides in ?token= because a navigation can't set an Authorization header.
    zipStreamUrl: (
      token: string,
      opts: { subs?: string[]; images?: string[]; galleryToken?: string },
    ) => {
      const p = new URLSearchParams();
      if (opts.subs?.length) p.set("subs", opts.subs.join(","));
      if (opts.images?.length) p.set("images", opts.images.join(","));
      if (opts.galleryToken) p.set("token", opts.galleryToken);
      const qs = p.toString();
      return `/api/public/g/${token}/zip/stream${qs ? `?${qs}` : ""}`;
    },
  },
};
