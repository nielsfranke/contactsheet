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

**You don't need to be a developer, install anything, or touch any code.** Everything happens in
your browser through Weblate — a friendly web editor that shows the English text next to a box where
you type your language.

### 👉 Start here: <https://translate.nielsbox.cc/>

1. **Create a free account** (or sign in) and open the **ContactSheet** project.
2. **Pick your language.** Don't see it? Click **Start new translation** (a.k.a. *Add new
   translation*) and choose it — every text is seeded from English, ready for you to fill in.
3. **Translate, one text at a time.** Weblate shows the English original and a hint about where the
   text appears in the app (e.g. `gallery.lightbox.next`). Not sure about a string? Skip it, or leave
   a comment — you don't have to do everything at once, and partial translations are welcome.
4. **Save.** That's it. Weblate collects your changes and proposes them to the project automatically;
   a maintainer reviews and publishes them. A new language shows up in the app once a maintainer
   switches it on.

> You never edit files by hand and you never use Git. (Behind the scenes the text lives in JSON
> catalogs under `frontend/messages/`, but Weblate takes care of all of that for you.)

### One thing to watch: keep the “code-looking” bits

Most strings are plain sentences — just translate them. A few contain little placeholders or
formatting that must stay **exactly as written**, because the app fills them in at runtime. Don't
worry about memorizing the rules: Weblate warns you if you change one by mistake.

The details are below under *ICU MessageFormat*.

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
