// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, getErrorCode } from "@/lib/api";
import { getGalleryToken, setGalleryToken } from "@/lib/auth";
import { requiresPassword } from "@/lib/types";
import { PasswordGate } from "@/components/gallery/PasswordGate";
import { GalleryView } from "@/components/gallery/GalleryView";
import { GalleryExpired } from "@/components/gallery/GalleryExpired";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

export default function PublicGalleryPage() {
  const t = useTranslations("gallery");
  const { share_token } = useParams<{ share_token: string }>();
  const [galleryToken, setLocalGalleryToken] = useState<string | null>(null);
  const [tokenLoaded, setTokenLoaded] = useState(false);

  useEffect(() => {
    // Browser-storage read must run client-side after mount (no sessionStorage during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalGalleryToken(getGalleryToken(share_token));
    setTokenLoaded(true);
  }, [share_token]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["public-gallery", share_token, galleryToken],
    queryFn: () => api.public.getGallery(share_token, galleryToken ?? undefined),
    enabled: tokenLoaded,
    retry: false,
  });

  function handleAuthSuccess(jwt: string) {
    setGalleryToken(share_token, jwt);
    setLocalGalleryToken(jwt);
    refetch();
  }

  if (!tokenLoaded || isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 size={32} className="text-zinc-500 animate-spin" />
      </div>
    );
  }

  if (error && (getErrorCode(error) === "gallery_expired" || (error as { status?: number }).status === 410)) {
    return <GalleryExpired />;
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <p className="text-zinc-400">{t("notFound")}</p>
      </div>
    );
  }

  if (requiresPassword(data)) {
    // The root `dark` is dropped on /g/ (the gallery scope owns tone); the password gate predates
    // a known gallery tone, so it keeps its own dark surface here.
    return (
      <div className="dark">
        <PasswordGate shareToken={share_token} onSuccess={handleAuthSuccess} />
      </div>
    );
  }

  return <GalleryView gallery={data} shareToken={share_token} galleryToken={galleryToken ?? undefined} />;
}
