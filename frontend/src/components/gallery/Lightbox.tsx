// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLightboxStore } from "@/store/lightbox";
import { useReviewerStore } from "@/store/reviewer";
import { CommentPanel } from "./CommentPanel";
import { AnnotationLayer } from "./AnnotationLayer";
import { ReviewerNamePrompt } from "./ReviewerNamePrompt";
import { ConfirmDialog } from "@/components/chrome/ConfirmDialog";
import { StarRating } from "@/components/chrome/StarRating";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { lightboxTones } from "@/lib/lightbox-theme";
import { previewSrcSet } from "@/lib/gridLayout";
import { Icons } from "@/lib/ui-icons";
import { useLightboxKeys } from "./lightbox-keys";
import { usePinchZoom } from "@/hooks/usePinchZoom";
import { useZoomSlider } from "@/hooks/useZoomSlider";
import { LightboxZoomControl } from "./LightboxZoomControl";
import { photoSrc as resolvePhotoSrc, variantSrc as resolveVariantSrc } from "./lightbox-image-src";
import type { Anchor, ColorFlag, CollabFeatures, LightboxBackdrop, LightboxZoomMax, Rating } from "@/lib/types";
import { showsFlags, showsStars } from "@/lib/types";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Maximize,
  Minimize,
  Heart,
  MessageCircle,
  Flag,
  PenLine,
  Eye,
  EyeOff,
  Tags,
} from "lucide-react";

/** Default color for new annotation marks (a strong rose that reads on most photos). */
const ANNOTATION_COLOR = "#e11d48";

/** Freehand stroke widths (px) offered in draw mode. `dot` previews the size in the toolbar. */
const STROKE_WIDTHS = [
  { key: "thin", px: 2, dot: 4 },
  { key: "medium", px: 3.5, dot: 7 },
  { key: "thick", px: 6, dot: 11 },
] as const;

const FLAG_COLORS: { value: ColorFlag; bg: string }[] = [
  { value: "green",  bg: "bg-green-500" },
  { value: "red",    bg: "bg-red-500" },
  { value: "yellow", bg: "bg-yellow-400" },
  { value: "blue",   bg: "bg-blue-400" },
];

interface Props {
  downloadsEnabled: boolean;
  /** Instance-wide backdrop tone behind the viewer. Defaults to the current dimmed black. */
  backdrop?: LightboxBackdrop;
  collabMode?: boolean;
  shareToken?: string;
  galleryToken?: string;
  teamVoting?: boolean;
  reviewerVotes?: Record<string, string>;
  onVote?: (imageId: string, flag: string) => void;
  reviewerRatings?: Record<string, number>;
  onRatingVote?: (imageId: string, rating: number) => void;
  /** Image ids the current reviewer has liked (filled-when-mine heart). */
  likedSet?: Set<string>;
  onToggleLike?: (imageId: string) => void;
  watermarkEnabled?: boolean;
  /** Instance/gallery high-res preview mode — drives the srcset width descriptors. */
  highRes?: boolean;
  features?: CollabFeatures;
  /** Show the original filename in the footer. Admin defaults on; public is gallery-controlled. */
  showFilename?: boolean;
  showExif?: boolean;
  showIptc?: boolean;
  /** When set, comments are read/written through the admin-authenticated endpoint. */
  adminGalleryId?: string;
  /** Public client galleries: deter casual saving (right-click / drag / long-press).
   *  A deterrent only — the dedicated Download button still works. */
  protectImages?: boolean;
  /** Instance settings: desktop review-lightbox zoom control on/off + its ceiling. */
  zoomEnabled?: boolean;
  zoomMax?: LightboxZoomMax;
}

const DEFAULT_FEATURES: CollabFeatures = { colorFlags: true, ratingMode: "flags", likes: false, comments: true, annotations: false };

