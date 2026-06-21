<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Releasing

Images are built by CI (`.github/workflows/release.yml`) — you only cut the tag.

## Cutting a release

1. Bump the version in **both** `backend/app/version.py` and `frontend/package.json`.
2. Move the `[Unreleased]` notes into a new `## [X.Y.Z]` section in `CHANGELOG.md` and update the
   compare links at the bottom.
3. Commit, then tag and push:

   ```bash
   git commit -am "Release vX.Y.Z"
   git tag -a vX.Y.Z -m "ContactSheet vX.Y.Z — <short title>"
   git push origin main
   git push origin vX.Y.Z
   ```

The tag reaches GitHub via the push-mirror, which fires the workflow. It builds the multi-arch
(`linux/amd64` + `linux/arm64`) **backend** and **frontend** images and pushes
`ghcr.io/nielsfranke/contactsheet-{backend,frontend}:X.Y.Z` (+ `:latest`).

`:latest` only moves for final releases; a prerelease tag like `vX.Y.Z-rc1` publishes the version
tag only. Watch the run under the repo's **Actions** tab on GitHub.

After the images push, the `release` job publishes the **GitHub release** automatically — the body
is the `## [X.Y.Z]` section from `CHANGELOG.md` (extracted by `scripts/changelog-extract.py`) plus a
compare link, and the title is the annotated tag's subject (`ContactSheet vX.Y.Z — …` → `vX.Y.Z —
…`). So the only hand-written input is the changelog entry and the tag message — no more clicking
"new release". Re-running a tag updates the existing release in place.

## One-time setup

**GHCR (required).** The workflow pushes with the built-in `GITHUB_TOKEN`. Because the two GHCR
packages were first created from a local push, grant the repo write access once:
GitHub → each package (`contactsheet-backend`, `contactsheet-frontend`) → **Package settings** →
*Manage Actions access* → add `nielsfranke/contactsheet` with the **Write** role. Without this the
first CI push fails with `denied: permission_denied`.

## Manual fallback

If CI is unavailable, build and push locally with the `cs-builder` buildx builder:

```bash
docker buildx build --builder cs-builder --platform linux/amd64,linux/arm64 --target backend \
  -t ghcr.io/nielsfranke/contactsheet-backend:X.Y.Z -t ghcr.io/nielsfranke/contactsheet-backend:latest \
  --push .
# repeat with --target frontend
```
