// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Locale } from "@/i18n/locales";

export type LayoutType = "grid" | "masonry" | "list";
export type ModeType = "presentation" | "collaboration";

export type WatermarkMode = "image" | "text";
export type WatermarkSize = "small" | "medium" | "large";
export type WatermarkPosition =
  | "top-left" | "top-center" | "top-right"
  | "center-left" | "center" | "center-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export interface WatermarkSettings {
  enabled: boolean;
  mode: WatermarkMode;
  opacity: number;            // 0–100
  size: WatermarkSize;
  position: WatermarkPosition;
  filename: string | null;    // image mode
  text: string | null;        // text mode
  color: string;              // text mode, #rrggbb
}

export const DEFAULT_WATERMARK: WatermarkSettings = {
  enabled: false,
  mode: "image",
  opacity: 50,
  size: "medium",
  position: "bottom-right",
  filename: null,
  text: null,
  color: "#ffffff",
};

/** Client-facing names for the two gallery modes. Internal enum values are unchanged. */
export const MODE_LABELS: Record<ModeType, string> = {
  collaboration: "Review",
  presentation: "Showcase",
};
export type ColorFlag = "none" | "green" | "red" | "yellow" | "blue";
// Instance-wide rating style (app_settings.rating_mode). Never both at once.
export type RatingMode = "flags" | "stars";
// 0 = unrated, 1–5 = stars.
export type Rating = 0 | 1 | 2 | 3 | 4 | 5;
// "no_preview" = stored & downloadable but has no thumbnail (e.g. a PSB with no embedded preview).
export type ProcessingStatus = "pending" | "done" | "error" | "no_preview";
// Opener font key — one of the registry keys in lib/gallery-fonts.ts, or a legacy
// "sans"/"serif"/"mono" alias. Validated server-side (backend FontType literal).
export type FontType = string;
export type SizeType = "small" | "medium" | "large";
export type CornersType = "round" | "square";
export type BrightnessType = "bright" | "dark";
// Anchor of the title over the presentation hero image. "center" = legacy/default.
export type TitlePositionType =
  | "top-left" | "top-center" | "top-right"
  | "center-left" | "center" | "center-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

/** Per-gallery presentation + collaboration settings (Phase B). */
export interface GallerySettings {
  // Presentation
  opener_font: FontType;
  opener_font_size: SizeType;
  opener_title_position: TitlePositionType;
  preview_size: SizeType;
  preview_spacing: SizeType;
  preview_corners: CornersType;
  bg_brightness: BrightnessType;
  bg_dimmed_color: string | null;
  // Collaboration feature toggles
  color_flags_enabled: boolean;
  likes_enabled: boolean;
  comments_enabled: boolean;
  annotations_enabled: boolean;
  sets_enabled: boolean;
  client_upload_enabled: boolean;
  client_upload_moderation: boolean;
  show_filename: boolean;
  show_filename_lightbox: boolean;
  show_exif: boolean;
  show_iptc: boolean;
}

export interface GalleryResponse extends GallerySettings {
  id: string;
  parent_id: string | null;
  name: string;
  description: string;
  has_password: boolean;
  share_token: string;
  mode: ModeType;
  layout: LayoutType;
  sort_order: number;
  pinned: boolean;
  downloads_enabled: boolean;
  enable_team_voting: boolean;
  hide_parent_nav: boolean;
  notifications_enabled: boolean;
  watermark_settings?: string | null;  // JSON string of WatermarkSettings
  headline: string | null;
  header_image_url: string | null;
  expires_at: string | null;
  header_focus_x: number;
  header_focus_y: number;
  cover_image_id: string | null;
  cover_image_filename: string | null;
  image_count: number;
  comment_count: number;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
  children: GalleryResponse[];
}

export interface SubGalleryNavItem {
  name: string;
  share_token: string;
  image_count: number;
  cover_image_url: string | null;
}

export interface GalleryPublicResponse extends GallerySettings {
  id: string;
  name: string;
  description: string;
  mode: ModeType;
  layout: LayoutType;
  downloads_enabled: boolean;
  enable_team_voting: boolean;
  watermark_enabled: boolean;
  high_res_previews: boolean;
  lightbox_backdrop: LightboxBackdrop;
  rating_mode: RatingMode;
  default_sort: GallerySortKey;
  default_sort_dir: SortDir;
  headline: string | null;
  header_image_url: string | null;
  header_focus_x: number;
  header_focus_y: number;
  expires_at: string | null;
  image_count: number;
  cover_image_url: string | null;
  subgalleries: SubGalleryNavItem[];
  parent_name: string | null;
  parent_share_token: string | null;
  parent_mode: ModeType | null;
  parent_cover_image_url: string | null;
  ancestors: { name: string; share_token: string }[];
  accent_color: string | null;
  footer: FooterSettings | null;
  instance_name: string | null;
  logo_url: string | null;
}

