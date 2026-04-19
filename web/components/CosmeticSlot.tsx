// Renders an owned cosmetic (emblem / helmet / suit / color) at a given size.
// Falls back to a placeholder if the PNG asset isn't available yet — this is
// intentional: the UI ships before the art is produced, and assets drop into
// web/public/cosmetics/ later without any code change needed.
//
// Size convention:
//   size <=  64 → requests {productId}@64.png  (small slot next to team name)
//   size <= 128 → requests {productId}@128.png (storefront tile)
//   size >  128 → requests {productId}@256.png (storefront hero / detail)
//
// Color cosmetics render from the catalog's swatchHex, no asset fetch needed.
//
// Added 2026-04-17 — Phase 4b.

import React, { useState } from 'react';
import { getCosmeticById } from '../services/cosmetics';

interface CosmeticSlotProps {
  productId: string | null;
  size: number;
  fallbackHex?: string; // Used when productId is null (e.g. constructor color)
  fallbackLabel?: string; // First letters shown on placeholder
  title?: string; // Hover tooltip
  className?: string;
}

const pickAssetSize = (size: number): 64 | 128 | 256 => {
  if (size <= 64) return 64;
  if (size <= 128) return 128;
  return 256;
};

const CosmeticSlot: React.FC<CosmeticSlotProps> = ({
  productId,
  size,
  fallbackHex,
  fallbackLabel,
  title,
  className,
}) => {
  const [imgBroken, setImgBroken] = useState(false);

  const catalogEntry = productId ? getCosmeticById(productId) : null;

  // Color category: render a solid disc, no asset.
  if (catalogEntry?.category === 'color' && catalogEntry.swatchHex) {
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: '9999px',
          backgroundColor: catalogEntry.swatchHex,
          border: '2px solid rgba(255,255,255,0.18)',
          boxShadow: 'inset 0 -4px 8px rgba(0,0,0,0.25)',
        }}
        title={title ?? catalogEntry.displayName}
        aria-label={catalogEntry.displayName}
      />
    );
  }

  // No productId → neutral fallback (used when user hasn't equipped anything)
  if (!productId || !catalogEntry) {
    const label = fallbackLabel || '·';
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: '9999px',
          backgroundColor: fallbackHex || '#334155', // slate-700
          color: '#E2E8F0',
          fontSize: Math.max(10, Math.floor(size * 0.4)),
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px solid rgba(255,255,255,0.12)',
          letterSpacing: '-0.02em',
        }}
        title={title ?? 'Default'}
        aria-label="No cosmetic equipped"
      >
        {label.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  // Image-based cosmetics (emblem, helmet, suit). Asset path convention:
  //   /cosmetics/{productId}@{64|128|256}.png
  // Asset files live in web/public/cosmetics/ and are bundled with the app.
  const assetSize = pickAssetSize(size);
  const src = `/cosmetics/${productId}@${assetSize}.png`;

  if (imgBroken) {
    // Asset missing — show placeholder with first 2 letters of display name
    const label = catalogEntry.displayName
      .split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: catalogEntry.category === 'suit' ? '8px' : '9999px',
          background: 'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)',
          color: '#94A3B8',
          fontSize: Math.max(10, Math.floor(size * 0.35)),
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px dashed rgba(148,163,184,0.3)',
        }}
        title={title ?? `${catalogEntry.displayName} (asset pending)`}
        aria-label={`${catalogEntry.displayName} (asset pending)`}
      >
        {label}
      </div>
    );
  }

  return (
    <img
      src={src}
      width={size}
      height={size}
      className={className}
      onError={() => setImgBroken(true)}
      alt={catalogEntry.displayName}
      title={title ?? catalogEntry.displayName}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        borderRadius: catalogEntry.category === 'suit' ? '8px' : undefined,
      }}
    />
  );
};

export default CosmeticSlot;
