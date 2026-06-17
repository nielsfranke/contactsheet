# ContactSheet — Open Source Selfhosted Photo Delivery App

> Name: **ContactSheet** — because photographers know the feeling
> License: GPL-3.0-or-later / Open Source
> Repo: https://your-git-host/contactsheet
> Ziel: Selbst hosten auf dem eigenen Server, Bilder an Kunden ausliefern
> Keine Monetarisierung, kein SaaS, kein Verkauf

---

## Übersicht

| Phase | Was | Status |
|-------|-----|--------|
| **1** | MVP: Galerien + Upload + Presentation Mode + Docker | ✅ |
| **2** | Collaboration Mode + Lightroom/C1 Export | ✅ |
| **3** | Feinschliff: Annotations, Voting, Branding, Video | ⬜ |

---

## Architecture Requirements (MUST)

Diese Regien gelten für ALLE Phasen und dürfen nicht verletzt werden:

- **Clean Architecture**: Separate layers — routes, services, repository/storage, models
- **Frontend ↔ Backend komplett getrennt** — keine DB-Zugriffe aus dem Frontend
- **REST API first** — alle Funktionalität muss via API erreichbar sein
- **Repository/Service Pattern**: Business Logic gehört in Services, nicht in Route Handler
- **UUIDv4** für alle Primary Keys — niemals `id`-Sequenzen nach aussen exposed
- **Type-safe**: TypeScript strict mode, Pydantic models auf Backend-Seite
- **Soft Delete**: Gallery+Image haben `deleted_at: datetime | null` — nichts wird wirklich gelöscht
- **Keine Business Logic in Route Handlern** — ein Handler ruft einen Service auf, das war's

**Workflow für Claude Code Sessions:**

```
1. Read the entire specification
2. Create a detailed technical architecture document, DB schema, API design, and implementation roadmap
3. Do NOT write code yet — get architecture approved first
4. Then implement Phase X exactly as specified
```

# PHASE 1 — MVP

## Prompt für Claude Code / OpenCode

> Diesen Prompt kopieren und als erste Session starten.

```
Build a selfhosted photo delivery webapp called "ContactSheet".

Tech Stack:
- Backend: Python FastAPI
- Frontend: Next.js (App Router) + React + Tailwind CSS + shadcn/ui
- Database: SQLite (via SQLAlchemy + Alembic)
- Storage: local filesystem (with storage abstraction layer)
- Auth: JWT for admin + signed token for gallery sharing
- Image processing: Pillow (thumbnails, medium res)
- Deployment: Docker Compose (app + nginx)

Database path: /data/contactsheet.db
Upload path: /data/uploads/
Environment: SECRET_KEY, UPLOAD_DIR, DB_URL (default sqlite:///data/contactsheet.db)

---

## Phase 1 Features — Build ALL of these:

### 1. Gallery Tree (2 Levels)
- Gallery can contain sub-galleries (max 2 levels: Gallery → Sub-Gallery)
- Admin dashboard with sidebar tree view
- Create, rename, delete, reorder galleries
- Each gallery has: name, description, password (nullable), layout (grid/masonry/list)

### 2. Upload
- Drag & drop multiple files
- Click-to-browse upload
- Upload to specific gallery
- Supported: JPEG, PNG, TIFF, WebP, HEIC, AVIF
- Progress indicator

### 3. Image Processing (on upload via BackgroundTasks)
- Store original in: /data/uploads/{gallery_id}/original/{filename}
- Generate 300px thumb → /data/uploads/{gallery_id}/thumb/{filename}
- Generate 1920px medium → /data/uploads/{gallery_id}/medium/{filename}
- Storage abstraction layer: StorageProvider class with LocalStorage implementation

### 4. Presentation Mode (Client View)
- Unique share URL per gallery: /g/{SHARE_TOKEN}
- Optional password gate (bcrypt verify)
- Clean dark-mode gallery grid (responsive)
- Layout options: Grid (equal thumbs), Masonry (variable heights)
- Click opens lightbox: full-res image, prev/next navigation, EXIF info
- Single-image download button
- Slideshow mode (auto-advance every 5s)

### 5. Admin Dashboard
- Login page (single admin, JWT)
- Gallery management: create, edit, delete
- Upload zone
- Copy share link button
- Set/change gallery password
- Delete images
- Dashboard shows: gallery list with thumbnail count, share links

### 6. Docker Deployment
- Dockerfile (multi-stage: build frontend, serve with uvicorn)
- docker-compose.yml with app + nginx
- Volumes: ./data for DB + uploads
- Port: 8765 (or env var)
- README with one-command deploy: docker compose up -d
- .env.example with SECRET_KEY generation

---

## Data Models

```python
# All PKs = UUIDv4 — never exposed, never auto-increment

