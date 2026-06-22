// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Concept → icon registry. The single source of truth for which lucide glyph represents an
 * app-wide concept, so the same idea never renders as two different icons across surfaces.
 *
 * Import the concept, not the glyph: `import { Icons } from "@/lib/ui-icons"` then `<Icons.annotation />`.
 * Raw lucide imports stay fine for one-off icons that carry no cross-surface meaning.
 *
 * Mirrors the registry pattern of `gallery-fonts.ts` — one definition, many consumers.
 */
import {
  MessageCircle,
  PenLine,
  Pencil,
  Heart,
  Download,
  Pin,
  Layers,
  ArrowUpRight,
  Lock,
  Users,
  Presentation,
  Spline,
  Images,
  Play,
  FileImage,
  Star,
} from "lucide-react";

export const Icons = {
  /** A plain (unanchored) comment. */
  comment: MessageCircle,
  /** An annotation = a comment with a spatial anchor (the freehand pen). */
  annotation: PenLine,
  /** Edit / rename. Distinct from `annotation` — frees Pencil from its former double-duty. */
  rename: Pencil,
  /** Like / favourite. */
  like: Heart,
  /** Download original. */
  download: Download,
  /** Pin a gallery to the top shelf. */
  pin: Pin,
  /** A gallery that contains sub-galleries. */
  subGallery: Layers,
  /** Open / jump to the detail page. */
  open: ArrowUpRight,
  /** Password-protected. */
  locked: Lock,
  /** Collaboration ("Review") mode. */
  modeReview: Users,
  /** Presentation ("Showcase") mode. */
  modeShowcase: Presentation,
  /** Reveal-annotations toggle in the lightbox. */
  showAnnotations: Spline,
  /** Generic photo / image placeholder. */
  photo: Images,
  /** Video play badge. */
  play: Play,
  /** A stored file with no viewable preview (e.g. a PSB without an embedded thumbnail). */
  noPreviewFile: FileImage,
  /** Star rating (the stars-mode alternative to color flags). */
  rating: Star,
} as const;

export type IconName = keyof typeof Icons;
