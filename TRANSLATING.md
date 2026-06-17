# Translating ContactSheet

ContactSheet is fully translatable, and we welcome community translations. **English is the single
source of truth** — every other language is a translation of it.

The golden rule: **don't edit code to translate.** Translators work entirely in
[Weblate](https://weblate.org/) (a web UI); maintainers change the English source only via pull
requests. This keeps translations safe from merge conflicts and lets non-developers contribute.

> By submitting a translation you agree to the [Contributor License Agreement](CLA.md), the same as
> any other contribution.

---

## For translators

All UI text lives in JSON catalogs under [`frontend/messages/`](frontend/messages/):
`en.json` is the source; `de.json`, `fr.json`, … are translations. You never touch these files
directly — you edit them through Weblate.

### Translate an existing language

1. Open the ContactSheet project in Weblate.
2. Pick your language, then translate string by string. Weblate shows the English source, the key
   name (which hints at where the string appears, e.g. `gallery.lightbox.next`), and any context.
3. Save. Weblate batches changes and opens a pull request back to the repository; a maintainer
   reviews and merges it.

### Start a new language

Weblate has "start new translation" enabled. Choose **Add new translation**, pick the language,
and Weblate seeds it from `en.json` so every key is present and ready to fill in. Once a maintainer
registers the locale in the app (see below) it becomes selectable.

### ICU MessageFormat — what you must keep

Strings use [ICU MessageFormat](https://formatjs.github.io/docs/core-concepts/icu-syntax/) for
plurals and interpolation. **Translate the human text, never the syntax:**

- **Placeholders** — keep `{name}`, `{count}`, `{pct}` exactly as written; they're filled in at
  runtime. `"Uploading… {pct}%"` → `"Wird hochgeladen… {pct}%"`.
- **Plurals** — keep the `{count, plural, …}` wrapper and the category keywords (`one`, `other`,
  and `=0`, `few`, `many` where your language needs them). The `#` is replaced by the number.

  ```
  en: "{count, plural, one {# photo} other {# photos}}"
  de: "{count, plural, one {# Foto} other {# Fotos}}"
  ```

  Add the plural categories **your** language requires — ICU supports languages English can't
  express (Polish, Russian, Arabic, …). Weblate shows the right set of categories per language.
- **Rich tags** — a few strings carry inline tags like `<b>{name}</b>` or `<link>…</link>`. Keep
  the tags and their order; translate only the text between them.

Weblate's built-in checks flag mismatched placeholders, broken ICU, and missing interpolations
before a translation can be marked done — fix any it raises.

---

## For maintainers

### How localization works

The app uses [`next-intl`](https://next-intl.dev/) in "without i18n routing" mode (no `/de/…` URL
prefix). Locale is resolved per request in `frontend/src/i18n/request.ts`: `NEXT_LOCALE` cookie →
`Accept-Language` negotiation → `en`. The admin picks their language in
**Settings → Workspace** (persisted to `app_settings.admin_locale` + a cookie); public gallery
visitors are auto-detected. See [`docs/architecture/i18n-and-localization.md`](docs/architecture/i18n-and-localization.md).

Backend `HTTPException` strings stay in **English** by design (dev/admin facing). The handful of
errors clients actually see carry a stable machine-readable `code` (`CodedHTTPException` in
`backend/app/errors.py`); the frontend maps `code → localized message` under the `errors.*` keys —
so all client-visible translation stays in the catalogs.

### Registering a new locale in the app

After Weblate adds `messages/<locale>.json`, wire it up in
[`frontend/src/i18n/locales.ts`](frontend/src/i18n/locales.ts):

1. Add the code to `SUPPORTED_LOCALES`.
2. Add its native-name label to `LOCALE_LABELS` (e.g. `fr: "Français"`).

That's all — `request.ts` loads `messages/<locale>.json` dynamically and the picker reads
`SUPPORTED_LOCALES`. No route or build changes.

### Validating catalogs

Before merging a translation PR, run the catalog validator from `frontend/`:

```bash
cd frontend
node scripts/validate-i18n.mjs
```

It checks every catalog: ICU parses, en↔de (and any other locale) **key parity**, **placeholder/arg
consistency** per key, and that every `t("key")` used in the code resolves against `en.json`. It
exits non-zero on any problem. (`npm run build` also type-checks the app.)

### Weblate component configuration

Point a Weblate component at this repository (self-hosted Forgejo) with:

| Setting | Value |
|---|---|
| File format | **JSON nested structure** |
| Monolingual base language file | `frontend/messages/en.json` |
| File mask | `frontend/messages/*.json` |
| Template for new translations | `frontend/messages/en.json` |
| Start new translation | **enabled** |
| Source language | English |

English is **read-only** in Weblate — it changes only through code PRs. Weblate commits
translations to a branch and opens a PR; the quality checks (placeholder/ICU consistency, missing
interpolations) gate them.

If you'd rather not self-host Weblate, [Crowdin](https://crowdin.com/) or
[Tolgee](https://tolgee.io/) use the same catalog format, so the choice is reversible and doesn't
touch the app code.
