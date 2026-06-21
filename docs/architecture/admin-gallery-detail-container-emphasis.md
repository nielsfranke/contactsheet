# Admin Gallery Detail — Container vs Leaf Emphasis (Model B)

Status: **implemented** (2026-06-21).

The chosen answer to "how do you browse a hierarchy of galleries in the admin" — picked over the
[contextual navigator](admin-galleries-contextual-navigator.md) (Model A, now superseded).

## The decision

Two models were built and compared live:

- **Model A — contextual column browser.** The overview/tree becomes a Finder-style browser: clicking
  a *container* (has sub-galleries) browses into it in place (`?folder=`), a *leaf* opens its detail
  page. Distinctive, but the same-looking tiles behave differently.
- **Model B — uniform navigation (this doc).** *Every* click — tree or card — opens that gallery's
  detail page. There is no in-place browsing and no `?folder=` state. The detail page itself adapts so
  a container reads as "a folder of galleries" rather than an empty photo page.

We kept **B** for **intuitiveness**: one predictable rule (a click always opens the gallery), no
"will this browse or open?" ambiguity, and no reliance on a strong-enough folder affordance. The
trade-off we accept: at the root the left tree and the canvas show the same top-level list (mild
redundancy), and drilling deep loads a page per level. Both cost less than divergent click outcomes.

## No backend change

`api.galleries.list()` already returns the tree (`children[]`, `image_count`, `cover_image_url`).
No migration, no API change. The overview/tree keep their existing "click → `/admin/galleries/{id}`"
behaviour (the navigator's `?folder=` wiring was never adopted).

## What shipped — detail page emphasis (`app/admin/galleries/[id]/page.tsx`)

A single container flag drives the layout:

```ts
const isContainer = images.length === 0 && children.length > 0;
```

| Gallery | Layout |
|---|---|
| **Container** — sub-galleries, no own photos | **Sub-galleries lead** at the top (with a one-line hint), then a recessed "Add photos to this gallery" area (header/cover CTAs + upload zone, under a muted heading + divider). The sort/filter toolbar and the empty photo grid are **suppressed** — there are no photos to sort or show. |
| **Leaf** — no sub-galleries | Unchanged photo-first: toolbar, grid, upload zone. (A brand-new empty gallery is a leaf, so it keeps the existing onboarding CTAs.) |
| **Mixed** — has photos *and* sub-galleries | Photo-first (it has photos): toolbar, grid, upload, then the sub-galleries section below. |

The sub-galleries `<section>` is built once (`subGalleriesSection`) and placed at the top for a
container or at the bottom otherwise — same markup, position carries the emphasis.

### Why `images.length` (not `gallery.image_count`)
The flag keys on the actually-loaded `images` so it reflects what the admin sees, including any
moderation-pending uploads (those make it photo-first, which is correct).

## Out of scope / preserved
- The overview "Move gallery" action and reparent DnD are unrelated and untouched.
- Model A's design is preserved in its own doc for a possible future revisit (deep libraries +
  unmistakable folder tiles).
