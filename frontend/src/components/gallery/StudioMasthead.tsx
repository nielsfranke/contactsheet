// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Studio identity (logo + instance name) shown in the client gallery header. */
export function StudioMasthead({
  name, logoUrl, className = "", textClassName = "",
}: { name: string; logoUrl: string | null; className?: string; textClassName?: string }) {
  return (
    <div className={`flex items-center gap-2 min-w-0 ${className}`}>
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={name} draggable={false} className="h-6 w-auto max-w-[160px] object-contain select-none" />
      )}
      <span className={`font-semibold truncate ${textClassName}`}>{name}</span>
    </div>
  );
}