/** Which collaboration interactions are exposed to clients (subset of GallerySettings). */
export interface CollabFeatures {
  /** Ratings enabled (per-gallery gate). The rendered UI is flags or stars per `ratingMode`. */
  colorFlags: boolean;
  /** Which rating UI to show when ratings are enabled (instance-wide setting). */
  ratingMode: RatingMode;
  likes: boolean;
  comments: boolean;
  /** Anchored comment pins. Requires `comments`. */
  annotations: boolean;
}

/** Presentation knobs passed to the public photo grid. */
export interface GridPresentation {
  previewSize: SizeType;
  previewSpacing: SizeType;
  previewCorners: CornersType;
  showFilename: boolean;
  bright: boolean;
  /** Instance-wide: allow srcset upgrades to the larger renditions. */
  highRes: boolean;
}

export interface Vote {
  id: string;
  image_id: string;
  gallery_id: string;
  reviewer_name: string;
  color_flag: ColorFlag;
  rating: Rating;
  updated_at: string;
}

export interface VoteSummary {
  reviewers: string[];
  images: Record<string, Record<string, string>>;
}

export interface GalleryCreate {
  name: string;
  description?: string;
  parent_id?: string | null;
  password?: string | null;
  mode?: ModeType;
  layout?: LayoutType;
  sort_order?: number;
  downloads_enabled?: boolean;
  headline?: string | null;
  expires_at?: string | null;
}

export interface GalleryUpdate extends Partial<GallerySettings> {
  name?: string;
  description?: string;
  password?: string | null;
  mode?: ModeType;
  layout?: LayoutType;
  sort_order?: number;
  pinned?: boolean;
  downloads_enabled?: boolean;
  enable_team_voting?: boolean;
  hide_parent_nav?: boolean;
  notifications_enabled?: boolean;
  headline?: string | null;
  expires_at?: string | null;
  header_focus_x?: number;
  header_focus_y?: number;
  watermark_settings?: string | null;  // JSON string of WatermarkSettings
  /** Cascade presentation/collaboration settings to all sub-galleries. */
  apply_to_subgalleries?: boolean;
}

// Default look & behaviour for newly created galleries (one preset per mode).
// Absent/undefined field = built-in default; a null preset = all built-in defaults.
export interface GalleryPreset {
  layout?: LayoutType;
  opener_font?: FontType;
  opener_font_size?: SizeType;
  opener_title_position?: TitlePositionType;
  preview_size?: SizeType;
  preview_spacing?: SizeType;
  preview_corners?: CornersType;
  bg_brightness?: BrightnessType;
  bg_dimmed_color?: string;
  downloads_enabled?: boolean;
  enable_team_voting?: boolean;
  color_flags_enabled?: boolean;
  likes_enabled?: boolean;
  comments_enabled?: boolean;
  annotations_enabled?: boolean;
  sets_enabled?: boolean;
  show_filename?: boolean;
  show_filename_lightbox?: boolean;
  show_exif?: boolean;
  show_iptc?: boolean;
}

// Admin-only override look for the in-gallery admin photo grid.
// Absent field = built-in default; a null override = all built-in defaults.
export interface AdminGridView {
  layout?: LayoutType;
  preview_size?: SizeType;
  preview_spacing?: SizeType;
  preview_corners?: CornersType;
}

export type AdminGridMode = "mirror" | "custom";
export type OverviewShape = "square" | "aspect";
export type OverviewSort = "created" | "name" | "photos";
export type SortDir = "asc" | "desc";
/** In-gallery photo sort keys (mirrors GalleryAdminSidebar's SortKey). */
export type GallerySortKey = "manual" | "filename" | "date" | "captured";

// Public gallery branding footer (global). Empty/absent fields are not rendered.
export interface FooterSettings {
  business_name?: string;
  website_url?: string;
  email?: string;
  phone?: string;
  instagram?: string;
  facebook?: string;
  x?: string;
  tiktok?: string;
  youtube?: string;
  linkedin?: string;
  /** Display order of the contact/social icon keys. */
  icon_order?: string[];
}

