# Collections editing (rename, members, creator-restricted delete)

Status: **implemented** — 2026-06-15

> Shipped scope: **admin** rename + add/remove members; **public** rename + creator-restricted
> delete (the security fix). Backend supports full ordered member replacement for both. Deferred to a
> follow-up (see Out of scope): **drag-reorder** of members (both surfaces) and **public** member
> add/remove. The backend `image_ids` replacement already supports these — only the UI is deferred.

Makes a saved **Collection** editable after creation. Today a collection is immutable once saved (no
rename, no add/remove/reorder of members) and — a real bug — **any** public visitor can delete **any**
collection. This adds rename + full member editing and locks edits/deletes to the creator (admin may
do anything). Builds on the shipped collections feature (migration `0018`).

## Decisions (locked with the user)

- **Permission model: creator + admin, by reviewer-name match.** A public client may rename / edit
  members / delete only collections whose `created_by` equals their reviewer name; the admin may do
  any of these to any collection. This mirrors the existing comment/annotation author-match trust
  model (`comment_service.delete_comment`). It also **fixes** today's bug where the public
  delete endpoint enforces nothing.
- **Member edits are a full ordered replacement.** The client/admin sends the new complete
  `image_ids` list (validated + de-duped against the gallery's live images, same as create); the
  service rewrites the membership with fresh positions. One operation covers add, remove, **and**
  reorder — no per-member endpoints.

## Backend

No migration (reuses `collections` / `collection_images`; positions already exist).

- **Schema** — new `CollectionUpdate` in `schemas/collection.py`:
  `{ name: str | None, image_ids: list[str] | None, actor: str | None }` (`name` ≥1/≤200;
  `image_ids` optional full replacement; `actor` = public reviewer name, ignored for admin). At least
  one of `name` / `image_ids` must be present (else 400).
- **Repo** — `collection_repo.update_name(db, collection, name)` and
  `collection_repo.replace_members(db, collection, image_ids)` (delete existing
  `CollectionImage` rows, re-add in order). `get` already loads `members` (ordered by position).
- **Service**
  - `_authorize(collection, actor, is_admin)` — admin passes; else require
    `collection.created_by and collection.created_by == actor`, raising
    `CodedHTTPException(403, code="collection_forbidden")`. Used by update **and** delete.
  - `update_collection(db, gallery_id, collection_id, data, storage, *, actor=None, is_admin=False)`
    — load + gallery-scope check (404), authorize, then apply: trim/validate `name`; for
    `image_ids`, filter to live gallery images (preserve order, drop dupes) and **reject an empty
    result** (400 — a collection must keep ≥1 member, consistent with create). Publishes
    `realtime "collection"`; logs a `"collection"` activity verb (reuse). Returns the
    `CollectionResponse`.
  - `delete_collection(...)` gains the same `actor` / `is_admin` params and calls `_authorize`
    (closing the public-delete hole). Admin router passes `is_admin=True`.
- **Routers**
  - Admin (`routers/collections.py`): `PATCH /api/galleries/{id}/collections/{cid}` → `is_admin=True`.
    Existing `DELETE` stays (now `is_admin=True`).
  - Public (`routers/public.py`): `PATCH /api/public/g/{token}/collections/{cid}` — access +
    `_require_collections` gate, `actor = body.actor or "Guest"`. The existing public `DELETE` gains
    an `actor` query param (`?reviewer=`, like the public comment delete) threaded to `_authorize`.
    Both `@limiter.limit`-ed per the rate-limit doc.

## Frontend

The collections panel lives in both `GalleryAdminSidebar` (admin) and the `GalleryView` collaboration
sidebar (public); both consume `api.*.collections`. Editing is added to both, gated by who may act.

- **API client** — `api.galleries.updateCollection(galleryId, id, { name?, image_ids? })` and
  `api.public.updateCollection(token, id, { name?, image_ids?, actor }, galleryToken?)`; public
  delete gains the `reviewer` query param.
- **Rename** — inline pencil (`Icons.rename`) on each collection row → small input / dialog (shadcn
  `Dialog` admin, dark overlay public, reusing the save-name dialogs). Shown when `canEdit` (admin,
  or `created_by === reviewerName`).
- **Member editing** — clicking a collection already **filters** the grid to it (`activeCollection`).
  In that filtered view, when `canEdit`:
  - **Remove**: an `×` `OverlayPill` on each tile removes it (`image_ids` minus that id → PATCH).
  - **Add**: with Select mode active, "Add selection to collection" PATCHes `image_ids ∪ selected`.
  - **Reorder**: drag within the filtered grid. The admin grid already has a `DndContext`
    (`AdminDndProvider`) and manual-sort reorder; when an `activeCollection` is set, a reorder drag
    PATCHes the collection's `image_ids` order instead of the gallery `sort_order`. Public side keeps
    add/remove only (no public DnD today) — reorder there is a follow-up.
- **Creator-restricted UI** — the public panel shows edit/delete affordances only for rows where
  `created_by === reviewerName` (admin always sees them); the backend enforces regardless.
- **Realtime** — `"collection"` signals already invalidate the collections query, so edits made
  elsewhere refresh live.

## Out of scope / follow-ups

- **Drag-reorder of members** (admin + public) — backend takes the ordered `image_ids`; only the
  DnD wiring (branch the admin grid's existing reorder on `activeCollection`, PATCH the new order) is
  deferred.
- **Public member add/remove** — symmetric to the admin tile/selection wiring; deferred.
- Presentation-mode collections; cross-gallery collections.
- Per-member captions; collection cover override (still first member).
- An "edited" indicator / audit of who changed a collection.