class Gallery:
    id: UUID (PK, default=uuid4)
    parent_id: UUID (nullable, FK → self)
    name: str
    description: str (default "")
    password_hash: str (nullable)
    share_token: str (unique, auto-generated UUID)
    mode: enum("presentation", "collaboration") default "presentation"
    layout: enum("grid", "masonry", "list") default "grid"
    sort_order: int
    tags: JSON (default [], prepared for future)
    watermark_settings: JSON (nullable, prepared for future)
    expires_at: datetime (nullable)
    downloads_enabled: bool default True
    deleted_at: datetime (nullable)   # soft delete
    created_at, updated_at

class Image:
    id: UUID (PK, default=uuid4)
    gallery_id: UUID (FK)
    original_filename: str
    stored_filename: str (UUID-based)
    width, height: int
    file_size: int
    mime_type: str
    exif_data: JSON (nullable)
    sort_order: int
    color_flag: enum("none", "green", "red", "yellow", "blue") default "none"
    likes: int default 0
    tags: JSON (default [], prepared for future)
    deleted_at: datetime (nullable)   # soft delete
    created_at
```

## File Types (Phase 1)
- ✅ JPEG, PNG, WebP
- ❌ TIFF, HEIC, AVIF (Phase 3)

## What to SKIP in Phase 1
- ❌ Collaboration tools (comments, flags, annotations)
- ❌ C1/Lightroom export
- ❌ Team voting
- ❌ Branding/logo customization
- ❌ Video support
- ❌ ZIP downloads
- ❌ Watermarks
- ❌ User management
```

---

# PHASE 2 — Collaboration + Export

## Prompt für Claude Code / OpenCode

> Nach Phase 1 starten. Baut auf bestehendem Code auf.

```
Continue building ContactSheet. Keep all existing Phase 1 features.
Now add Collaboration Mode and Lightroom/Capture One Export.

---

### 1. Collaboration Mode (per-gallery toggle)
New per-gallery setting: mode = enum("presentation", "collaboration")
- Default: "presentation" (existing behavior, unchanged)
- When "collaboration": client view gets additional tools

### 2. Color Flag System
- Client can click to set flag on any image: green (yes/select), red (no/reject), yellow (maybe), blue (favorite)
- Only one flag per image per session
- Admin dashboard shows flag counts per image
- Flag state persists (stored in DB)

### 3. Like System
- Heart button on each image in collaboration mode
- Count displayed, increment only (no per-user tracking needed for MVP)
- Classic Instagram-style interaction

### 4. Comments on Images
- Simple text comment form below each image in lightbox
- Fields: author_name (required), text (required)
- No login required for clients
- Display: name + timestamp + text, chronological
- Admin dashboard shows comment count per gallery

### 5. Client Collaboration UI
- Clean overlay toolbar when entering gallery
- "Click an image to flag, like, or comment" hint
- Flag buttons below thumbnail in grid view
- Heart button below thumbnail
- Comment icon shows count

### 6. Lightroom / Capture One Export (KILLER FEATURE)
- Admin dashboard: "Export Selections" button per gallery
- Generates a CSV/TXT file with filenames of all flagged images
- Format: one filename per line (just the original_filename)
- Optional: include flag color in export
  → "just the filenames you selected" export
  → photographer pastes into Lightroom/C1 search → instantly finds files
- Download the export as .txt file
- This saves 30+ minutes per job

### 7. Admin Dashboard Updates
- Gallery list shows collaboration vs presentation badge
- Image list shows flag states (colored dots)
- Export button appears on collaboration galleries
- Comment count badge per gallery

### New Data

```python
class Comment:
    id: UUID (PK)
    image_id: UUID (FK)
    author_name: str
    text: str
    created_at
```

## What to SKIP in Phase 2
- ❌ Annotations/drawing on images
- ❌ Team voting (multiple reviewers)
- ❌ Real-time updates (WebSocket)
- ❌ Branding/logo
```

