# Proposal: per-container mode presets for nested galleries

Status: **proposal / awaiting decision** · Author: Niels (with Claude) · 2026-07-08

> Not an official architecture doc yet — this specs a change before implementation, per the
> "arch note first" workflow. Two parts: a small standalone fix (Part 1) and a larger feature
> (Part 2). Part 1 can ship independently.

## Problem

ContactSheet galleries nest to any depth. A photographer works with a **container** gallery that
holds no photos of its own (e.g. *PerfectHome*), only sub-galleries. Two gaps in how those
sub-galleries pick up look & behaviour:

1. **A sub-gallery created with a _different_ mode than its parent inherits the wrong look.** Create
   a Showcase sub-gallery under a Review parent → it copies the parent's Review-tuned look &
   behaviour, not the Showcase standard preset. Nothing about the parent's Review styling fits a
   Showcase gallery.

2. **No place to define a _custom_ template for the other mode inside a container.** *PerfectHome*
   is Review and heavily customized. The photographer also wants several **custom Showcase**
   sub-galleries in it. Today the custom Showcase look has nowhere to live — every Showcase
   sub-gallery has to be styled by hand. There is no "Showcase preset for this folder".

(1) is a plain inheritance bug; (2) is the feature Niels asked for: *"in der Top-Level-Galerie
sowohl custom Review als auch Showcase festlegen können."* Neither is part of Matthias's feedback —
this is an internal-workflow improvement.

## Current mechanics (precise)

- **Instance presets** — `app_settings.preset_presentation` (Showcase) and `preset_collaboration`
  (Review), JSON in the `GalleryPreset` shape (`schemas/settings.py`). Applied to **top-level**
  galleries on create, for the chosen mode.
- **Sub-gallery create** — `gallery_service._resolve_create_defaults`: when `parent is not None`,
  copies the parent's `_INHERIT_CREATE_FIELDS` (look & behaviour, `mode` included unless explicit).
  Only **top-level** galleries consult the instance preset.
- **Cascade** ("apply to sub-galleries") — copies `_CASCADE_FIELDS` (incl. `mode`) to the whole
  descendant subtree (as of the 2026-07-08 fix).

So the instance preset never reaches a sub-gallery, and there is exactly one look per container
(its own mode's fields).

## Part 1 — divergent mode → standard preset (small, standalone)

**Change:** in `_resolve_create_defaults`, when creating a sub-gallery whose **explicit mode differs
from the parent's**, take the instance-preset branch (like a top-level gallery) instead of copying
the parent. Same-mode / unspecified-mode sub-galleries keep inheriting from the parent.

```python
inherit_from_parent = parent is not None and (
    "mode" not in explicit or data.mode == parent.mode
)
if inherit_from_parent:
    for field in _INHERIT_CREATE_FIELDS:            # parent's live fields
        ...
else:                                               # top-level OR divergent-mode sub-gallery
    preset = preset_collaboration if mode == "collaboration" else preset_presentation
    for field in _PRESET_FIELDS:                    # instance standard preset
        ...
```

Explicit request fields still win. **No migration, no UI.**

### Open decision A — `mode` in the cascade

`mode` is a cascade field. So after Part 1 gives you a Showcase sub-gallery under a Review parent, a
later "apply to sub-galleries" on the parent **re-flips it back to Review** (mode + Review look). A
divergent-mode sub-gallery is therefore not stable under re-cascade. Options:

- **A1** — leave as-is (documented sharp edge).
- **A2** — cascade skips `mode` for descendants whose current mode already differs from the parent
  (their look fields still cascade only if same mode — needs care).
- **A3** — drop `mode` from `_CASCADE_FIELDS` entirely; "apply to sub-galleries" never changes a
  child's mode, only its look & behaviour. Cleanest, but changes existing cascade semantics.

Recommendation: **A3** — mode is an identity-ish choice per gallery; look & behaviour is what people
mean by "apply to all". Pairs naturally with Part 2.

## Part 2 — per-container mode presets (the feature)

Give each gallery an optional **sub-gallery preset per mode**, reusing the existing `GalleryPreset`
shape. New sub-galleries consult the nearest such preset for their mode before falling back to the
instance preset.

### Data — Option A (recommended)

One nullable JSON column on `galleries`:

```
subgallery_presets = { "presentation": GalleryPreset, "collaboration": GalleryPreset }   # both optional
```

- **Inherited on create** (add to `_INHERIT_CREATE_FIELDS`) so every descendant of a container
  carries a copy → a plain **immediate-parent** lookup works at any nesting depth, no ancestor walk.
- **Cascadable** (add to `_CASCADE_FIELDS`) so editing the top container's presets can be pushed
  down on demand.

Sub-gallery create in mode `X`:

1. `base` = `parent.subgallery_presets[X]` if set, else `instance_preset[X]`.
2. Merge `base` field-by-field (absent field → model default).
3. Explicit request fields win.

### Open decision B — same-mode children

Today a same-mode child copies the parent's **live** fields (child looks like parent). With
`subgallery_presets`, does a Review child of a Review parent use the parent's live fields (today) or
`parent.subgallery_presets["collaboration"]`?

Recommendation: **keep same-mode = copy parent's live fields.** `subgallery_presets` only supplies
the **other** mode(s). This keeps the intuitive "sub-galleries look like their parent" behaviour and
means the UI only needs to expose the non-active mode(s) as an editable preset. Simplest mental
model that matches the request.

### Data — Option B (rejected)

Ancestor-walk at create time (nearest ancestor defining a preset for `X` wins), no
inheritance-copy. More flexible for retroactive edits, but more logic and a second traversal;
the inheritance-copy in Option A already models the tree and is consistent with how look &
behaviour is inherited today. Not recommended.

## Migration

`0045` — add nullable JSON `subgallery_presets` to `galleries`. No backfill (null = "no override →
fall back to instance preset"). Standard image pull + `alembic upgrade head` (auto on startup). **No
nginx / deploy impact.**

## API

- `GalleryUpdate` accepts `subgallery_presets: dict[str, GalleryPreset] | None` (validated against
  the two known mode keys).
- `GalleryResponse` exposes it so the settings modal can render/edit it.

## UI

Gallery Settings modal → new **"Sub-gallery defaults"** section, shown on galleries that have (or
can have) children. Per non-active mode, a compact preset editor reusing the existing gallery-preset
field controls (`gallery-settings-fields.tsx` / the Settings preset editor). i18n keys under
`admin.gallerySettings.subgalleryPresets.*`.

## Recommendation / sequencing

1. **Ship Part 1 now** — tiny, standalone, no migration. Decide **A** (recommend **A3**).
2. **Part 2 as Option A** — decide **B** (recommend "same-mode copies parent"). Then: migration →
   schema/service → API → settings-modal UI → tests (create-inheritance matrix + cascade).

Both parts are internal workflow polish, independent of the shipped Matthias fixes.
