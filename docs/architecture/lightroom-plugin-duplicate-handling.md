<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Lightroom plugin — duplicate handling on re-export

Status: **approved** (2026-07-07). Decisions locked: **Option B** (plugin pre-flights via
`check-duplicates`, **no ContactSheet server change**); default action **Keep both**; **Export-only**
(Publish keeps its id-based dedup); "Ask each time" deferred. Implementation is entirely in the
`contactsheet-lightroom` repo. Follow-up to
[duplicate-filename upload resolution](./duplicate-filename-upload-resolution.md) (shipped in
v1.6.6). That feature lets the **web UI** resolve same-filename uploads (Replace / Keep both / Skip).
The server contract is client-agnostic, so the Lightroom plugin can adopt it — this note specs how.

Plugin code lives in the separate MIT repo
[contactsheet-lightroom](https://github.com/nielsfranke/contactsheet-lightroom); only a (small,
optional) server tweak would land in *this* repo. Nothing here is required for v1.6.6 — the plugin
works unchanged today.

## The gap this closes

- **Publish Service path — already duplicate-safe, no change.** A published photo records its
  ContactSheet image id (`rendition:recordPublishedPhotoId`); a re-publish does
  `DELETE /api/images/{id}` then re-uploads, so the old image is gone before the new one lands → no
  collision. Untracked photos are the only edge (below).
- **Export path (File → Export) — the real gap.** A plain export has *no* id mapping. Re-exporting
  the same filenames into the same gallery appends duplicates every time — exactly Matthias's
  Finder/Export complaint, just from Lightroom. This is what the enhancement targets.

## Proposed plugin UX

One new control in the plugin's export/publish settings (`sectionsForTopOfDialog`, `LrView`
popup): **"If a photo already exists in the gallery:"**

| Choice | Wire action | Result |
|---|---|---|
| Keep both *(default)* | `keep_both` | New file uploaded, renamed `_v2` / `_v3` |
| Replace existing | `replace` | Existing photo overwritten in place (keeps its id/feedback/cover) |
| Skip | `skip` | Existing photo left as-is, new render not uploaded |

Persisted in the export preset like any other export setting (`exportSettings`), so it rides along
with the user's chosen preset. The value is applied to the whole export/publish run.

Default is **Keep both** — non-destructive, matches the web UI default. The photographer opts into
Replace consciously (that's the "I re-exported edited versions, overwrite them" case).

## Wire behaviour — the design fork

The plugin uploads per rendered file in `processRenderedPhotos` via `LrHttp.postMultipart`. To honour
the setting it attaches `duplicate_actions` (a JSON object `{ basename → action }`) to the multipart
`POST /api/galleries/{id}/images`. The question is *which* filenames it lists — and that hinges on a
server-semantics detail:

**Today the actions are unconditional** (by design for the web UI, which only ever sends an action for
a filename its pre-flight already flagged as colliding):
- `replace` on a non-colliding name → falls through to a normal add (safe).
- `keep_both` on a non-colliding name → still renamed `_v2` (**wrong** for a blanket sender).
- `skip` on a non-colliding name → the file is dropped (**wrong** for a blanket sender).

So a plugin that blindly sends its chosen action for *every* file only works for `replace`.

### Decided: Option B — plugin pre-flights, no server change

The plugin resolves collisions itself and sends actions **only** for filenames that actually collide,
so it never relies on the server's unconditional behaviour. Concretely:

1. **Collect the run's basenames.** Lightroom knows each photo's rendered filename; the plugin
   gathers the target basenames for the export/publish run (deduping within the run).
2. **One pre-flight call** to `POST /api/galleries/{id}/images/check-duplicates` with those filenames
   → the set of names that already exist (live) in the gallery, with counts.
3. **Build the actions map** as `{ collidingBasename → userChoice }` (the run's single dropdown
   value). Non-colliding files are absent from the map → the server adds them normally.
4. **Upload** each rendered file via `POST …/images` with the `duplicate_actions` field attached
   (empty/omitted when there were no collisions → identical to today's behaviour).

Works against any server from **v1.6.6** onward; **no ContactSheet change required**. The one extra
cost is a single pre-flight request per run and gathering the filenames up front — cheap. The plugin
must handle the empty-collision case (omit the field entirely).

*(Rejected: Option A — a server-side "collision-aware" tweak that would let the plugin blanket-send
its choice for every file. Cleaner client contract, but we opted to keep ContactSheet untouched and
put the logic in the plugin.)*

## Deferred: "Ask each time"

A fourth choice could show a Lightroom dialog listing the colliding filenames before upload (like the
web dialog). Since Option B already pre-flights, the collision set is *available* to drive such a
dialog later at low extra cost — but it's deferred: the per-run dropdown covers the real workflow.

## Scope & non-goals

- Applies to the **Export** path and any **untracked** collision in Publish. Tracked re-publish keeps
  its delete-then-reupload id logic (runs first; after the delete there's no live match, so the
  setting is a no-op there).
- No change to the readback endpoint, PAT scopes, or any existing plugin call.
- `keep_both`'s `_v2` naming is the server's, so it's identical to the web UI — the plugin sends the
  intent, not the new name.

## Decisions (locked 2026-07-07)

1. **Wire contract:** Option B — plugin pre-flights via `check-duplicates`, **no ContactSheet change**.
2. **Default action:** Keep both (non-destructive; user opts into Replace).
3. **"Ask each time":** deferred.
4. **Scope:** Export-only (Publish keeps its id-based dedup).

## Rollout

- **ContactSheet:** nothing — the feature is inert for clients until the plugin opts in, and the
  plugin targets the already-shipped v1.6.6 endpoints.
- **Plugin (`contactsheet-lightroom`):** add the settings dropdown (`exportSettings` +
  `sectionsForTopOfDialog`), the pre-flight + actions-map logic in `processRenderedPhotos`, and the
  `duplicate_actions` multipart field on upload. Ship as a `contactsheet-lightroom` release; the
  plugin requires a server ≥ v1.6.6 for the pre-flight endpoint (surface a clear message on 404 from
  an older instance).
- Update the plugin repo README + the ContactSheet wiki (both clones) with the new setting.
