# ContactSheet — Phase 1 Technical Architecture

> Status: Draft — pending approval before implementation begins
> Scope: Phase 1 MVP only (Galleries + Upload + Presentation Mode + Docker)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Technology Stack](#2-technology-stack)
3. [Project Directory Structure](#3-project-directory-structure)
4. [Backend Architecture](#4-backend-architecture)
5. [Database Schema](#5-database-schema)
6. [Pydantic Schemas (API Contracts)](#6-pydantic-schemas-api-contracts)
7. [API Endpoint Design](#7-api-endpoint-design)
8. [Authentication Design](#8-authentication-design)
9. [Storage Abstraction Layer](#9-storage-abstraction-layer)
10. [Image Processing Pipeline](#10-image-processing-pipeline)
11. [Frontend Architecture](#11-frontend-architecture)
12. [Docker & Deployment](#12-docker--deployment)
13. [Implementation Roadmap](#13-implementation-roadmap)

---

## 1. System Overview

### Architecture Diagram

```
                          ┌─────────────────────────────┐
                          │          Browser             │
                          │  ┌──────────┐ ┌──────────┐  │
                          │  │  Admin   │ │ Gallery  │  │
                          │  │  /admin  │ │ /g/<tok> │  │
                          │  └────┬─────┘ └────┬─────┘  │
                          └───────┼─────────────┼────────┘
                                  │             │
                          ┌───────▼─────────────▼────────┐
                          │         nginx :8765           │
                          │  /api/*  →  app:8000          │
                          │  /*      →  frontend:3000     │
                          └──────────┬──────────┬─────────┘
                                     │          │
                    ┌────────────────▼┐  ┌──────▼───────────────┐
                    │  FastAPI :8000  │  │  Next.js :3000        │
                    │  ─────────────  │  │  (standalone mode)    │
                    │  routers/       │  │  /app/(admin)/        │
                    │  services/      │  │  /app/g/[share_token]/│
                    │  repositories/  │  └───────────────────────┘
                    │  models/        │
                    │  schemas/       │
                    │  storage/       │
                    │  auth/          │
                    │  tasks/         │
                    └────────┬────────┘
                             │
               ┌─────────────┼──────────────┐
               │             │              │
         ┌─────▼────┐  ┌─────▼──────┐  ┌───▼────────────┐
         │  SQLite  │  │ /data/     │  │  BackgroundTask │
         │  via     │  │ uploads/   │  │  (Pillow image  │
         │ SQLAlch. │  │ {gal_id}/  │  │   processing)  │
         └──────────┘  │ original/  │  └────────────────┘
                       │ thumb/     │
                       │ medium/    │
                       └────────────┘
```

### Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Frontend serving | Next.js standalone (Node.js process) | Enables clean `/g/{token}` URL routing without static-export tricks |
| API prefix | All backend routes under `/api/` | Clean nginx split: `/api/*` → FastAPI, `/*` → Next.js |
| Auth storage | httpOnly cookie (JWT) | Prevents XSS token theft; works seamlessly with Next.js server components |
| File serving | nginx directly serves `/data/uploads` | Offloads static file I/O from Python; nginx handles byte-range, caching |
| Soft delete | `deleted_at` on Gallery + Image | Matches spec; nothing truly deleted |
| PKs | UUIDv4, never exposed as integers | Matches spec; share_token is a separate UUID field |

---

## 2. Technology Stack

### Backend
| Component | Choice | Version |
|---|---|---|
| Runtime | Python | 3.12 |
| Framework | FastAPI | 0.115.x |
| ORM | SQLAlchemy | 2.x (async-compatible, sync used) |
| Migrations | Alembic | latest |
| Validation | Pydantic v2 | 2.x |
| Auth | python-jose (JWT) + passlib (bcrypt) | latest |
| Image processing | Pillow | 11.x |
| ASGI server | uvicorn | latest |
| DB | SQLite | (via aiosqlite for async, or sync) |

### Frontend
| Component | Choice | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.x |
| Runtime | Node.js | 20 LTS |
| Language | TypeScript (strict) | 5.x |
| Styling | Tailwind CSS | 4.x |
| UI Components | shadcn/ui | latest |
| Server state | TanStack Query (React Query) | 5.x |
| Client state | Zustand | 4.x |
| HTTP client | ky (or native fetch) | — |
| Icons | lucide-react | latest |

### Infrastructure
| Component | Choice |
|---|---|
| Container runtime | Docker + Docker Compose |
| Reverse proxy | nginx:alpine |
| Database file | `/data/contactsheet.db` |
| Upload storage | `/data/uploads/` |
| Config | Environment variables + `.env` |

---

## 3. Project Directory Structure

```
contactsheet/
├── docker-compose.yml
├── Dockerfile                    # Multi-stage: frontend build + backend
├── .env.example
├── nginx.conf
├── README.md
│
├── backend/
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/
│   │       └── 0001_initial.py
│   └── app/
│       ├── main.py               # FastAPI app factory, middleware, router registration
│       ├── config.py             # Settings via pydantic-settings
│       ├── database.py           # SQLAlchemy engine, SessionLocal, get_db dependency
│       │
│       ├── models/               # SQLAlchemy ORM models (DB layer)
│       │   ├── __init__.py
│       │   ├── gallery.py
│       │   └── image.py
│       │
│       ├── schemas/              # Pydantic models (API contracts)
│       │   ├── __init__.py
│       │   ├── gallery.py
│       │   ├── image.py
│       │   └── auth.py
│       │
│       ├── repositories/         # Data access — raw DB queries, no business logic
│       │   ├── __init__.py
│       │   ├── gallery_repo.py
│       │   └── image_repo.py
│       │
│       ├── services/             # Business logic — calls repos + storage + tasks
│       │   ├── __init__.py
│       │   ├── gallery_service.py
│       │   ├── image_service.py
│       │   └── auth_service.py
│       │
│       ├── routers/              # Route handlers — thin layer, calls services only
│       │   ├── __init__.py
│       │   ├── auth.py           # POST /api/auth/login, GET /api/auth/me
│       │   ├── galleries.py      # Admin gallery CRUD
│       │   ├── images.py         # Admin image management
│       │   └── public.py         # Public /api/public/* endpoints
│       │
│       ├── auth/
│       │   ├── __init__.py
│       │   ├── jwt.py            # create_token, verify_token
│       │   ├── dependencies.py   # get_current_admin, get_gallery_access
│       │   └── password.py       # bcrypt hash/verify
│       │
│       ├── storage/
│       │   ├── __init__.py
│       │   ├── base.py           # StorageProvider ABC
│       │   └── local.py          # LocalStorage implementation
│       │
│       └── tasks/
│           ├── __init__.py
│           └── image_processing.py  # process_image() BackgroundTask
│
└── frontend/
    ├── package.json
    ├── tsconfig.json
    ├── next.config.ts
    ├── tailwind.config.ts
    ├── components.json           # shadcn config
    │
    ├── app/
    │   ├── layout.tsx            # Root layout (font, global CSS)
    │   ├── page.tsx              # Redirect → /admin
    │   │
    │   ├── (admin)/              # Route group — admin shell layout
    │   │   ├── layout.tsx        # Admin shell: sidebar + auth guard
    │   │   ├── login/
    │   │   │   └── page.tsx
    │   │   └── galleries/
    │   │       ├── page.tsx      # Gallery list (dashboard)
    │   │       └── [id]/
    │   │           └── page.tsx  # Gallery detail: images + upload zone
    │   │
    │   └── g/
    │       └── [share_token]/
    │           └── page.tsx      # Public gallery view (password gate or grid)
    │
    ├── components/
    │   ├── ui/                   # shadcn generated components
    │   ├── admin/
    │   │   ├── GalleryTree.tsx   # Sidebar tree with 2-level hierarchy
    │   │   ├── GalleryForm.tsx   # Create/edit gallery modal
    │   │   ├── UploadZone.tsx    # Drag & drop upload component
    │   │   └── ImageGrid.tsx     # Admin image management grid
    │   └── gallery/
    │       ├── GalleryView.tsx   # Public gallery shell
    │       ├── PhotoGrid.tsx     # Grid / masonry layout
    │       ├── Lightbox.tsx      # Full-res viewer + EXIF + prev/next
    │       ├── PasswordGate.tsx  # Password prompt component
    │       └── Slideshow.tsx     # Auto-advance player
    │
    ├── lib/
    │   ├── api.ts                # Typed API client (fetch wrappers)
    │   ├── auth.ts               # Token storage + auth state helpers
    │   └── types.ts              # Shared TypeScript types (mirrors backend schemas)
    │
    └── store/
        ├── lightbox.ts           # Zustand: lightbox open/index state
        └── slideshow.ts          # Zustand: slideshow play state
```

---

## 4. Backend Architecture

### Layer Responsibilities

```
Request → Router → Service → Repository → DB
                          ↘ Storage → Filesystem
                          ↘ Task → BackgroundTask
```

| Layer | File pattern | Allowed dependencies | Forbidden |
|---|---|---|---|
| **Router** | `routers/*.py` | Service, Auth deps, Schemas | Repo, Model, Storage direct |
| **Service** | `services/*.py` | Repository, Storage, Auth utils, Models | FastAPI Request/Response |
| **Repository** | `repositories/*.py` | SQLAlchemy Session, ORM Models | Business logic, Storage |
| **Model** | `models/*.py` | SQLAlchemy Base | Nothing |
| **Schema** | `schemas/*.py` | Pydantic BaseModel | Nothing |
| **Storage** | `storage/*.py` | Filesystem / cloud SDK | DB, Services |
| **Task** | `tasks/*.py` | Storage, Pillow, Repo (via db session) | Routers |

### Config (`app/config.py`)

Loaded from environment via `pydantic-settings`:

```
SECRET_KEY         str     — required, used for JWT signing
ADMIN_USERNAME     str     — default "admin"
ADMIN_PASSWORD     str     — required, bcrypt-hashed at startup check
DB_URL             str     — default "sqlite:////data/contactsheet.db"
UPLOAD_DIR         str     — default "/data/uploads"
ACCESS_TOKEN_TTL   int     — JWT lifetime in seconds, default 86400 (24h)
GALLERY_TOKEN_TTL  int     — gallery access token lifetime, default 43200 (12h)
THUMB_SIZE         int     — default 300
MEDIUM_SIZE        int     — default 1920
```

---

## 5. Database Schema

### SQLite tables (managed by Alembic)

#### `galleries`

```sql
CREATE TABLE galleries (
    id               TEXT        PRIMARY KEY,           -- UUIDv4 string
    parent_id        TEXT        REFERENCES galleries(id) ON DELETE SET NULL,
    name             TEXT        NOT NULL,
    description      TEXT        NOT NULL DEFAULT '',
    password_hash    TEXT,                              -- bcrypt, nullable
    share_token      TEXT        NOT NULL UNIQUE,       -- UUIDv4, auto-generated
    mode             TEXT        NOT NULL DEFAULT 'presentation'
                                 CHECK(mode IN ('presentation', 'collaboration')),
    layout           TEXT        NOT NULL DEFAULT 'grid'
                                 CHECK(layout IN ('grid', 'masonry', 'list')),
    sort_order       INTEGER     NOT NULL DEFAULT 0,
    tags             TEXT        NOT NULL DEFAULT '[]', -- JSON array
    watermark_settings TEXT,                           -- JSON, nullable
    expires_at       TEXT,                             -- ISO 8601 datetime, nullable
    downloads_enabled INTEGER    NOT NULL DEFAULT 1,   -- boolean
    deleted_at       TEXT,                             -- ISO 8601 datetime, nullable
    created_at       TEXT        NOT NULL,             -- ISO 8601
    updated_at       TEXT        NOT NULL              -- ISO 8601
);

CREATE INDEX ix_galleries_parent_id   ON galleries(parent_id);
CREATE INDEX ix_galleries_share_token ON galleries(share_token);
CREATE INDEX ix_galleries_deleted_at  ON galleries(deleted_at);
```

**Constraints:**
- `parent_id` may only point to a gallery with `parent_id IS NULL` (enforced in service layer — max 2 levels)
- `share_token` is generated server-side on creation, never user-supplied

#### `images`

```sql
CREATE TABLE images (
    id                TEXT    PRIMARY KEY,              -- UUIDv4 string
    gallery_id        TEXT    NOT NULL REFERENCES galleries(id),
    original_filename TEXT    NOT NULL,                 -- original upload name
    stored_filename   TEXT    NOT NULL,                 -- UUID-based, e.g. "a1b2c3.jpg"
    width             INTEGER,                          -- set after processing
    height            INTEGER,
    file_size         INTEGER NOT NULL,                 -- bytes
    mime_type         TEXT    NOT NULL,
    exif_data         TEXT,                             -- JSON, nullable
    sort_order        INTEGER NOT NULL DEFAULT 0,
    color_flag        TEXT    NOT NULL DEFAULT 'none'
                              CHECK(color_flag IN ('none', 'green', 'red', 'yellow', 'blue')),
    likes             INTEGER NOT NULL DEFAULT 0,
    tags              TEXT    NOT NULL DEFAULT '[]',    -- JSON array
    deleted_at        TEXT,                             -- ISO 8601 datetime, nullable
    created_at        TEXT    NOT NULL                  -- ISO 8601
);

CREATE INDEX ix_images_gallery_id ON images(gallery_id);
CREATE INDEX ix_images_deleted_at ON images(deleted_at);
CREATE INDEX ix_images_sort_order ON images(gallery_id, sort_order);
```

**Constraints:**
- `gallery_id` must reference a non-deleted gallery (enforced in service layer)
- `stored_filename` is always UUID-generated server-side; never trusts original filename for storage path

### Soft Delete Behavior

All queries in repositories MUST append `WHERE deleted_at IS NULL` unless explicitly querying deleted items. This is enforced by the repository layer — services never write raw queries.

### Notes on SQLite Types

- UUIDs stored as `TEXT` (SQLite has no native UUID type)
- Datetimes stored as ISO 8601 `TEXT` (SQLAlchemy `DateTime` with `timezone=False`)
- Booleans stored as `INTEGER` 0/1 (SQLAlchemy `Boolean`)
- JSON fields stored as `TEXT` (SQLAlchemy `JSON` type with SQLite fallback)

---

## 6. Pydantic Schemas (API Contracts)

### Gallery Schemas

```
GalleryCreate
  name:              str (required)
  description:       str = ""
  parent_id:         UUID | None = None
  password:          str | None = None   ← plaintext, hashed in service
  layout:            "grid" | "masonry" | "list" = "grid"
  sort_order:        int = 0
  downloads_enabled: bool = True

GalleryUpdate                           ← all fields optional (PATCH semantics)
  name:              str | None
  description:       str | None
  password:          str | None          ← None means "don't change", "" means "remove password"
  layout:            "grid" | "masonry" | "list" | None
  sort_order:        int | None
  downloads_enabled: bool | None

GalleryResponse                         ← returned to admin
  id:                UUID
  parent_id:         UUID | None
  name:              str
  description:       str
  has_password:      bool               ← never expose hash
  share_token:       str
  share_url:         str                ← computed: /g/{share_token}
  mode:              str
  layout:            str
  sort_order:        int
  downloads_enabled: bool
  expires_at:        datetime | None
  image_count:       int                ← computed, non-deleted images
  cover_image_url:   str | None         ← thumb URL of first image
  created_at:        datetime
  updated_at:        datetime
  children:          list[GalleryResponse] = []   ← nested for tree endpoint

GalleryPublicResponse                   ← returned to unauthenticated clients
  id:                UUID               ← needed for image list call
  name:              str
  description:       str
  layout:            str
  downloads_enabled: bool
  expires_at:        datetime | None
  image_count:       int
  cover_image_url:   str | None
  ← NO: share_token, password_hash, mode, admin fields
```

### Image Schemas

```
ImageResponse
  id:                UUID
  gallery_id:        UUID
  original_filename: str
  width:             int | None
  height:            int | None
  file_size:         int
  mime_type:         str
  exif_data:         dict | None
  sort_order:        int
  color_flag:        str
  likes:             int
  thumb_url:         str               ← computed
  medium_url:        str               ← computed
  original_url:      str               ← computed
  created_at:        datetime

ImageUpdate                            ← PATCH, all optional
  sort_order:        int | None
  color_flag:        "none"|"green"|"red"|"yellow"|"blue" | None
```

### Auth Schemas

```
LoginRequest
  username:  str
  password:  str

LoginResponse
  access_token: str
  token_type:   str = "bearer"

GalleryAuthRequest
  password:  str

GalleryAuthResponse
  access_token: str                    ← short-lived JWT for this gallery
  token_type:   str = "bearer"
```

### Upload Response

```
UploadResponse
  id:                UUID
  original_filename: str
  file_size:         int
  mime_type:         str
  processing_status: "pending" | "done" | "error"
  thumb_url:         str | None        ← null until processing completes
  medium_url:        str | None
```

---

## 7. API Endpoint Design

### Base URL: `/api`

All admin endpoints require `Authorization: Bearer <jwt>` header (or `access_token` httpOnly cookie).

#### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | None | Admin login, returns JWT |
| `POST` | `/api/auth/logout` | Admin | Clears cookie |
| `GET` | `/api/auth/me` | Admin | Validate token, return `{username}` |

**POST /api/auth/login** request:
```json
{ "username": "admin", "password": "secret" }
```
Response: `LoginResponse` + sets httpOnly `access_token` cookie.

---

#### Galleries (Admin)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/galleries` | Admin | Full tree (top-level + children nested) |
| `POST` | `/api/galleries` | Admin | Create gallery |
| `GET` | `/api/galleries/{id}` | Admin | Single gallery detail |
| `PATCH` | `/api/galleries/{id}` | Admin | Update gallery fields |
| `DELETE` | `/api/galleries/{id}` | Admin | Soft delete gallery |
| `POST` | `/api/galleries/{id}/reorder` | Admin | Reorder images in gallery |
| `GET` | `/api/galleries/{id}/images` | Admin | List images (non-deleted) |

**GET /api/galleries** response:
```json
[
  {
    "id": "...", "name": "Portraits 2025", "image_count": 42,
    "share_url": "/g/abc123", "layout": "grid",
    "children": [
      { "id": "...", "name": "Headshots", "image_count": 18, "children": [] }
    ]
  }
]
```

**POST /api/galleries/{id}/reorder** request:
```json
{ "image_ids": ["uuid1", "uuid2", "uuid3"] }
```
Sets `sort_order` = array index for each image id.

---

#### Images (Admin)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/galleries/{id}/images` | Admin | Upload image(s) — `multipart/form-data` |
| `PATCH` | `/api/images/{id}` | Admin | Update sort_order or color_flag |
| `DELETE` | `/api/images/{id}` | Admin | Soft delete image |

**POST /api/galleries/{id}/images** — multipart, field name `files`, accepts multiple.

Response: `list[UploadResponse]` — one entry per uploaded file. Processing is async (BackgroundTask), so `thumb_url`/`medium_url` may be null immediately.

---

#### Public Gallery API

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/public/g/{share_token}` | None / Gallery token | Resolve gallery by share token |
| `POST` | `/api/public/g/{share_token}/auth` | None | Submit gallery password, get gallery JWT |
| `GET` | `/api/public/g/{share_token}/images` | Gallery token (if needed) | List images |

**GET /api/public/g/{share_token}** logic:
- If gallery has no password → return `GalleryPublicResponse` immediately
- If gallery has password:
  - No token in request → return `{ "requires_password": true }` (HTTP 200, not 401 — avoids browser auth dialog)
  - Valid gallery JWT in header → return `GalleryPublicResponse`
  - Invalid/expired token → return `{ "requires_password": true }`

**POST /api/public/g/{share_token}/auth** request:
```json
{ "password": "client_password" }
```
Response: `GalleryAuthResponse` — short-lived JWT containing `gallery_id` claim.

**GET /api/public/g/{share_token}/images**:
- Returns `list[ImageResponse]` ordered by `sort_order`
- If gallery has password: requires gallery JWT
- `original_url` only included if `downloads_enabled = true`

---

#### File Serving (nginx, not FastAPI routes)

```
GET /uploads/{gallery_id}/thumb/{filename}    → /data/uploads/{gallery_id}/thumb/{filename}
GET /uploads/{gallery_id}/medium/{filename}   → /data/uploads/{gallery_id}/medium/{filename}
GET /uploads/{gallery_id}/original/{filename} → /data/uploads/{gallery_id}/original/{filename}
```

These are served directly by nginx with `alias` directive. FastAPI is NOT in the request path for file serving.

---

## 8. Authentication Design

### Admin Auth (JWT)

**Token claims:**
```json
{
  "sub": "admin",
  "iat": 1234567890,
  "exp": 1234654290,
  "type": "admin"
}
```

**Algorithm:** HS256, signed with `SECRET_KEY`

**Storage:** httpOnly, SameSite=Strict cookie named `access_token`. Also accepted via `Authorization: Bearer <token>` header for programmatic API access.

**Validation dependency** (`get_current_admin`):
1. Extract token from cookie or Authorization header
2. Verify signature + expiry
3. Assert `type == "admin"`
4. Return admin context

**Single admin user:** defined by `ADMIN_USERNAME` + `ADMIN_PASSWORD` env vars. No user table. `ADMIN_PASSWORD` is a plaintext env var; bcrypt comparison happens at login time.

---

### Gallery Share Auth

**Share URL:** `/g/{share_token}` — the `share_token` is a UUIDv4 stored on the Gallery record, generated at gallery creation.

**No-password galleries:** `share_token` alone grants read access. No JWT needed.

**Password-protected galleries:**

```
Client visits /g/{share_token}
    ↓
Frontend calls GET /api/public/g/{share_token}
    ↓
Backend returns { "requires_password": true }
    ↓
Frontend shows PasswordGate component
    ↓
Client submits password
    ↓
Frontend calls POST /api/public/g/{share_token}/auth
    ↓
Backend bcrypt-verifies password → issues gallery JWT
    ↓
Frontend stores JWT in sessionStorage (key: "gallery_token_{share_token}")
    ↓
Subsequent image list calls include: Authorization: Bearer <gallery_jwt>
```

**Gallery JWT claims:**
```json
{
  "sub": "gallery_access",
  "gallery_id": "uuid-of-gallery",
  "iat": 1234567890,
  "exp": 1234611090,   ← 12h TTL
  "type": "gallery"
}
```

**Validation dependency** (`get_gallery_access`):
1. Extract from Authorization header
2. Verify signature + expiry
3. Assert `type == "gallery"`
4. Assert `gallery_id` matches the requested gallery's `share_token` lookup
5. Return `gallery_id`

---

## 9. Storage Abstraction Layer

### Abstract Base Class (`storage/base.py`)

```
StorageProvider (ABC)
  ├── save(relative_path: str, data: bytes | BinaryIO) → str
  │     Returns the stored relative path
  ├── get_url(relative_path: str) → str
  │     Returns publicly accessible URL for the file
  ├── delete(relative_path: str) → None
  ├── exists(relative_path: str) → bool
  └── make_dirs(relative_path: str) → None
        Ensures parent directories exist
```

### LocalStorage (`storage/local.py`)

```
__init__(base_dir: str, base_url: str)
  base_dir  = "/data/uploads"
  base_url  = "/uploads"        ← nginx serves this prefix

save(relative_path, data)
  → writes to {base_dir}/{relative_path}
  → creates parent dirs if needed

get_url(relative_path)
  → returns "{base_url}/{relative_path}"
  → e.g. "/uploads/gallery-uuid/thumb/image-uuid.jpg"
```

### File Path Conventions

```
{gallery_id}/original/{stored_filename}    ← original upload, never modified
{gallery_id}/thumb/{stored_filename}       ← 300px JPEG
{gallery_id}/medium/{stored_filename}      ← 1920px JPEG
```

`stored_filename` = `{uuid4}.{ext}` where ext is normalized (jpg/png/webp).
Original filename is only stored in the DB (`original_filename` column), never used as a path component.

---

## 10. Image Processing Pipeline

### Upload Flow

```
POST /api/galleries/{id}/images (multipart, one or more files)
    │
    ├── Router: validate gallery exists (service call)
    ├── Router: validate each file MIME type (allowed list: image/jpeg, image/png, image/webp)
    ├── Router: reject files > MAX_UPLOAD_SIZE (env var, default 200MB)
    │
    └── For each file:
        ├── Service: generate stored_filename = f"{uuid4()}{ext}"
        ├── Service: storage.save(f"{gallery_id}/original/{stored_filename}", file_data)
        ├── Service: create Image DB record (width/height/exif = null, processing pending)
        ├── Service: return ImageResponse with processing_status="pending"
        └── BackgroundTask: process_image(image_id, gallery_id, stored_filename)
```

### BackgroundTask: `process_image()`

```
1. Open original with Pillow
2. Extract EXIF: orientation, camera make/model, focal length, ISO, aperture,
                 shutter speed, GPS coordinates (if present)
   → Normalize to dict, strip binary blobs
3. Auto-rotate image based on EXIF orientation tag
4. Record width, height (after rotation)

5. Generate THUMB:
   - Copy → convert("RGB") if needed (handles PNG RGBA, palette mode)
   - thumbnail((300, 300), Image.LANCZOS)   ← preserves aspect ratio
   - save as JPEG quality=85 → storage.save(f"{gallery_id}/thumb/{stored_filename}")

6. Generate MEDIUM:
   - Copy → convert("RGB")
   - If max dimension > 1920px: thumbnail((1920, 1920), Image.LANCZOS)
   - Else: use original (no upscaling)
   - save as JPEG quality=88 → storage.save(f"{gallery_id}/medium/{stored_filename}")

7. Update Image DB record:
   - width, height = dimensions
   - exif_data = json.dumps(exif_dict)
   - (implicitly: thumb/medium URLs derivable from stored_filename)

Error handling:
   - If Pillow fails: update image record with processing_status="error"
   - Log error, do NOT raise (background task must not crash the worker)
```

### Supported MIME Types (Phase 1)

| MIME | Extension | Notes |
|---|---|---|
| `image/jpeg` | `.jpg` / `.jpeg` | Primary format |
| `image/png` | `.png` | Converted to RGB for JPEG derivatives |
| `image/webp` | `.webp` | Converted to RGB for JPEG derivatives |

TIFF, HEIC, AVIF are deferred to Phase 3.

---

## 11. Frontend Architecture

### Route Structure

```
/                          → redirect to /admin/galleries (client-side)
/login                     → admin login page (no shell)
/admin/galleries           → gallery list + tree sidebar
/admin/galleries/{id}      → gallery detail: upload zone + image grid
/g/{share_token}           → public gallery (password gate or photo grid)
```

### Auth Guard Pattern

The `(admin)` route group layout (`app/(admin)/layout.tsx`) checks for a valid JWT cookie on mount. If missing or expired: redirect to `/login`. This is a client-side check (localStorage flag + API ping to `/api/auth/me`). No server-side guard needed in Next.js standalone since the backend enforces auth on all API calls.

### State Management

**TanStack Query** — server state:
- `useGalleries()` — `GET /api/galleries`
- `useGallery(id)` — `GET /api/galleries/{id}`
- `useGalleryImages(id)` — `GET /api/galleries/{id}/images`
- `usePublicGallery(token)` — `GET /api/public/g/{token}`
- `usePublicImages(token)` — `GET /api/public/g/{token}/images`
- Mutations: `useCreateGallery`, `useUpdateGallery`, `useDeleteGallery`, `useUploadImages`, `useDeleteImage`

**Zustand stores** — UI state:
- `useLightboxStore`: `{ isOpen, currentIndex, images[], open(index), close(), next(), prev() }`
- `useSlideshowStore`: `{ isPlaying, intervalId, start(), stop() }`

### Component Breakdown

#### Admin Components

**`GalleryTree`** — sidebar, 2-level collapsible tree
- Props: `galleries: GalleryResponse[]` (nested)
- Emits: select gallery, create child, drag-to-reorder (sort_order)

**`GalleryForm`** — modal for create/edit
- Fields: name, description, password (toggle show/hide), layout radio, downloads toggle

**`UploadZone`** — drag & drop + click-to-browse
- Uses native File API + fetch with `FormData`
- Shows per-file progress (XHR with `onprogress` or streaming upload)
- Accepted types: `.jpg,.jpeg,.png,.webp`
- Displays thumbnail previews after upload (from `thumb_url` once processing done — poll or re-fetch)

**`ImageGrid`** (admin) — management view
- Shows thumb + filename + delete button
- Drag to reorder → fires `POST /api/galleries/{id}/reorder`

#### Gallery (Public) Components

**`PasswordGate`**
- Simple password input form
- On submit: call `/api/public/g/{token}/auth`, store gallery JWT in sessionStorage
- On success: trigger re-fetch of gallery data

**`PhotoGrid`**
- Renders images in `grid` or `masonry` layout (CSS Grid / CSS columns)
- Each image: `<img src={thumb_url}>` + click handler → opens lightbox
- Tailwind dark mode styling (dark background, white text)
- Responsive: 2 cols mobile, 3 cols tablet, 4-5 cols desktop

**`Lightbox`**
- Full-viewport overlay (dark)
- Shows `medium_url` image (load `original_url` on explicit user request)
- Prev/Next buttons + keyboard arrow keys
- EXIF panel: camera, focal length, ISO, shutter, aperture
- Download button (`<a href={original_url} download>`) — only if `downloads_enabled`
- Close: Escape key or X button
- Swipe gestures (touch events) for mobile prev/next

**`Slideshow`**
- Play button in lightbox toolbar activates auto-advance
- 5 second interval (configurable via store)
- Pause on user interaction (click prev/next)
- Visual progress bar at bottom of lightbox

### API Client (`lib/api.ts`)

Typed wrapper around `fetch`:
```typescript
type ApiClient = {
  galleries: {
    list(): Promise<GalleryResponse[]>
    get(id: string): Promise<GalleryResponse>
    create(data: GalleryCreate): Promise<GalleryResponse>
    update(id: string, data: GalleryUpdate): Promise<GalleryResponse>
    delete(id: string): Promise<void>
    images(id: string): Promise<ImageResponse[]>
    reorder(id: string, imageIds: string[]): Promise<void>
  }
  images: {
    upload(galleryId: string, files: File[]): Promise<UploadResponse[]>
    update(id: string, data: ImageUpdate): Promise<ImageResponse>
    delete(id: string): Promise<void>
  }
  public: {
    getGallery(token: string, galleryJwt?: string): Promise<GalleryPublicResponse | { requires_password: true }>
    auth(token: string, password: string): Promise<GalleryAuthResponse>
    images(token: string, galleryJwt?: string): Promise<ImageResponse[]>
  }
  auth: {
    login(username: string, password: string): Promise<LoginResponse>
    logout(): Promise<void>
    me(): Promise<{ username: string }>
  }
}
```

---

## 12. Docker & Deployment

### Dockerfile (multi-stage)

```
Stage 1 — frontend-builder (node:20-alpine)
  WORKDIR /frontend
  COPY frontend/package*.json .
  RUN npm ci
  COPY frontend/ .
  RUN npm run build              ← Next.js standalone output
  Output: .next/standalone/ + .next/static/ + public/

Stage 2 — backend (python:3.12-slim)
  WORKDIR /app
  COPY backend/requirements.txt .
  RUN pip install --no-cache-dir -r requirements.txt
  COPY backend/ .
  EXPOSE 8000
  CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000",
       "--workers", "1", "--forwarded-allow-ips", "*"]

Stage 3 — frontend-runner (node:20-alpine)
  COPY --from=frontend-builder /frontend/.next/standalone/ ./
  COPY --from=frontend-builder /frontend/.next/static/ ./.next/static/
  COPY --from=frontend-builder /frontend/public/ ./public/
  EXPOSE 3000
  ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
  CMD ["node", "server.js"]
```

Note: Stage 2 and 3 are separate build targets in the same Dockerfile, referenced in docker-compose via `target:`.

### docker-compose.yml

```yaml
services:
  backend:
    build:
      context: .
      target: backend
    expose: ["8000"]
    volumes:
      - ./data:/data
    environment:
      SECRET_KEY: ${SECRET_KEY:?SECRET_KEY required}
      ADMIN_USERNAME: ${ADMIN_USERNAME:-admin}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:?ADMIN_PASSWORD required}
      DB_URL: sqlite:////data/contactsheet.db
      UPLOAD_DIR: /data/uploads
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
      interval: 30s

  frontend:
    build:
      context: .
      target: frontend-runner
    expose: ["3000"]
    environment:
      NEXT_PUBLIC_API_BASE: ""   ← empty = same origin (proxied by nginx)
    depends_on: [backend]
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "${PORT:-8765}:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./data/uploads:/data/uploads:ro
    depends_on: [backend, frontend]
    restart: unless-stopped
```

### nginx.conf

```nginx
server {
    listen 80;
    client_max_body_size 250M;

    # Serve uploaded files directly — no Python in the path
    location /uploads/ {
        alias /data/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # API → FastAPI
    location /api/ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;   # allow time for upload processing
    }

    # Everything else → Next.js
    location / {
        proxy_pass http://frontend:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
```

### .env.example

```bash
# Generate with: openssl rand -hex 32
SECRET_KEY=

# Admin credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=

# Port exposed on host
PORT=8765
```

### Data Volumes

```
./data/
├── contactsheet.db              ← SQLite database
└── uploads/
    └── {gallery_id}/
        ├── original/
        │   └── {stored_filename}
        ├── thumb/
        │   └── {stored_filename}
        └── medium/
            └── {stored_filename}
```

---

## 13. Implementation Roadmap

Tasks are ordered by dependency. Each task should be committed separately with tests where applicable.

### Sprint 1 — Foundation (Backend)

| # | Task | Output |
|---|---|---|
| 1.1 | Scaffold backend project: `pyproject.toml` / `requirements.txt`, `app/` structure, `config.py` with pydantic-settings | Installable Python package |
| 1.2 | Database: `models/gallery.py`, `models/image.py` (SQLAlchemy ORM), `database.py` (engine + session factory) | Importable models |
| 1.3 | Alembic setup + initial migration `0001_initial` | `alembic upgrade head` creates tables |
| 1.4 | Storage layer: `storage/base.py` (ABC) + `storage/local.py` (LocalStorage) | Unit-testable, no FastAPI dependency |
| 1.5 | Auth utilities: `auth/jwt.py`, `auth/password.py`, `auth/dependencies.py` | Importable, testable in isolation |
| 1.6 | Pydantic schemas: all `schemas/*.py` files | Import check passes |
| 1.7 | `app/main.py`: FastAPI app factory, CORS middleware, health endpoint `GET /api/health` | `uvicorn app.main:app` starts |

### Sprint 2 — Gallery & Auth API

| # | Task | Output |
|---|---|---|
| 2.1 | `repositories/gallery_repo.py`: list_tree, get_by_id, get_by_share_token, create, update, soft_delete | Repo functions, no routes yet |
| 2.2 | `services/gallery_service.py`: wraps repo, enforces 2-level limit, generates share_token, hashes password | Service functions |
| 2.3 | `routers/auth.py` + `services/auth_service.py`: login, logout, me | `POST /api/auth/login` works |
| 2.4 | `routers/galleries.py`: GET list (tree), POST create, GET detail, PATCH update, DELETE soft-delete | Gallery CRUD via API |
| 2.5 | `routers/public.py`: GET gallery by share_token (password logic), POST gallery auth, GET images | Public API works |

### Sprint 3 — Upload & Image Processing

| # | Task | Output |
|---|---|---|
| 3.1 | `repositories/image_repo.py`: list_by_gallery, get_by_id, create, update, soft_delete, reorder | Repo functions |
| 3.2 | `services/image_service.py`: orchestrates upload (storage + DB record) | Service |
| 3.3 | `tasks/image_processing.py`: `process_image()` BackgroundTask (Pillow: EXIF, auto-rotate, thumb, medium) | Background task |
| 3.4 | `routers/images.py`: POST upload (multipart + BackgroundTask), PATCH update, DELETE soft-delete, POST reorder | Upload API works |

### Sprint 4 — Frontend Foundation

| # | Task | Output |
|---|---|---|
| 4.1 | Scaffold Next.js 15 app: TypeScript strict, Tailwind 4, shadcn/ui init, `lib/api.ts`, `lib/types.ts` | `npm run dev` starts |
| 4.2 | Admin login page (`/login`): form, call `/api/auth/login`, store token, redirect | Login flow works |
| 4.3 | Admin shell layout: sidebar `GalleryTree`, auth guard (redirect to `/login` if no token) | Shell renders |
| 4.4 | Gallery list page `/admin/galleries`: fetch + render tree, create gallery modal (`GalleryForm`) | CRUD visually |
| 4.5 | Gallery detail page `/admin/galleries/{id}`: image grid, delete images, copy share link | Admin detail works |

### Sprint 5 — Upload UI

| # | Task | Output |
|---|---|---|
| 5.1 | `UploadZone` component: drag & drop, click-to-browse, file validation (type + size), FormData upload | Files upload to API |
| 5.2 | Upload progress: per-file XHR progress indicator | Visual progress |
| 5.3 | Post-upload image grid refresh: polling for `processing_status` or simple re-fetch after 2s | Thumbnails appear |

### Sprint 6 — Public Gallery View

| # | Task | Output |
|---|---|---|
| 6.1 | Public gallery page `/g/[share_token]`: fetch gallery, handle `requires_password` state | Route works |
| 6.2 | `PasswordGate` component: password form, JWT storage in sessionStorage, success state | Password gate works |
| 6.3 | `PhotoGrid` component: grid + masonry layout, responsive CSS Grid, dark theme | Gallery renders |
| 6.4 | `Lightbox` component: full-res overlay, prev/next (keyboard + click), EXIF panel, download button | Lightbox works |
| 6.5 | `Slideshow` component: play/pause, 5s interval, progress bar | Slideshow works |

### Sprint 7 — Docker & Polish

| # | Task | Output |
|---|---|---|
| 7.1 | Multi-stage `Dockerfile`: frontend-builder → backend + frontend-runner stages | `docker build .` succeeds |
| 7.2 | `docker-compose.yml`: backend + frontend + nginx services, volumes | `docker compose up -d` works |
| 7.3 | `nginx.conf`: `/uploads/` alias, `/api/` proxy, `/` proxy with upgrade headers | All routes reachable |
| 7.4 | `.env.example` + `README.md`: one-command deploy instructions, SECRET_KEY generation | Documented |
| 7.5 | End-to-end smoke test: create gallery, upload images, share URL, lightbox, slideshow | Feature complete |

---

## Open Questions (resolve before implementation)

1. **Upload progress UX**: Use `XMLHttpRequest` with `onprogress` events, or chunked upload via `fetch` with `ReadableStream`? XHR is simpler and widely supported.

2. **Next.js API_BASE in production**: `NEXT_PUBLIC_API_BASE` should be `""` (empty, same origin) so all `/api/*` calls go through nginx proxy. In development, it should be `http://localhost:8000`. Need to handle this in `lib/api.ts` without hardcoding.

3. **Alembic in Docker**: Run `alembic upgrade head` automatically on container startup (via CMD wrapper script) or require manual `docker compose exec backend alembic upgrade head`? Recommend: startup script that runs migrations then starts uvicorn.

4. **Gallery password: blank string = remove password?** The `GalleryUpdate` schema assumes `password: ""` removes the password. Confirm this UX is correct — or use explicit `remove_password: bool` flag.

5. **Image processing failure UX**: If Pillow fails (corrupt file), the image record exists in DB with `processing_status="error"`. Admin should see this clearly. Phase 1 can just show an error badge; no retry mechanism needed yet.