---

# PHASE 3 — Feinschliff

## Prompt für Claude Code / OpenCode

> Nach Phase 2 starten. Baut auf bestehendem Code auf.

```
Continue building ContactSheet. Keep all existing Phase 1 + 2 features.
Now add advanced features.

---

### 1. Annotations (Draw on Image)
- In collaboration mode, clients can draw/scribble directly on image
- Open image in annotation canvas (overlay)
- Tools: freehand pen, rectangle, arrow, text
- Color picker (red, green, blue, yellow, white)
- Save annotation as JSON coordinates
- Display annotation as overlay on image in lightbox
- Photographer can toggle annotation visibility

### 2. Team Voting
- Gallery setting: enable_team_voting (bool)
- When enabled, clients enter their name (not login) — like a guestbook
- Each named reviewer gets their own flag set
- Admin sees vote aggregation per image
- "3 of 5 reviewers selected this image" display

### 3. Watermarks
- Gallery setting: watermark_image (upload PNG), position, opacity (0-100%), size (small/medium/large)
- Applied on-the-fly when serving medium/original images (not stored on disk)
- Use Pillow to composite watermark
- Toggle: show watermark in gallery vs. download without

### 4. Branding (per-instance)
- Settings page: upload logo (replaces header), set accent color
- Gallery header image upload per gallery
- Custom text/headline per gallery

### 5. ZIP Download
- "Download All" button → generates ZIP of selected/original images
- "Download Selected" → ZIP of flagged images only
- Async: background task, notification when ready

### 6. Video Support
- Accept MP4, MOV uploads
- Generate poster frame (ffmpeg, first frame)
- Display as video thumbnail with play icon
- Inline player in lightbox

### 7. Activity Log
- Admin dashboard: activity feed per gallery
- "Client X commented on image Y"
- "Image Z was flagged green"
- Timestamps, chronological

### 8. Gallery Expiration
- Per-gallery setting: expires_at (datetime, nullable)
- After expiry: gallery displays "This gallery has expired" message
- Images are not deleted, gallery can be re-enabled

### 9. Real-time Updates (optional)
- WebSocket: when client flags/comments, admin sees it live
- When admin uploads new images, client gallery updates

### New/Updated Data

```python
class Annotation:
    id: UUID (PK)
    image_id: UUID (FK)
    reviewer_name: str (nullable)
    annotation_data: JSON (coordinates, tool type, color, stroke width)

class Activity:
    id: UUID (PK)
    gallery_id: UUID (FK)
    image_id: UUID (nullable)
    action: str (commented, flagged, liked, annotated)
    author: str
    created_at
```

---

## What NOT to Build (ever)
- ❌ Monetization / payment / subscription
- ❌ User registration / accounts for clients
- ❌ Multi-tenant / SaaS
- ❌ Analytics / tracking
- ❌ AI features
```

---

# Deployment Reference

## docker-compose.yml

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "${PORT:-8765}:8000"
    volumes:
      - ./data:/data
      - ./uploads:/data/uploads
      - ./thumbnails:/data/thumbnails
    environment:
      - SECRET_KEY=${SECRET_KEY}
      - DB_URL=sqlite:///data/contactsheet.db
      - UPLOAD_DIR=/data/uploads
    restart: unless-stopped
```

## Nginx Proxy Manager (NPM) Setup
- Domain: `your-domain.example.com`
- Proxy to `http://192.168.1.x:8765` (your Docker host)
- SSL via Let's Encrypt

## Folder Structure
```
~/contactsheet/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── README.md
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── routers/
│   │   ├── services/
│   │   └── storage/
│   ├── alembic/
│   └── requirements.txt
├── frontend/
│   ├── app/
│   ├── components/
│   └── package.json
└── data/
    ├── contactsheet.db
    └── uploads/
```

---

# Quick-Start Cheat Sheet

```bash
# 1. Clone & setup
git clone https://your-git-host/contactsheet.git contactsheet
cd contactsheet
cp .env.example .env
# Edit .env: set SECRET_KEY (generate with: openssl rand -hex 32)

# 2. Start
docker compose up -d

# 3. Open browser
# http://localhost:8765
# http://your-domain.example.com (via NPM)
```
