<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Client review-mode switch (Showcase → Review, opt-in)

## Goal

Let clients viewing a **Showcase** gallery switch into the **Review** experience
themselves — to flag, rate, comment or annotate after all — without the
photographer having to flip the gallery's mode for everyone. Opt-in **per
gallery**, off by default (picdrop offers the same as an optional per-gallery
release).

The gallery's stored `mode` stays `"presentation"`; the switch is a *view*
toggle for the client plus a server-side permission that the review write
endpoints honour.

## Setting

New column `galleries.client_mode_switch_enabled` (bool, default `false`,
migration 0043). Only meaningful on `mode="presentation"` galleries — Review
galleries already have everything, and the field is simply ignored there.

Field-list plumbing in `gallery_service.py`:

- Added to `_PASSTHROUGH_UPDATE_FIELDS` → automatically part of
  `_CASCADE_FIELDS` (apply-to-subgalleries) and `_INHERIT_CREATE_FIELDS`
  (new sub-galleries copy the parent).
- Added to `_PRESET_FIELDS` + `schemas.settings.GalleryPreset`, so the
  Showcase mode preset can default it on for new galleries.
- Exposed on `GalleryResponse` **and** `GalleryPublicResponse` (the public
  viewer needs it to render the toggle).

## Backend gate

Today the review write endpoints reject non-collaboration galleries via
scattered `gallery.mode != "collaboration"` checks (`image_service.set_flag` /
`rate` / `toggle_like`, `public.py` comment creation). These collapse into one
helper:

```python
def review_active(gallery: Gallery) -> bool:
    return gallery.mode == "collaboration" or gallery.client_mode_switch_enabled
```

used everywhere the old check lived. Semantics: enabling the switch **opens the
review endpoints for that gallery**, regardless of what the client UI currently
shows — the server cannot (and should not) know whether an individual client
has toggled. That is the same trust model as a Review gallery; the photographer
opted in explicitly.

Everything downstream is unchanged: the per-gallery feature toggles
(`color_flags_enabled`, `likes_enabled`, `comments_enabled`,
`annotations_enabled`, `enable_team_voting`) keep gating *which* review
features exist, notifications/activity fire from the endpoints as before, and
moderation/soft-delete rules are untouched.

## Public viewer (frontend)

`useGalleryView` currently derives everything from
`collabMode = gallery.mode === "collaboration"`. That becomes:

```ts
const canSwitch = gallery.mode === "presentation" && gallery.client_mode_switch_enabled;
const collabMode = gallery.mode === "collaboration" || (canSwitch && reviewSwitched);
```

`reviewSwitched` lives in a small Zustand **persist (sessionStorage)** store,
keyed **per visible subtree**: `ancestors[0]?.share_token ?? share_token`. The
breadcrumb chain is already clamped at standalone (`hide_parent_nav`)
boundaries, so the key is stable while the client navigates between a gallery
and its sub-galleries — the switch survives navigation but never leaks across
unrelated galleries or browser sessions.

Because everything else already hangs off `collabMode` (sidebar layout, grid
hover toolbars, lightbox flag/comment UI, reviewer-name prompt, feature
flags), no further view logic changes: flipping the flag re-renders the full
Review experience, including the opener → the two-column `GalleryCollabLayout`.

A sub-gallery still follows **its own** fields (existing invariant): it shows
the toggle only if it has `client_mode_switch_enabled` itself (inherited on
create, cascadable via apply-to-subgalleries).

### Toggle UI

One control, both directions:

- **Showcase → Review:** label ~"Review photos" (i18n, DE „Fotos bewerten"),
  visible only when `canSwitch`, always **beside the download button** — in the
  hero variant both share the one centred row between hero and grid, in the
  standard header it sits inline in the header's action group. Outline style
  (secondary), download stays the filled primary.
- **Review → Showcase:** a "Back to showcase" button at the bottom of the
  CollabSidebar while `canSwitch && reviewSwitched`.

No URL parameter, no separate share link — same token, same auth, pure client
state.

## Admin settings UI

`GallerySettingsModal`, directly under the "Start client view in" mode
selector: when `mode === "presentation"`, a toggle **"Let clients switch to
review mode"** (autosaved immediately, like all toggles).

When it's on, the **Review tab appears for Showcase galleries too** (tab gate
changes from `mode === "collaboration"` to `mode === "collaboration" ||
clientModeSwitch`), so the photographer can configure which review features
the client gets after switching. The Opener tab stays Showcase-only.

The Showcase preset editor (`PresetEditorModal`) gains the same toggle.

## Tests

- Backend: flag/rate/like/comment on a presentation gallery → 400 without the
  switch (existing behaviour, now via the helper), 2xx with it; field present
  in public serializer; inherit-on-create + cascade + preset merge cover the
  new field.
- E2E (optional follow-up): client toggles a showcase gallery into review and
  flags a photo.

## Deployment impact

Standard release: image pull + restart; Alembic migration 0043 runs on
startup. No nginx/compose changes, no new env vars. Existing galleries are
unaffected (default off).
