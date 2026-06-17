# Gallery settings autosave (hybrid)

Status: implemented (2026-06-16)

Brings the instance-settings autosave model to the per-gallery `GallerySettingsModal`, but in a
**hybrid** form that respects the two things the modal does that the instance settings pages don't:
the explicit **cascade to sub-galleries** and the **password** write. Look/behaviour controls save
the instant you change them (with a small "Saving…/Saved" indicator); cascade and password stay
explicit, deliberate actions.

## Why hybrid, not a straight port

The instance settings pages (`/admin/settings/*`) use `useSettingsAutosave` — every toggle/select
PATCHes immediately, text fields fire on blur, a `SaveStatus` chip shows progress, and there is **no
Save/Cancel** because they edit one persistent singleton (`app_settings`).

The gallery modal can't adopt that wholesale because of two fields with different semantics:

1. **`apply_to_subgalleries`** — a one-shot cascade of look & behaviour onto direct children. With
   per-field autosave we must **not** re-cascade on every keystroke (that would silently overwrite
   children each time a toggle flips). So cascade stays an explicit button: "configure, then apply
   once".
2. **`password`** — write-only credential. Autosaving it on blur is surprising; it stays an explicit
   "Set password" action.

Everything else (name, headline, mode, downloads, notifications, the Look/Opener/Review groups,
client-upload toggles, watermark, expiry, hide-parent-nav) is plain per-gallery state and is a good
fit for autosave.

## Behaviour

- **Discrete controls** (toggles, segmented selects, mode cards, font picker) → save **immediately**
  on change.
- **Text/date inputs** (name, headline, expiry, watermark text) → save **on blur**, only when the
  value actually changed and is valid (name must be non-empty — an empty name never PATCHes).
- **`SaveStatus`** chip in the modal footer replaces the "Speichern" button: idle / Saving… / Saved /
  error (reuses `components/admin/SaveStatus.tsx` + its i18n).
- **Cascade** stays a distinct row — an "Auf Unter-Galerien anwenden / Übernehmen" button (shown only
  when `gallery.children.length > 0`) that PATCHes the **current** look+behaviour values once with
  `apply_to_subgalleries: true`. It is never part of an autosave patch.
- **Password** stays a distinct field + "Setzen" button (Security tab); PATCHes `{ password }` on its
  own.
- **Closing** the modal = done. No Cancel/discard (consistent with autosave — there's nothing
  unsaved). The modal close control becomes a plain "Schließen/Fertig".

## Frontend

### New hook — `useGallerySettingsAutosave(galleryId)`
A gallery-scoped sibling of `useSettingsAutosave`, in `frontend/src/hooks/`:

- `mutationFn: (patch: GalleryUpdate) => api.galleries.update(galleryId, patch)`.
- Optimistic merge into the **`["gallery", id]`** cache on `onMutate`; rollback on error (same
  pattern as the settings hook's `["admin-settings"]` merge).
- `onSuccess` reconciles with the server response.
- **Selective tree invalidation** — the cost of autosave is *not* the tiny write but a `["galleries"]`
  (full tree) refetch on every toggle. So the tree is invalidated **only** when the patch touches a
  field the tree actually renders: `name`, `mode`, `cover_image_id` / cover, `pinned`. Look/behaviour
  toggles (layout, flags, comments, watermark, …) update **only** the optimistic `["gallery", id]`
  cache — no tree refetch. `save(patch)` derives this from the patch keys
  (`TREE_FIELDS = {name, mode, pinned, …}`); if none intersect, it skips the `["galleries"]`
  invalidation entirely. (The cascade button, which can change children's names/look, always
  invalidates the tree.)
- Returns `{ save, status }`; `status` drives `SaveStatus` and auto-returns to idle ~2s after a save.
- Coalescing: discrete saves fire as separate small PATCHes (acceptable — same as instance settings);
  no debounce needed because controls are discrete. Text fields already only fire on blur.

The modal seeds its local `useState` from the `gallery` prop on open (unchanged); while open the
modal is the source of truth, so the optimistic cache update doesn't fight the local state.

### `GallerySettingsModal` changes
- Drop the bundled `handleSave`/`onSubmit`/`loading` contract. Each control's `onChange`/`onBlur`
  calls `save({ <field>: value })` with just its delta. The Look/Opener/Review group components
  already report partial patches (`onChange(patch)`), so they map cleanly to `save(patch)`.
- Footer: `<SaveStatus status={status} />` instead of Cancel/Save.
- Keep `apply_to_subgalleries` and `password` as explicit buttons calling `save(...)` (cascade) /
  a dedicated PATCH (password) on click.
- Mode switch still flips visible tabs locally; it also `save({ mode })`.

### Caller (`useGalleryDetail` / `GalleryDetailDialogs`)
`updateMutation` (bundled PATCH + toast + close-on-success) is **replaced** for the modal by the
hook. The success toast goes away (the inline `SaveStatus` is the feedback); the modal no longer
auto-closes on save. `setSettingsOpen(false)` is driven only by the user closing it. Other callers of
`api.galleries.update` (rename dialog) are untouched.

## Backend

**No change.** `PATCH /api/galleries/{id}` already accepts partial `GalleryUpdate` (every field
optional) and already supports `apply_to_subgalleries`. Autosave just sends smaller, more frequent
partial patches through the same endpoint. No migration.

## i18n

Reuse existing `common.saving` / `settings.savedShort` / `settings.saveError` for the chip. Add (if
missing) labels for the explicit cascade button and a "Schließen/Fertig" close affordance under
`settings.gallery.*`. Validate with `node scripts/validate-i18n.mjs`.

## Out of scope / non-goals

- Debounced batching of rapid toggles into one PATCH (not needed; controls are discrete).
- Undo/history of setting changes.
- Touching the instance settings pages or `useSettingsAutosave` (the gallery hook is a sibling, not a
  refactor of the shared one — their cache keys and endpoints differ).
- `PresetEditorModal` (edits `app_settings` presets, not a gallery) keeps its own save flow.

## Risks

- **No discard** — once Cancel is gone, a mistaken toggle is "live" immediately. Mitigated by the fact
  that gallery look/behaviour settings are low-stakes and instantly reversible, and the cascade (the
  one destructive action) stays explicit.
- **Chatty PATCHes** — flipping several toggles fires several requests. Acceptable and identical to
  the existing instance-settings UX; each is a tiny partial patch.
