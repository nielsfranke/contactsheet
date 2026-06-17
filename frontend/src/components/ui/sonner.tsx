// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { useDocumentTheme } from "@/hooks/useDocumentTheme"

const Toaster = ({ ...props }: ToasterProps) => {
  // Follow the real document theme (the `dark` class the app toggles), not next-themes — which is
  // never mounted, so useTheme() would resolve to the OS scheme instead of the instance theme.
  const theme = useDocumentTheme()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
        // Toast action button (e.g. Undo) picks up the instance accent; status colors stay via richColors.
        actionButtonStyle: {
          background: "var(--primary)",
          color: "var(--primary-foreground)",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