export type LightboxBackdrop = "dimmed" | "black" | "white" | "transparent";
export type BrandDisplay = "logo_name" | "logo_only" | "name_only";

export type NotificationEventKey = "comment" | "annotation" | "collection" | "flag" | "upload" | "download" | "view";

export interface NotificationEvents {
  comment: boolean;
  annotation: boolean;
  collection: boolean;
  flag: boolean;
  upload: boolean;
  download: boolean;
  view: boolean;
}

export type NotificationChannelType =
  | "custom"
  | "email"
  | "pushover"
  | "ntfy"
  | "discord"
  | "telegram"
  | "slack";

export interface NotificationChannel {
  id: string;
  name: string;
  type: NotificationChannelType;
  /** Raw Apprise URL — custom type only; masked (credentials hidden) on read (see has_url). */
  url: string;
  /** Structured per-service fields — preset types only; secrets masked on read (see secrets_set). */
  params: Record<string, string>;
  enabled: boolean;
  /** Read responses (custom): true when a real URL is stored behind the mask. */
  has_url?: boolean;
  /** Read responses (presets): which secret fields have a stored value behind the mask. */
  secrets_set?: Record<string, boolean>;
}

/** Per-event message text overrides; a blank field uses the built-in default. */
export type NotificationTemplateKey = "title" | NotificationEventKey;
export type NotificationTemplates = Record<NotificationTemplateKey, string>;

export interface NotificationSettings {
  enabled: boolean;
  events: NotificationEvents;
  flush_seconds: number;
  channels: NotificationChannel[];
  /** Append the public gallery link to each message (needs Public Base URL set). */
  include_link: boolean;
  templates: NotificationTemplates;
}

export interface AppSettings {
  version: string;
  instance_name: string;
  accent_color: string;
  accent_gradient: boolean;
  logo_filename: string | null;
  logo_url: string | null;
  admin_theme: "light" | "dark";
  admin_locale: Locale;
  lightbox_backdrop: LightboxBackdrop;
  brand_display: BrandDisplay;
  brand_font: string;
  brand_color: string | null;
  tagline: string | null;
  public_base_url: string | null;
  source_url: string | null;
  high_res_previews: boolean;
  rating_mode: RatingMode;
  preset_presentation: GalleryPreset | null;
  preset_collaboration: GalleryPreset | null;
  admin_grid_mode: AdminGridMode;
  admin_grid_view: AdminGridView | null;
  overview_size: SizeType;
  overview_shape: OverviewShape;
  overview_spacing: SizeType;
  overview_corners: CornersType;
  overview_sort: OverviewSort;
  overview_sort_dir: SortDir;
  gallery_sort: GallerySortKey;
  gallery_sort_dir: SortDir;
  footer_enabled: boolean;
  footer: FooterSettings | null;
  notifications: NotificationSettings | null;
  semantic_search: SemanticSearchSettings | null;
  activity_ip_logging: boolean;
  activity_ip_retention_days: number;
}

// Semantic content search config (global). Off by default; the ML sidecar only runs when enabled.
export interface SemanticSearchSettings {
  enabled: boolean;
  model: string;
  default_threshold: number;
  index_originals: boolean;
}

// A hit from instance-wide photo search/browse — an image plus the gallery it lives in (for the
// badge + deep-link from the overview).
export interface GlobalSearchResult extends ImageResponse {
  gallery_name: string;
  gallery_share_token: string;
}

// One page of the cross-gallery "All Photos" browser.
export interface PhotoPage {
  items: GlobalSearchResult[];
  total: number;
  offset: number;
  limit: number;
}

// Index progress + ML sidecar health, surfaced in the settings panel.
export interface SemanticSearchStatus {
  enabled: boolean;
  configured: boolean;
  model: string;
  default_threshold: number;
  sidecar: { status: string; model: string; ready: boolean } | null;
  indexed: number;
  pending: number;
  error: number;
  skipped: number;
  total: number;
}

