# Deploying Weblate for ContactSheet

This stands up a [Weblate](https://weblate.org/) translation server next to your existing Forgejo,
watching `frontend/messages/*.json`. The two communicate over their **public URLs** (no shared
Docker network), so this stack is fully independent of the Forgejo compose.

- **Forgejo**: `https://forgejo.nielsbox.cc` — repo `niels/ContactSheet`
- **Weblate** (this stack): `https://translate.nielsbox.cc` (pick any subdomain; update it
  consistently below and in `weblate.env`)

Run all of this **on the Forgejo host** (the Linux box, not your Mac). Copy this `deploy/weblate/`
directory there, e.g. `~/weblate/`.

---

## 1. Deploy the Weblate stack

```bash
cd ~/weblate                      # wherever you copied deploy/weblate/
cp weblate.env.example weblate.env
# Generate two secrets and paste them into weblate.env:
openssl rand -base64 36           # → POSTGRES_PASSWORD
openssl rand -base64 36           # → WEBLATE_ADMIN_PASSWORD
# Edit weblate.env: set WEBLATE_SITE_DOMAIN / WEBLATE_ALLOWED_HOSTS to your subdomain,
# and (recommended) fill the SMTP block so translators can self-register.

docker compose up -d
docker compose logs -f weblate    # first boot runs migrations + creates the admin — wait for "Starting"
```

Weblate now listens on `:8080` on the host.

## 2. Reverse proxy (Nginx Proxy Manager)

Add a proxy host, same as you did for Forgejo:

- **Domain**: `translate.nielsbox.cc`
- **Forward Hostname/IP**: the address your proxy can actually reach the Weblate host on.
  If NPM runs on a **different machine** (e.g. a VPS), this is **not** the host's LAN IP — use
  whatever tunnel address the proxy already uses for your other services (Tailscale/WireGuard IP).
  This deployment: NPM on a VPS → WireGuard → `192.168.100.2:8080` (the LAN `192.168.1.23` is
  unreachable from the VPS).
- **Forward Port**: `8080`
- **Websockets Support**: on
- **SSL**: request a Let's Encrypt cert (or use an existing wildcard).

> **Avoid the 301 redirect loop.** With `WEBLATE_ENABLE_HTTPS=1` Weblate turns on SSL-redirect but,
> by default, does **not** trust the proxy's `X-Forwarded-Proto` header — so every plain-http request
> the proxy forwards gets redirected to https, which the proxy forwards as http again → infinite
> loop. The `WEBLATE_SECURE_PROXY_SSL_HEADER=HTTP_X_FORWARDED_PROTO,https` line in `weblate.env`
> (above) fixes it. Verify after setup: `curl -sI https://translate.nielsbox.cc/` should return
> `200`/`302`, **not** a chain of `301`s.

Browse to `https://translate.nielsbox.cc` and log in with `WEBLATE_ADMIN_LOGIN` /
`WEBLATE_ADMIN_PASSWORD`.

## 3. Forgejo: a bot account + token

Weblate pushes translations back with its own identity (so commits are attributable and your
account isn't shared).

1. In Forgejo, create a user, e.g. **`weblate-bot`**.
2. Add it as a **Collaborator with Write access** on `niels/ContactSheet`
   (repo → Settings → Collaborators).
3. As `weblate-bot`: **Settings → Applications → Generate Token** with scopes
   **`write:repository`** (and `read:repository`). Copy the token — you'll paste it into the repo
   URL below.

## 4. Weblate: create the project + component

In Weblate (top-right **+** → *Add new translation project*):

**Project**: name `ContactSheet`, slug `contactsheet`, web `https://github.com/...` or your repo URL.

Then **Add new translation component** in that project, with:

| Setting | Value |
|---|---|
| Source code repository | `https://weblate-bot:<TOKEN>@forgejo.nielsbox.cc/niels/ContactSheet.git` |
| Repository branch | `main` |
| **Push branch** | `weblate` ← translations go here, **not** straight to `main` |
| File format | **JSON nested structure** |
| File mask | `frontend/messages/*.json` |
| Monolingual base language file | `frontend/messages/en.json` |
| Template for new translations | `frontend/messages/en.json` |
| Edit base file | **off** (English is read-only — it changes only via code PRs) |
| Source language | English |

The token is embedded in the repo URL for both pull and push (works for a private repo); Weblate
masks it in the UI. Save — Weblate clones the repo and imports `en` + `de` (it auto-detects the
locale from each filename).

> **Open the door for new languages:** in the component's *Manage → Settings → Translation*,
> ensure **"Start new translation"** is enabled so contributors can add a locale themselves
> (seeded from `en.json`).

### Why a `weblate` branch and not `main`

Weblate commits + pushes to the `weblate` branch. You review and merge those into `main` with a
normal Forgejo pull request, keeping the same review gate as code. To open it: in Forgejo,
**New Pull Request → base `main` ← compare `weblate`**.

*Optional upgrade — automatic PRs:* Weblate can open the Forgejo PR itself. Set the component's
**Pushing changes** to *"Gitea pull request"* and supply API credentials via the
`WEBLATE_GITEA_CREDENTIALS` env var (format varies by Weblate version — see
<https://docs.weblate.org/en/latest/vcs.html#gitea>). Start with the manual flow; switch later.

## 5. Forgejo: webhook for instant sync

So Weblate picks up English changes the moment you merge a PR (otherwise it polls every ~24 h).

Repo → **Settings → Webhooks → Add Webhook → Gitea**:

- **Target URL**: `https://translate.nielsbox.cc/hooks/gitea/`
- **HTTP Method**: POST
- **Trigger**: Push events (you can narrow to the `main` branch)
- Add → use **Test Delivery**; expect HTTP 200.

Weblate matches the incoming payload to the component by repository URL and pulls.

## 6. Verify the round-trip

1. In Weblate, translate a `de` string and save.
2. Weblate commits and pushes to the `weblate` branch (immediately if "Push on commit" is on, or
   click *Manage → Repository maintenance → Push*).
3. Open the PR `weblate → main` in Forgejo, merge it.
4. The webhook fires; Weblate fast-forwards. Done.

## 7. Adding a new language (maintainer step)

When a contributor starts a locale, Weblate creates `frontend/messages/<locale>.json`. After it
lands on `main`, register the locale in the app so it's selectable:

- `frontend/src/i18n/locales.ts` — add the code to `SUPPORTED_LOCALES` and a native label to
  `LOCALE_LABELS`.
- Validate: `cd frontend && node scripts/validate-i18n.mjs` (parity + ICU + key-resolution).

See the repo-root [`TRANSLATING.md`](../../TRANSLATING.md) for the translator-facing flow.

---

## Maintenance

```bash
docker compose pull && docker compose up -d     # upgrade (re-runs migrations on boot)
docker compose exec --user weblate weblate weblate <cmd>   # Django mgmt, e.g. `check --deploy`
```

Back up the `weblate-postgres` and `weblate-data` volumes. Weblate needs ~2 GB RAM; if the host is
tight, lower `WEBLATE_WORKERS` (add it to `weblate.env`, default 4× CPUs+1).