export function Lightbox({
  downloadsEnabled,
  backdrop = "dimmed",
  collabMode = false,
  shareToken,
  galleryToken,
  teamVoting = false,
  reviewerVotes = {},
  onVote,
  reviewerRatings = {},
  onRatingVote,
  likedSet,
  onToggleLike,
  watermarkEnabled = false,
  highRes = false,
  features = DEFAULT_FEATURES,
  showFilename = true,
  showExif: exifEnabled = true,
  showIptc: iptcEnabled = false,
  adminGalleryId,
  protectImages = false,
  zoomEnabled = true,
  zoomMax = "400",
}: Props) {
  const t = useTranslations("gallery.lightbox");
  const ti = useTranslations("gallery.iptc");
  const ta = useTranslations("gallery.annotations");
  const tc = useTranslations("common");
  const { images, currentIndex, close, next, prev, goTo, intent } = useLightboxStore();
  const qc = useQueryClient();
  const [showExif, setShowExif] = useState(false);
  const [showIptc, setShowIptc] = useState(false);
  // The lightbox mounts fresh on each open, so open-intent (e.g. a tile's comment pill) seeds the
  // initial panel state. The annotations panel implies the comments panel (marks ↔ comment rows).
  const [showComments, setShowComments] = useState(
    intent.panel === "comments" || intent.panel === "annotations",
  );
  // Marks follow the comment panel: anchored comments list in the panel, so opening it (icon or a
  // tile's comment-pill intent) reveals their pen marks too; the eye toggle stays for standalone
  // control.
  const [showAnnotations, setShowAnnotations] = useState(
    intent.panel === "annotations" ||
      (intent.panel === "comments" && (images[currentIndex]?.annotation_count ?? 0) > 0),
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Immersive mode: tapping the photo hides all chrome for a clean full-bleed view (tap again to
  // restore). Works on iOS, where the real Fullscreen API only applies to <video>.
  const [immersive, setImmersive] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [needName, setNeedName] = useState(false);
  const [hoveredAnno, setHoveredAnno] = useState<string | null>(null);
  const [pendingDeleteAnno, setPendingDeleteAnno] = useState<string | null>(null);
  const [strokeWidth, setStrokeWidth] = useState<number>(3.5);
  const reviewerName = useReviewerStore((s) => s.name);
  // On phones (small viewport / coarse pointer) we serve the `small` rendition, not `medium`. With
  // sizes="100vw" the browser multiplies by DPR (2–3 on phones), so a "100vw" slide demands ~1000–
  // 1200px and always picks `medium` (1920/2560px) — the heaviest file — even on a tiny screen. That
  // big decode is what couldn't keep up mid-swipe. `small` (1024/1280px) is plenty for a phone and
  // decodes several times faster. Desktop is unaffected (compact=false → medium + full srcset).
  const COMPACT_QUERY = "(max-width: 768px), (pointer: coarse)";
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia(COMPACT_QUERY).matches,
  );
  // Touch-swipe carousel: a 3-slide track (prev / current / next) translates with the finger. An
  // axis-lock fixes the gesture to one direction (horizontal = prev/next, vertical-down = dismiss)
  // so a sideways swipe never drifts vertically. The track is driven *imperatively* (transform
  // written straight to the element via a ref), so dragging never re-renders the lightbox — the
  // gesture stays buttery. Drag offsets live in refs, not state.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"x" | "y" | null>(null);
  const dragX = useRef(0);
  const dragY = useRef(0);
  // Finalizes an in-flight commit animation (index swap + reset). Run early if the user grabs again
  // before it finishes, so rapid consecutive swipes each register from the new current photo.
  const pendingCommit = useRef<(() => void) | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  // Two nested layers keep the gesture and the navigation independent:
  //   trackRef — the index layer; transform = translateX(-currentIndex*100%). Owned declaratively by
  //              a layout effect, so it changes only on a committed navigation (and never animates →
  //              desktop clicks stay an instant hard-cut).
  //   dragRef  — the finger layer (inside the track); transform = the live drag delta, rest = 0.
  //              Owned imperatively by paintTrack — independent of currentIndex, so a touchmove never
  //              re-renders the lightbox and settling a swipe early can't read a stale index.
  // A commit eases dragRef to ±one slide, then advances the index: the layout effect shifts the track
  // by exactly that slide and resets the drag layer to 0 in the same frame → seamless, no flushSync.
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  // Mobile path only: a native horizontal scroll-snap carousel (instead of the JS transform above).
  // The browser owns the gesture AND the image decode/paint for the scroll, which is what finally
  // kills the iOS swipe flash — WebKit pre-decodes the snapped/adjacent slides itself, where a
  // JS-transform reveal of an off-screen <img> made it (re)decode on screen. scrollSettle debounces
  // the scroll-end so we sync the committed index once the swipe lands on a snap point.
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollSettle = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Swipe-down-to-dismiss on the mobile scroll carousel. The container scrolls horizontally
  // natively; these passive handlers only engage on a clearly-vertical *downward* drag (which the
  // container doesn't scroll natively — overflow-y is hidden), so they never fight the horizontal
  // gesture. They stand down entirely while the pinch-zoom owns the carousel (zoomActive).
  const dismiss = useRef<{ x: number; y: number; axis: "h" | "v" | null; dy: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const hoverClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Measured top-toolbar height — the bare bottom strip mirrors it for an even photo frame.
  const topBarRef = useRef<HTMLDivElement>(null);
  const [topBarH, setTopBarH] = useState(0);

  // Hover highlight with a short grace period on clear, so the pointer can travel from a stroke to
  // its floating trash button (or comment row) without the highlight flickering off.
  function handleAnnoHover(id: string | null) {
    if (hoverClearTimer.current) clearTimeout(hoverClearTimer.current);
    if (id === null) {
      hoverClearTimer.current = setTimeout(() => setHoveredAnno(null), 250);
    } else {
      setHoveredAnno(id);
    }
  }

  // Tap/click the photo to toggle immersive (chrome-hidden) mode. Desktop only as a click handler —
  // on touch, taps route through the pinch-zoom hook (which must tell a single tap apart from a
  // double-tap zoom) and land in onSingleTap below. Skipped while annotating (the pen owns the
  // pointer).
  function toggleImmersive() {
    if (annotating) return;
    setImmersive((v) => !v);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      containerRef.current?.requestFullscreen().catch(() => {});
    }
  }

  const image = images[currentIndex];

  // Pinch-to-zoom (touch lightbox only — see docs/architecture/lightbox-pinch-zoom.md). The hook
  // owns two-finger/double-tap gestures on the scroll carousel and suspends the native scroll while
  // zoomed; zoomActive gates the dismiss handlers below. Slides that zoomed past ~1.2× get their
  // rendition upgraded small → medium (decoded off-screen first, so the swap never flashes).
  const [upgradedIds, setUpgradedIds] = useState<Set<string>>(() => new Set());
  function upgradeZoomRendition() {
    const im = images[currentIndex];
    if (!im || im.is_video || upgradedIds.has(im.id)) return;
    const target = variantSrc(im, "medium");
    if (!target || target === variantSrc(im, "small")) return;
    const pre = new window.Image();
    pre.onload = () => {
      const apply = () => setUpgradedIds((prev) => new Set(prev).add(im.id));
      if (pre.decode) pre.decode().then(apply, apply);
      else apply();
    };
    pre.src = target;
  }
  const pinchZoomEnabled =
    compact && !annotating && !!image && !image.is_video && image.processing_status !== "no_preview";
  const { layerRef: zoomLayerRef, activeRef: zoomActive } = usePinchZoom({
    scrollRef,
    enabled: pinchZoomEnabled,
    currentIndex,
    // Must mirror the carousel's rendered inline styles for the current mode (see the JSX below).
    getRestoreStyle: () => ({
      overflowX: annotating ? "hidden" : "auto",
      scrollSnapType: annotating ? "none" : "x mandatory",
      touchAction: annotating ? "none" : "pan-x",
    }),
    onSingleTap: toggleImmersive,
    onUpgrade: upgradeZoomRendition,
  });

  // Desktop zoom slider (review contexts only — see docs/architecture/lightbox-zoom-slider.md).
  // Shares the zoom layer with the pinch hook; `compact` keeps the two mutually exclusive. On the
  // first zoom past ~1.2× the current slide's `sizes` is bumped so the srcset re-picks a larger
  // preview (never the original — watermark/download gating stays intact). Zoom stays active while
  // annotating — the pen owns the drag (pan disabled), wheel + slider keep zooming.
  const [zoomBoost, setZoomBoost] = useState(false);
  const sliderZoomEnabled =
    zoomEnabled &&
    !compact &&
    (collabMode || !!adminGalleryId) &&
    !!image &&
    !image.is_video &&
    image.processing_status !== "no_preview";
  const desktopZoom = useZoomSlider({
    areaRef,
    enabled: sliderZoomEnabled,
    panDisabled: annotating,
    zoomMax: zoomMax === "original" ? "original" : Number(zoomMax) / 100,
    originalWidth: image?.width,
    currentIndex,
    onUpgrade: () => setZoomBoost(true),
  });

  // Track local flag/likes optimistically; reset them when the lightbox moves to a
  // different image. This is a render-time reset (React's recommended alternative to
  // a setState-in-effect, which triggers cascading-render warnings).
  const [localFlag, setLocalFlag] = useState<ColorFlag>(image?.color_flag ?? "none");
  const [localRating, setLocalRating] = useState<number>(image?.rating ?? 0);
  // Plain instant swap between photos — no cross-fade (a fade between differently-shaped portrait/
  // landscape photos always looks off, and most pro galleries just hard-cut). The photo
  // paints over an always-present cached-thumbnail underlay (see the slide below) and decodes
  // synchronously, so there's no blank/placeholder swap to flash. Reset per-image state here
  // (render-time, React's alternative to a setState-in-effect).
  const [syncedImageId, setSyncedImageId] = useState(image?.id);
  if (image?.id !== syncedImageId) {
    setSyncedImageId(image?.id);
    setLocalFlag(image?.color_flag ?? "none");
    setLocalRating(image?.rating ?? 0);
    setShowComments(false);
    setAnnotating(false);
    setHoveredAnno(null);
    setShowAnnotations(false);
    setZoomBoost(false);
  }

  const effectiveFlag: ColorFlag = teamVoting
    ? ((reviewerVotes[image?.id ?? ""] as ColorFlag) ?? "none")
    : localFlag;

  const flagMutation = useMutation({
    mutationFn: (flag: ColorFlag) => {
      // Admin reviews via the authenticated image endpoint (no share token / gallery password);
      // public collaboration reviewers go through the share-token endpoint.
      if (adminGalleryId) return api.images.update(image.id, { color_flag: flag });
      if (!shareToken) throw new Error("no token");
      return api.public.flagImage(shareToken, image.id, flag, galleryToken);
    },
    onMutate: (flag) => setLocalFlag(flag),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: adminGalleryId ? ["gallery-images", adminGalleryId] : ["public-images"],
      }),
    onError: () => setLocalFlag(image.color_flag),
  });

  function handleFlag(flagValue: ColorFlag) {
    if (teamVoting && onVote) {
      const next = effectiveFlag === flagValue ? "none" : flagValue;
      onVote(image.id, next);
    } else {
      flagMutation.mutate(effectiveFlag === flagValue ? "none" : flagValue);
    }
  }

  const starsUI = showsStars(features.ratingMode);
  const flagUI = showsFlags(features.ratingMode);
  const bothUI = starsUI && flagUI;
  const effectiveRating = teamVoting ? (reviewerRatings[image?.id ?? ""] ?? 0) : localRating;
  const ratingMutation = useMutation({
    mutationFn: (rating: number) => {
      if (adminGalleryId) return api.images.update(image.id, { rating: rating as Rating });
      if (!shareToken) throw new Error("no token");
      return api.public.rateImage(shareToken, image.id, rating, galleryToken);
    },
    onMutate: (rating) => setLocalRating(rating),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: adminGalleryId ? ["gallery-images", adminGalleryId] : ["public-images"],
      }),
    onError: () => setLocalRating(image.rating),
  });

  function handleRating(value: number) {
    if (teamVoting && onRatingVote) onRatingVote(image.id, value);
    else ratingMutation.mutate(value);
  }

  const liked = likedSet?.has(image?.id ?? "") ?? false;

  // Annotations (anchored comment pins). Pins must render without the comment panel open, so the
  // lightbox loads comments itself — sharing CommentPanel's query key so the two stay in sync.
  const annotationsEnabled = features.annotations && (!!shareToken || !!adminGalleryId) && !image?.is_video;
  const commentsQueryKey = adminGalleryId
    ? ["admin-comments", adminGalleryId, image?.id]
    : ["comments", shareToken, image?.id];
  const { data: lbComments = [], isSuccess: lbLoaded } = useQuery({
    queryKey: commentsQueryKey,
    queryFn: () =>
      adminGalleryId
        ? api.galleries.imageComments(adminGalleryId, image!.id)
        : api.public.getComments(shareToken!, image!.id, galleryToken),
    enabled: !!image && annotationsEnabled,
  });

  // Stable mark numbers (anchored comments, by creation order) — one source of truth shared by the
  // overlay marks and the comment list so a pin's number matches its comment row.
  const annoNumbers: Record<string, number> = {};
  lbComments
    .filter((c) => c.anchor)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .forEach((c, i) => {
      annoNumbers[c.id] = i + 1;
    });

  // Counts drive the comment + annotation toggles. Prefer the live loaded comments (so deleting a
  // mark or comment updates the badge immediately) and fall back to the store snapshot before load.
  const annotationCount = lbLoaded
    ? lbComments.filter((c) => c.anchor).length
    : (image?.annotation_count ?? 0);
  const plainCommentCount = lbLoaded
    ? lbComments.filter((c) => !c.anchor).length
    : Math.max(0, (image?.comment_count ?? 0) - (image?.annotation_count ?? 0));

  const deleteAnnotation = useMutation({
    mutationFn: (id: string) =>
      adminGalleryId
        ? api.galleries.deleteImageComment(adminGalleryId, image.id, id)
        : api.public.deleteComment(shareToken!, image.id, id, reviewerName ?? "", galleryToken),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commentsQueryKey });
      qc.invalidateQueries({
        queryKey: adminGalleryId ? ["gallery-images", adminGalleryId] : ["public-images", shareToken],
      });
    },
  });

  // Admin may delete any mark; a public viewer only their own (author matches their reviewer name).
  function canDeleteAnno(authorName: string): boolean {
    if (adminGalleryId) return true;
    const me = (reviewerName ?? "").trim().toLowerCase();
    return !!me && authorName.trim().toLowerCase() === me;
  }

  function confirmDeleteAnno() {
    if (!pendingDeleteAnno) return;
    deleteAnnotation.mutate(pendingDeleteAnno, { onSuccess: () => setPendingDeleteAnno(null) });
  }

  const addAnnotation = useMutation({
    mutationFn: ({ anchor, text, name }: { anchor: Anchor; text: string; name: string }) =>
      adminGalleryId
        ? api.galleries.addImageComment(adminGalleryId, image.id, { author_name: name, text, anchor })
        : api.public.addComment(shareToken!, image.id, { author_name: name, text, anchor }, galleryToken),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commentsQueryKey });
      qc.invalidateQueries({
        queryKey: adminGalleryId ? ["gallery-images", adminGalleryId] : ["public-images", shareToken],
      });
    },
  });

  function toggleAnnotate() {
    if (annotating) {
      // Mirror the comment icon's toggle: the pen opened the comment panel, so deactivating the
      // pen closes it again.
      setAnnotating(false);
      setShowComments(false);
      return;
    }
    if (!reviewerName) {
      setNeedName(true);
      return;
    }
    setAnnotating(true);
    setShowAnnotations(true);
    setShowComments(true);
  }

  function handleCreateAnnotation(anchor: Anchor, text: string) {
    if (!reviewerName) {
      setNeedName(true);
      return;
    }
    addAnnotation.mutate({ anchor, text, name: reviewerName });
  }

  useLightboxKeys({ close, next, prev });

  // Resolve a rendition src — the watermark proxy when active (it has /small + /medium routes so the
  // watermark is never bypassed), else the stored rendition. `small` is used on phones (see `compact`)
  // and `medium` on desktop. Shared by the displayed photo, the swipe-peek neighbors, and the neighbor
  // preloader effect below — declared here (above that effect) so it's never used before declaration.
  function variantSrc(im: (typeof images)[number], variant: "small" | "medium"): string {
    return resolveVariantSrc(im, variant, { watermarkEnabled, shareToken });
  }
  // The displayed source for a slide: small on phones, medium (+srcset) on desktop.
  function photoSrc(im: (typeof images)[number]): string {
    return resolvePhotoSrc(im, compact, { watermarkEnabled, shareToken });
  }

  // Detect a phone-class device → serve `small` instead of `medium` (see `compact` above).
  useEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Warm nearby photos so a swipe/click lands on an already-fetched image. We only *fetch* (prime the
  // HTTP cache) — no eager img.decode(). The ±1 neighbors are already mounted in the slide window
  // below, so the browser decodes them off-screen as part of normal rendering; by the time you swipe
  // to one it's painted. (The old code force-decoded four large renditions on the main thread right
  // during the gesture — that was the jank, not the cure.) Preload the *exact* source the slide will
  // render — `small` on phones, `medium` (+srcset) on desktop — so the cache actually hits.
  useEffect(() => {
    for (const offset of [1, -1, 2, -2]) {
      const im = images[currentIndex + offset];
      if (!im || im.is_video) continue;
      if (im.thumb_url) {
        const t = new window.Image();
        t.fetchPriority = "low";
        t.src = im.thumb_url;
      }
      const pre = new window.Image();
      pre.fetchPriority = "low";
      if (compact) {
        pre.src = variantSrc(im, "small");
      } else {
        const ss = previewSrcSet(im, highRes);
        if (ss) {
          pre.srcset = ss;
          pre.sizes = "100vw";
        }
        pre.src = variantSrc(im, "medium");
      }
    }
    // variantSrc is a stable closure over watermarkEnabled/shareToken; excluded so the preloader
    // doesn't re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, images, highRes, compact]);

  // Lock the page behind the lightbox while it's open. The overlay is fixed + (often) translucent,
  // so a stray scroll of the document underneath would slide the gallery grid into view beneath it.
  // The lightbox is conditionally mounted (`isOpen && <Lightbox>`), so this mount/unmount maps 1:1
  // to open/close — restore the previous value on close.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = prev;
    };
  }, []);

  // Mirror the top toolbar's rendered height (its buttons/padding may change) into state. The bar
  // is conditionally mounted (immersive), so re-bind when it returns.
  useLayoutEffect(() => {
    const el = topBarRef.current;
    if (!el) return;
    const update = () => setTopBarH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [immersive]);

  // Track browser fullscreen so the toggle reflects the real state (incl. Esc-to-exit).
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // The track (index layer) is positioned declaratively here, so it changes only when the committed
  // index changes — never mid-gesture, never animated → a desktop click/keyboard nav is an instant
  // hard-cut (unchanged). It also resets the drag layer to rest, which is the seamless handoff after
  // a commit: the track shifts by one slide and the drag delta zeroes in the same frame.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track) {
      track.style.transition = "none";
      track.style.transform = `translateX(${-currentIndex * 100}%)`;
    }
    const drag = dragRef.current;
    if (drag) {
      drag.style.transition = "none";
      drag.style.transform = "translate(0px, 0px)";
      drag.style.opacity = "1";
    }
  }, [currentIndex]);

  // Mobile scroll-snap: keep the scroll position aligned to currentIndex. Runs on index changes that
  // come from *outside* the scroll (initial open, keyboard) and is a no-op when the user just scrolled
  // there (scrollLeft already matches), so it never fights the native gesture. Instant (no smooth).
  useLayoutEffect(() => {
    if (!compact) return;
    const el = scrollRef.current;
    if (!el) return;
    const target = currentIndex * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) > 2) el.scrollLeft = target;
  }, [compact, currentIndex]);

  // Sync the committed index once a native swipe settles on a snap point. Debounced so we update only
  // when scrolling stops, not on every frame (which would re-render the heavy lightbox mid-scroll).
  function handleScroll() {
    const el = scrollRef.current;
    if (!el || zoomActive.current) return;
    if (scrollSettle.current) clearTimeout(scrollSettle.current);
    scrollSettle.current = setTimeout(() => {
      const idx = Math.round(el.scrollLeft / el.clientWidth);
      goTo(idx);
    }, 80);
  }

  // Swipe-down-to-dismiss on the mobile carousel. Engages only on a clearly-vertical downward drag;
  // a horizontal drag is left entirely to the native scroll. Translates the whole carousel down +
  // fades, then closes past a threshold (else snaps back). Skipped while annotating.
  function onDismissStart(e: React.TouchEvent) {
    if (annotating || zoomActive.current || e.touches.length !== 1) { dismiss.current = null; return; }
    dismiss.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null, dy: 0 };
  }
  function onDismissMove(e: React.TouchEvent) {
    const d = dismiss.current;
    if (!d) return;
    const dx = e.touches[0].clientX - d.x;
    const dy = e.touches[0].clientY - d.y;
    if (!d.axis) {
      if (Math.hypot(dx, dy) < 12) return;
      // Vertical only if clearly downward and more vertical than horizontal; else hand off to scroll.
      d.axis = dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.2 ? "v" : "h";
    }
    if (d.axis === "v") {
      d.dy = Math.max(0, dy);
      const el = scrollRef.current;
      if (el) {
        el.style.transition = "none";
        el.style.transform = `translateY(${d.dy}px)`;
        el.style.opacity = String(Math.max(0.3, 1 - d.dy / 600));
      }
    }
  }
  function onDismissEnd() {
    const d = dismiss.current;
    dismiss.current = null;
    if (!d || d.axis !== "v") return;
    if (d.dy > 110) { close(); return; }
    const el = scrollRef.current;
    if (el) {
      el.style.transition = "transform 200ms ease, opacity 200ms ease";
      el.style.transform = "translateY(0px)";
      el.style.opacity = "1";
    }
  }

  // Swipe lives on the image area only (not the whole overlay) so scrolling the comment/EXIF/IPTC
  // panels never navigates. Skipped while annotating (the pen owns the pointer) and on video (let
  // the native scrubber work).
  //
  // paintTrack writes the *drag layer* transform straight to the DOM — no React state, so a touchmove
  // never re-renders the (heavy) lightbox; that's what keeps the gesture smooth. It's relative to rest
  // (0,0) and independent of currentIndex. `animate` toggles the easing transition for commit / snap.
  const COMMIT_MS = 220;
  function paintTrack(x: number, y: number, animate: boolean) {
    const el = dragRef.current;
    if (!el) return;
    el.style.transition = animate
      ? `transform ${COMMIT_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity ${COMMIT_MS}ms linear`
      : "none";
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.opacity = y > 0 ? String(Math.max(0.4, 1 - y / 500)) : "1";
  }

  // Ease the drag layer to the neighbor, then advance the index. The layout effect above repositions
  // the track by exactly one slide and snaps the drag layer back to 0 in the same render — the eased
  // image stays put, no jump and no flushSync (so no heavy synchronous re-render mid-gesture).
  function commitSwipe(advance: () => void, target: number) {
    paintTrack(target, 0, true);
    const finalize = () => {
      pendingCommit.current = null;
      advance();
    };
    pendingCommit.current = finalize;
    window.setTimeout(() => {
      if (pendingCommit.current === finalize) finalize();
    }, COMMIT_MS);
  }

  function handleTouchStart(e: React.TouchEvent) {
    // While the slider zoom is past fit, the zoom hook's pointer pan owns one-finger drags.
    if (annotating || image?.is_video || desktopZoom.activeRef.current || e.touches.length !== 1) return;
    pendingCommit.current?.(); // settle a still-animating previous swipe before starting a new one
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    axis.current = null;
    dragX.current = 0;
    dragY.current = 0;
    paintTrack(0, 0, false); // cancel any in-flight easing; no transition while dragging
  }
  function handleTouchMove(e: React.TouchEvent) {
    if (!touchStart.current) return;
    const dx = e.touches[0].clientX - touchStart.current.x;
    const dy = e.touches[0].clientY - touchStart.current.y;
    // Lock to the dominant axis once the gesture clears a small deadzone.
    if (!axis.current) {
      if (Math.hypot(dx, dy) < 10) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (axis.current === "x") {
      // Rubber-band (¼ travel) when there's no neighbor to reveal in that direction.
      const hasNext = currentIndex < images.length - 1;
      const hasPrev = currentIndex > 0;
      const resist = (dx < 0 && !hasNext) || (dx > 0 && !hasPrev);
      dragX.current = resist ? dx * 0.25 : dx;
      paintTrack(dragX.current, 0, false);
    } else {
      // Only a downward drag dismisses; resist upward.
      dragY.current = dy > 0 ? dy : dy * 0.25;
      paintTrack(0, dragY.current, false);
    }
  }
  function handleTouchEnd() {
    touchStart.current = null;
    const ax = axis.current;
    axis.current = null;
    if (ax === "x") {
      const w = areaRef.current?.clientWidth ?? window.innerWidth;
      if (dragX.current <= -60 && currentIndex < images.length - 1) {
        commitSwipe(next, -w);
      } else if (dragX.current >= 60 && currentIndex > 0) {
        commitSwipe(prev, w);
      } else {
        paintTrack(0, 0, true); // snap back
      }
    } else if (ax === "y") {
      if (dragY.current > 90) close();
      else paintTrack(0, 0, true); // snap back
    }
  }

  if (!image) return null;

  const exif = image.exif_data;
  const iptc = image.iptc_data;
  const hasIptc = iptc != null && Object.keys(iptc).length > 0;
  const activeFlagColor = FLAG_COLORS.find((f) => f.value === effectiveFlag);

  // Carousel slides are positioned by their absolute index (each slide at translateX(idx*100%)); the
  // track is translated to -currentIndex*100% to center the current one (set in the layout effect).
  // Because every slide sits at its own index, a committed navigation never *reorders* DOM nodes — the
  // peeked neighbor is already at the spot it lands on, so there's no reconcile-driven jump (the old
  // keyed 3-slide window reordered + flushSync'd on every commit, which is what flashed a partial
  // frame). No horizontal inset between slides: any padding becomes a backdrop band *between* two
  // photos during a swipe, very visible on a light backdrop. Edge-to-edge slides (how PhotoSwipe / iOS
  // Photos do it) let adjacent photos meet with no gap. The nav chevrons overlay the photo edges.
  const slidePad = "px-0";

  // Backdrop tone → chrome colors (single source: lightboxTones). The white tones ("white" solid,
  // "transparent" = a translucent white dim) flip to dark controls; black / dimmed keep
  // light-on-dark chrome. Passed down to the comment panel + annotation popover so they match.
  const tones = lightboxTones(backdrop);
  const { light, surface, muted, strong, hoverStrong, hoverBg, borderTone, faint, chipBg } = tones;

  const flagsEnabled = features.colorFlags;
  const likesEnabled = features.likes && !teamVoting;
  const commentsEnabled = features.comments;
  // Comments live in the top toolbar (visible in admin + collaboration); the bottom toolbar
  // only carries the collaboration flag/like actions.
  const showCommentToggle = !!adminGalleryId || (commentsEnabled && !!shareToken);
  // Flag/like toolbar: public collaboration reviewers (share token) or the admin reviewing their
  // own gallery (adminGalleryId — flags only; likes stay public-side).
  const showToolbar = ((collabMode && !!shareToken) || !!adminGalleryId) && (flagsEnabled || likesEnabled);
  // On a phone in annotation mode the top bar must stay compact (stroke widths + Done + Close), so
  // the annotation tools don't push Download/Fullscreen/Close off the right edge. Hide the
  // non-annotation actions then; they're not needed mid-drawing and return on "Done".
  const annoCompact = compact && annotating;
  // Showcase framing: when the filename strip is the only bottom chrome (no collab toolbar, no
  // open panel), it stretches to the measured top-toolbar height (topBarH) so the photo sits in an
  // even frame top and bottom.
  const bottomBare =
    !showToolbar &&
    !sliderZoomEnabled &&
    !(showCommentToggle && showComments) &&
    !(showExif && exif) &&
    !(showIptc && hasIptc);

  // The inner content of a slide — shared by the desktop transform carousel and the mobile scroll-snap
  // carousel, so the two never drift. `showThumb`/`showPhoto` let the mobile path window which slides
  // actually load images (the rest are sized-but-empty so the scroll geometry stays correct).
  function slideContent(im: (typeof images)[number], isCurrent: boolean, showThumb = true, showPhoto = true) {
    if (im.processing_status === "no_preview") {
      // No viewable rendition (e.g. a PSB without an embedded thumbnail). Show the file + name; the
      // download control in the chrome serves the original when downloads are enabled.
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-zinc-400">
          <Icons.noPreviewFile size={56} />
          <div className="max-w-md break-all text-sm">{im.original_filename}</div>
          <div className="text-xs text-zinc-500">{t("noPreview")}</div>
        </div>
      );
    }
    return (
      <>
        {/* Zoom layer — the pinch/double-tap transform target (written imperatively by usePinchZoom
            on the current slide). Wraps exactly the photo + its annotation marks so they scale and
            pan together; the flag/star badges below stay outside as unscaled chrome. */}
        <div ref={isCurrent ? (compact ? zoomLayerRef : desktopZoom.layerRef) : undefined} className="absolute inset-0">
        {/* Cached-thumbnail underlay — always painted behind the photo, never the backdrop. */}
        {showThumb && im.thumb_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key="blur"
            src={im.thumb_url}
            alt=""
            aria-hidden
            draggable={false}
            className="absolute inset-0 w-full h-full object-contain select-none"
          />
        )}
        {showPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key="photo"
            ref={isCurrent ? (el) => { imgRef.current = el; } : undefined}
            data-lightbox-photo=""
            src={compact && upgradedIds.has(im.id) ? variantSrc(im, "medium") : photoSrc(im)}
            srcSet={compact ? undefined : previewSrcSet(im, highRes)}
            sizes={compact ? undefined : isCurrent && zoomBoost ? "200vw" : "100vw"}
            alt={isCurrent ? im.original_filename : ""}
            fetchPriority={isCurrent ? "high" : "auto"}
            // Force a decode as soon as the slide downloads so it's paint-ready before it's revealed.
            onLoad={(e) => { void e.currentTarget.decode?.().catch(() => {}); }}
            // Touch taps route through usePinchZoom (single vs double tap); desktop keeps the click.
            onClick={isCurrent && !compact ? toggleImmersive : undefined}
            onContextMenu={protectImages ? (e) => e.preventDefault() : undefined}
            draggable={false}
            className={`relative z-10 w-full h-full object-contain select-none ${protectImages ? "[-webkit-touch-callout:none]" : ""}`}
          />
        )}
        {isCurrent && annotationsEnabled && (
          <AnnotationLayer
            key="anno"
            imgRef={imgRef}
            comments={lbComments}
            drawing={annotating}
            showMarks={showAnnotations || annotating}
            color={ANNOTATION_COLOR}
            strokeWidth={strokeWidth}
            onCreate={handleCreateAnnotation}
            creating={addAnnotation.isPending}
            numbers={annoNumbers}
            highlightId={hoveredAnno}
            onHover={handleAnnoHover}
            canDelete={canDeleteAnno}
            onDelete={(id) => setPendingDeleteAnno(id)}
            tones={tones}
          />
        )}
        </div>
        {/* Rating badge: flag dot and/or star row ("both" mode: dot left of stars) — the flag ring
            flips to black on a light/white backdrop so it stays visible. */}
        {isCurrent && (collabMode || adminGalleryId) && flagsEnabled &&
          ((flagUI && effectiveFlag !== "none" && !!activeFlagColor) || (starsUI && effectiveRating > 0)) && (
          <div key="rating-badge" className="absolute top-3 right-16 flex items-center gap-1.5">
            {flagUI && effectiveFlag !== "none" && activeFlagColor && (
              <div className={`w-4 h-4 rounded-full ring-2 ${light ? "ring-black/70" : "ring-white"} shadow-[0_0_3px_rgba(0,0,0,0.4)] ${activeFlagColor.bg}`} />
            )}
            {starsUI && effectiveRating > 0 && (
              <StarRating value={effectiveRating} size={15} emptyClassName={light ? "text-black/20" : "text-white/30"} />
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-50 ${surface} flex flex-col`}
    >
      {/* Top toolbar — hidden in immersive mode */}
      {!immersive && (
      <div ref={topBarRef} className="flex items-center justify-between px-4 py-3 flex-shrink-0">
        <span className={`${muted} text-sm`}>
          {currentIndex + 1} / {images.length}
        </span>
        <div className="flex items-center gap-2">
          {showCommentToggle && !annoCompact && (
            <Button
              variant="ghost"
              size="sm"
              className={`${muted} ${hoverStrong} ${showComments ? strong : ""}`}
              onClick={() => {
                const next = !showComments;
                setShowComments(next);
                // Anchored comments list in the panel — reveal/hide their pen marks along with it
                // (drawing mode forces marks on regardless, so don't touch the flag mid-annotate).
                if (annotationCount > 0 && !annotating) setShowAnnotations(next);
              }}
              title={t("comments")}
              aria-label={t("comments")}
              aria-pressed={showComments}
            >
              <MessageCircle size={16} />
              {plainCommentCount > 0 && <span className="ml-1 text-sm">{plainCommentCount}</span>}
            </Button>
          )}
          {annotationsEnabled && annotationCount > 0 && !annotating && (
            <Button
              variant="ghost"
              size="sm"
              className={`${muted} ${hoverStrong} ${showAnnotations ? strong : ""}`}
              onClick={() => setShowAnnotations((v) => !v)}
              title={showAnnotations ? ta("hideMarks") : ta("showMarks")}
              aria-label={showAnnotations ? ta("hideMarks") : ta("showMarks")}
              aria-pressed={showAnnotations}
            >
              {showAnnotations ? <Eye size={16} /> : <EyeOff size={16} />}
              <span className="ml-1 text-sm">{annotationCount}</span>
            </Button>
          )}
          {annotationsEnabled && annotating && (
            <div className={`flex items-center gap-0.5 rounded-md border ${borderTone} px-0.5`}>
              {STROKE_WIDTHS.map((sw) => (
                <button
                  key={sw.key}
                  onClick={() => setStrokeWidth(sw.px)}
                  title={ta(`thickness.${sw.key}`)}
                  aria-label={ta(`thickness.${sw.key}`)}
                  aria-pressed={strokeWidth === sw.px}
                  className={`flex items-center justify-center w-7 h-7 rounded outline-none focus-visible:ring-2 ${light ? "focus-visible:ring-black/60" : "focus-visible:ring-white"} ${hoverStrong} ${
                    strokeWidth === sw.px ? strong : muted
                  }`}
                >
                  <span className="rounded-full bg-current" style={{ width: sw.dot, height: sw.dot }} />
                </button>
              ))}
            </div>
          )}
          {annotationsEnabled && (
            <Button
              variant="ghost"
              size="sm"
              className={`${muted} ${hoverStrong} ${annotating ? strong : ""}`}
              onClick={toggleAnnotate}
              title={annotating ? ta("done") : ta("annotate")}
              aria-label={annotating ? ta("done") : ta("annotate")}
              aria-pressed={annotating}
            >
              <PenLine size={16} />
            </Button>
          )}
          {exif && exifEnabled && !annoCompact && (
            <Button
              variant="ghost"
              size="sm"
              className={`${muted} ${hoverStrong} ${showExif ? strong : ""}`}
              onClick={() => setShowExif((v) => !v)}
              title={t("exif")}
              aria-label={t("exif")}
              aria-pressed={showExif}
            >
              <Info size={16} />
            </Button>
          )}
          {hasIptc && iptcEnabled && !annoCompact && (
            <Button
              variant="ghost"
              size="sm"
              className={`${muted} ${hoverStrong} ${showIptc ? strong : ""}`}
              onClick={() => setShowIptc((v) => !v)}
              title={t("iptc")}
              aria-label={t("iptc")}
              aria-pressed={showIptc}
            >
              <Tags size={16} />
            </Button>
          )}
          {downloadsEnabled && !annoCompact && (image.is_video ? image.video_url : image.original_url) && (
            <a
              href={(image.is_video ? image.video_url : image.original_url) ?? undefined}
              download={image.original_filename}
              aria-label={t("download")}
              title={t("download")}
              className={`inline-flex items-center justify-center h-8 w-8 rounded-md ${muted} ${hoverStrong} ${hoverBg} transition-colors outline-none focus-visible:ring-2 ${light ? "focus-visible:ring-black/60" : "focus-visible:ring-white"}`}
            >
              <Download size={16} />
            </a>
          )}
          {!annoCompact && (
            <Button
              variant="ghost"
              size="sm"
              className={`${muted} ${hoverStrong}`}
              onClick={toggleFullscreen}
              title={isFullscreen ? t("exitFullscreen") : t("enterFullscreen")}
              aria-label={isFullscreen ? t("exitFullscreen") : t("enterFullscreen")}
            >
              {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={`${muted} ${hoverStrong}`}
            onClick={close}
            title={t("close")}
            aria-label={t("close")}
          >
            <X size={18} />
          </Button>
        </div>
      </div>
      )}

      {/* Main image area — desktop: JS transform carousel; mobile: native scroll-snap carousel.
          touch-none + JS touch handlers only on desktop; mobile needs touch for the native scroll. */}
      <div
        ref={areaRef}
        className={`flex-1 relative min-h-0 overflow-hidden ${compact ? "" : "touch-none"}`}
        onTouchStart={compact ? undefined : handleTouchStart}
        onTouchMove={compact ? undefined : handleTouchMove}
        onTouchEnd={compact ? undefined : handleTouchEnd}
      >
        {!compact && !immersive && (
          <button
            onClick={prev}
            aria-label={t("previous")}
            className={`absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full ${muted} ${hoverStrong} ${hoverBg} transition-colors outline-none focus-visible:ring-2 ${light ? "focus-visible:ring-black/60" : "focus-visible:ring-white"}`}
          >
            <ChevronLeft size={28} />
          </button>
        )}

        {compact ? (
          /* ---- Mobile: native horizontal scroll-snap carousel ----
             Real <img>s in a native scroll container: WebKit owns the gesture AND pre-decodes the
             snapped/adjacent slides, so swiping no longer reveals an undecoded off-screen image (the
             iOS flash). All slides are laid out (so scroll geometry = index × width and scrollLeft
             maps straight to the index), but only a window around the current one loads images; the
             rest are sized-but-empty. scroll-snap-stop:always = one photo per swipe. */
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            onTouchStart={onDismissStart}
            onTouchMove={onDismissMove}
            onTouchEnd={onDismissEnd}
            className="absolute inset-0 flex overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{
              overflowX: annotating ? "hidden" : "auto",
              scrollSnapType: annotating ? "none" : "x mandatory",
              WebkitOverflowScrolling: "touch",
              // Horizontal-only panning: the browser owns the left/right scroll, while a vertical
              // swipe is left entirely to JS (swipe-down dismiss). Without this, an *upward* swipe —
              // which the dismiss handler ignores and the container can't scroll (overflow-y hidden)
              // — chains to the document and scrolls the gallery page behind the translucent backdrop,
              // revealing the grid thumbnails underneath. `pan-x` stops that scroll-chaining at the
              // source; `overscroll-contain` is a belt-and-suspenders against any residual chaining.
              // While annotating: "none" — the pen owns the gesture and the browser must NOT
              // pinch/double-tap-zoom the whole page (that zoom was the bug). Normal viewing keeps
              // pan-x for the horizontal carousel (no *browser* zoom — photo zoom is usePinchZoom,
              // which temporarily overrides these three styles while zoomed; its getRestoreStyle
              // above must stay in sync with them).
              touchAction: annotating ? "none" : "pan-x",
              overscrollBehavior: "contain",
            }}
          >
            {images.map((im, idx) => {
              const isCurrent = idx === currentIndex;
              const dist = Math.abs(idx - currentIndex);
              return (
                <div
                  key={im.id}
                  className="relative w-full h-full shrink-0 flex items-center justify-center"
                  style={{ scrollSnapAlign: "center", scrollSnapStop: "always" }}
                >
                  {im.is_video
                    ? (isCurrent ? (
                        <video
                          key={im.id}
                          src={im.video_url ?? ""}
                          controls
                          autoPlay
                          playsInline
                          onContextMenu={protectImages ? (e) => e.preventDefault() : undefined}
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : <div className="w-full h-full" />)
                    : slideContent(im, isCurrent, dist <= 4, dist <= 2)}
                </div>
              );
            })}
          </div>
        ) : image.is_video ? (
          <div className={`absolute inset-0 flex items-center justify-center ${slidePad}`}>
            <video
              key={image.id}
              src={image.video_url ?? ""}
              controls
              autoPlay
              playsInline
              onContextMenu={protectImages ? (e) => e.preventDefault() : undefined}
              className="max-w-full max-h-full object-contain"
            />
          </div>
        ) : (
          // Desktop: trackRef = index layer (translateX(-currentIndex*100%)); dragRef = finger layer.
          <div ref={trackRef} className="absolute inset-0">
           <div ref={dragRef} className="absolute inset-0">
            {/* A ±1 window of slides, each positioned at its absolute index (translateX(idx*100%)). */}
            {[currentIndex - 1, currentIndex, currentIndex + 1].map((idx) => {
              const im = images[idx];
              const isCurrent = idx === currentIndex;
              if (!im || im.is_video) return null;
              return (
                <div
                  key={im.id}
                  style={{ transform: `translateX(${idx * 100}%)` }}
                  className={`absolute inset-0 flex items-center justify-center ${slidePad}`}
                >
                  {slideContent(im, isCurrent)}
                </div>
              );
            })}
           </div>
          </div>
        )}

        {!compact && !immersive && (
          <button
            onClick={next}
            aria-label={t("next")}
            className={`absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full ${muted} ${hoverStrong} ${hoverBg} transition-colors outline-none focus-visible:ring-2 ${light ? "focus-visible:ring-black/60" : "focus-visible:ring-white"}`}
          >
            <ChevronRight size={28} />
          </button>
        )}
      </div>

      {/* Collaboration toolbar — hidden in immersive mode. Also hosts the desktop zoom control
          (right-aligned, same row as the flag/rating actions), so it renders in review contexts
          even when flags & likes are off. */}
      {(showToolbar || sliderZoomEnabled) && !immersive && (
        <div className={`flex flex-wrap items-center gap-3 px-4 py-2 border-t ${borderTone} flex-shrink-0`}>
          {/* "both" mode: flags left of stars; the text labels yield on phones so both control
              groups fit one row (worst case the row wraps — hence flex-wrap above). */}
          {flagsEnabled && flagUI && (
            <>
              <span className={`text-xs text-zinc-500 items-center gap-1 ${bothUI ? "hidden sm:flex" : "flex"}`}>
                <Flag size={12} /> {t("flag")}
              </span>
              <div className="flex items-center gap-2.5 sm:gap-1.5">
                {FLAG_COLORS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => handleFlag(f.value)}
                    disabled={!teamVoting && flagMutation.isPending}
                    title={t(`flagLabels.${f.value}`)}
                    aria-label={t(`flagLabels.${f.value}`)}
                    aria-pressed={effectiveFlag === f.value}
                    className={`h-9 w-9 sm:h-6 sm:w-6 rounded-full transition-all outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${light ? "focus-visible:ring-black/60 focus-visible:ring-offset-white" : "focus-visible:ring-white"} ${f.bg} ${
                      effectiveFlag === f.value
                        ? `opacity-100 ring-2 ${light ? "ring-black/50" : "ring-white/70"} scale-110`
                        : "opacity-60 hover:opacity-100"
                    }`}
                  />
                ))}
              </div>
            </>
          )}
          {flagsEnabled && starsUI && (
            <>
              <span className={`text-xs text-zinc-500 items-center gap-1 ${bothUI ? "hidden sm:flex" : "flex"}`}>
                <Icons.rating size={12} /> {t("rating")}
              </span>
              <StarRating
                value={effectiveRating}
                onChange={handleRating}
                size={24}
                emptyClassName={light ? "text-black/25" : "text-white/35"}
              />
            </>
          )}
          <div className="flex-1" />
          {/* Like */}
          {likesEnabled && (
            <button
              onClick={() => onToggleLike?.(image.id)}
              aria-label={t("like")}
              aria-pressed={liked}
              className={`flex items-center gap-1 h-9 px-1.5 -mr-1.5 sm:h-auto sm:px-0 sm:mr-0 rounded ${muted} hover:text-red-400 transition-colors outline-none focus-visible:ring-2 ${light ? "focus-visible:ring-black/60" : "focus-visible:ring-white"}`}
            >
              <Heart size={16} className={liked ? "fill-red-500 text-red-500" : ""} />
              <span className="text-sm">{image.likes > 0 ? image.likes : ""}</span>
            </button>
          )}
          {sliderZoomEnabled && (
            <LightboxZoomControl
              getState={desktopZoom.getState}
              subscribe={desktopZoom.subscribe}
              onChange={desktopZoom.setPercent}
              onReset={desktopZoom.reset}
              tones={tones}
            />
          )}
        </div>
      )}

      {/* Comment panel (toggled from the top toolbar; works in admin + collaboration) */}
      {showCommentToggle && showComments && !immersive && (
        <CommentPanel
          imageId={image.id}
          shareToken={shareToken}
          galleryToken={galleryToken}
          adminGalleryId={adminGalleryId}
          annoNumbers={annoNumbers}
          hoveredId={hoveredAnno}
          onHover={handleAnnoHover}
          tones={tones}
        />
      )}

      {/* EXIF panel */}
      {!immersive && showExif && exif && (() => {
        const make = exif.Make as string | undefined;
        const model = exif.Model as string | undefined;
        const focal = exif.FocalLength as number | undefined;
        const fnum = exif.FNumber as number | undefined;
        const exp = exif.ExposureTime as number | undefined;
        const iso = exif.ISOSpeedRatings as number | undefined;
        return (
          <div className={`px-4 py-3 border-t ${borderTone} text-xs ${muted} flex gap-4 flex-wrap flex-shrink-0`}>
            {make && model && <span>{make} {model}</span>}
            {focal != null && <span>{Number(focal).toFixed(0)}mm</span>}
            {fnum != null && <span>f/{Number(fnum).toFixed(1)}</span>}
            {exp != null && <span>1/{Math.round(1 / Number(exp))}s</span>}
            {iso != null && <span>ISO {iso}</span>}
            {image.width && image.height && (
              <span>{image.width} × {image.height}px</span>
            )}
          </div>
        );
      })()}

      {/* IPTC panel — editorial metadata (title/caption/keywords/creator/rights/location) */}
      {!immersive && showIptc && hasIptc && (() => {
        const str = (k: string) => (typeof iptc![k] === "string" ? (iptc![k] as string) : undefined);
        const keywords = Array.isArray(iptc!.keywords) ? (iptc!.keywords as string[]) : [];
        const location = [str("city"), str("state"), str("country")].filter(Boolean).join(", ");
        const rows: { label: string; value: string }[] = [];
        if (str("title")) rows.push({ label: ti("title"), value: str("title")! });
        if (str("headline")) rows.push({ label: ti("headline"), value: str("headline")! });
        if (str("description")) rows.push({ label: ti("caption"), value: str("description")! });
        if (str("creator")) rows.push({ label: ti("creator"), value: str("creator")! });
        if (str("copyright")) rows.push({ label: ti("copyright"), value: `© ${str("copyright")}` });
        if (str("credit")) rows.push({ label: ti("credit"), value: str("credit")! });
        if (location) rows.push({ label: ti("location"), value: location });
        return (
          <div className={`px-4 py-3 border-t ${borderTone} text-xs ${muted} flex flex-col gap-1.5 flex-shrink-0 max-h-48 overflow-y-auto`}>
            {rows.map((r) => (
              <div key={r.label} className="flex gap-2">
                <span className={`${faint} shrink-0 w-20`}>{r.label}</span>
                <span className="min-w-0 break-words">{r.value}</span>
              </div>
            ))}
            {keywords.length > 0 && (
              <div className="flex gap-2">
                <span className={`${faint} shrink-0 w-20`}>{ti("keywords")}</span>
                <span className="flex flex-wrap gap-1">
                  {keywords.map((kw) => (
                    <span key={kw} className={`px-1.5 py-0.5 rounded ${chipBg}`}>{kw}</span>
                  ))}
                </span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Filename / annotate hint — hidden in immersive mode. The annotate hint always shows while
          annotating; the filename row obeys the per-gallery `showFilename` toggle. The row is always
          reserved (when chrome is visible) with a non-breaking-space placeholder when there's no
          text, so the image keeps the same bottom margin whether or not a caption is shown — instead
          of running to the bottom edge when the caption is off. */}
      {!immersive && (
        <div
          className={`px-4 py-2 flex-shrink-0 ${bottomBare ? "grid content-center" : ""}`}
          style={bottomBare && topBarH > 0 ? { minHeight: topBarH } : undefined}
        >
          {annotating ? (
            <p className={`text-xs text-center truncate ${strong}`}>{ta("hint")}</p>
          ) : showFilename ? (
            <p className={`text-xs ${faint} text-center truncate`}>{image.original_filename}</p>
          ) : (
            <p className="text-xs text-center truncate select-none" aria-hidden>&nbsp;</p>
          )}
        </div>
      )}

      {/* Reviewer name prompt — gates entering annotate mode (collaboration) */}
      {needName && (
        <ReviewerNamePrompt
          title={ta("namePromptTitle")}
          body={ta("namePromptBody")}
          submitLabel={ta("namePromptSubmit")}
          onConfirmed={() => {
            setNeedName(false);
            setAnnotating(true);
            setShowAnnotations(true);
            setShowComments(true);
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDeleteAnno !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteAnno(null); }}
        title={ta("deleteConfirm")}
        confirmLabel={tc("delete")}
        destructive
        pending={deleteAnnotation.isPending}
        onConfirm={confirmDeleteAnno}
      />
    </div>
  );
}