export interface AppSettingsUpdate {
  instance_name?: string;
  accent_color?: string;
  accent_gradient?: boolean;
  admin_theme?: "light" | "dark";
  admin_locale?: Locale;
  lightbox_backdrop?: LightboxBackdrop;
  brand_display?: BrandDisplay;
  brand_font?: string;
  brand_color?: string;
  tagline?: string;
  public_base_url?: string;
  source_url?: string;
  high_res_previews?: boolean;
  rating_mode?: RatingMode;
  preset_presentation?: GalleryPreset | null;
  preset_collaboration?: GalleryPreset | null;
  admin_grid_mode?: AdminGridMode;
  admin_grid_view?: AdminGridView | null;
  overview_size?: SizeType;
  overview_shape?: OverviewShape;
  overview_spacing?: SizeType;
  overview_corners?: CornersType;
  overview_sort?: OverviewSort;
  overview_sort_dir?: SortDir;
  gallery_sort?: GallerySortKey;
  gallery_sort_dir?: SortDir;
  footer_enabled?: boolean;
  footer?: FooterSettings | null;
  notifications?: NotificationSettings | null;
  semantic_search?: SemanticSearchSettings | null;
  activity_ip_logging?: boolean;
  activity_ip_retention_days?: number;
}

export interface ImageResponse {
  id: string;
  gallery_id: string;
  original_filename: string;
  width: number | null;
  height: number | null;
  file_size: number;
  mime_type: string;
  exif_data: Record<string, unknown> | null;
  iptc_data: Record<string, string | string[]> | null;
  sort_order: number;
  color_flag: ColorFlag;
  rating: Rating;
  likes: number;
  comment_count: number;
  annotation_count: number;
  uploaded_by: string | null;
  moderation_status: "approved" | "pending";
  processing_status: ProcessingStatus;
  is_video: boolean;
  thumb_url: string | null;
  small_url: string | null;
  medium_url: string | null;
  original_url: string | null;
  video_url: string | null;
  video_poster_url: string | null;
  created_at: string;
}

export interface Collection {
  id: string;
  gallery_id: string;
  name: string;
  created_by: string | null;
  image_ids: string[];
  image_count: number;
  cover_url: string | null;
  created_at: string;
}

/** A normalized point on an image (fractions 0..1). */
export interface AnchorPoint {
  x: number;
  y: number;
}

/** Spatial anchor on an image → turns a comment into an annotation. Coords are fractions (0..1)
 *  of the image's intrinsic content box. A `freehand` mark carries a `points` path; legacy
 *  `pin`/`rect` carry x/y (+ w/h for rect). */
export interface Anchor {
  type: "pin" | "rect" | "freehand";
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  color?: string;
  /** Freehand stroke width in px (1–24). */
  width?: number;
  points?: AnchorPoint[];
}

export interface Comment {
  id: string;
  image_id: string;
  author_name: string;
  text: string;
  anchor: Anchor | null;
  created_at: string;
}

export interface CommentCreate {
  author_name: string;
  text: string;
  anchor?: Anchor | null;
}

export interface CommentUpdate {
  text: string;
}

export interface UploadResponse {
  id: string;
  original_filename: string;
  file_size: number;
  mime_type: string;
  processing_status: ProcessingStatus;
  is_video: boolean;
  thumb_url: string | null;
  medium_url: string | null;
}

export interface ImageUpdate {
  sort_order?: number;
  color_flag?: ColorFlag;
  rating?: Rating;
  original_filename?: string;
}

export interface Activity {
  id: string;
  gallery_id: string;
  image_id: string | null;
  action: string;
  author: string;
  meta: Record<string, unknown> | null;
  /** Client IP for public events — only present while IP logging is enabled; null otherwise. */
  ip: string | null;
  created_at: string;
}

export interface ActivityPage {
  items: Activity[];
  total: number;
  page: number;
  limit: number;
}

export type ZipFilterType = "all" | "flagged" | "green" | "red" | "yellow" | "blue";

export interface ZipJob {
  id: string;
  gallery_id: string;
  status: "pending" | "ready" | "error";
  filter_type: string;
  image_count: number | null;
  error_message: string | null;
  created_at: string;
  ready_at: string | null;
  download_url: string | null;
}

export interface BackupJob {
  id: string;
  status: "pending" | "running" | "ready" | "error";
  scope: "full" | "metadata";
  include_renditions: boolean;
  size_bytes: number | null;
  error_message: string | null;
  created_at: string;
  ready_at: string | null;
  download_url: string | null;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface GalleryRequiresPassword {
  requires_password: true;
}

export type PublicGalleryResult = GalleryPublicResponse | GalleryRequiresPassword;

export function requiresPassword(r: PublicGalleryResult): r is GalleryRequiresPassword {
  return "requires_password" in r && r.requires_password === true;
}
