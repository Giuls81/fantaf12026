// MyDriverCard — scenic showcase using AI-generated line-art silhouettes
// of a racing driver (front view) and an F1 car (side view) as bases.
// The user's suit pattern is multiplied over the driver, masked to the
// driver's alpha so the pattern stays inside the silhouette. Same for
// the livery on the car. The user's helmet PNG is overlaid on top of
// the driver's head, covering the line-art helmet from the AI image.
//
// Source art in /scene/driver.png and /scene/car.png (web/public/scene/).
//
// Added 2026-04-17 — Phase 4b.
// Rewritten 2026-04-21 with AI-generated scene art.

import React from 'react';
import CosmeticSlot from './CosmeticSlot';
import { getCosmeticById } from '../services/cosmetics';
import type { EquippedCosmetics } from '../types';

type Translator = (dict: Record<string, string>) => string;

interface MyDriverCardProps {
  equipped: EquippedCosmetics | null;
  t: Translator;
  onClick?: () => void;
}

const DRIVER_SRC = '/scene/driver.png';
const CAR_SRC = '/scene/car.png';

// Pattern masks exclude dark details (tyres, visor, gloves, boots, exhausts)
// so the suit / livery pattern only fills the paintable bodywork. The visual
// base image still displays those dark details untouched — the mask is
// applied only to the pattern overlay layer.
const DRIVER_MASK = '/scene/driver-bodymask.png';
const CAR_MASK = '/scene/car-bodymask.png';

const MyDriverCard: React.FC<MyDriverCardProps> = ({ equipped, t, onClick }) => {
  const emblemId = equipped?.emblemProductId ?? null;
  const helmetId = equipped?.helmetProductId ?? null;
  const suitId = equipped?.suitProductId ?? null;
  const colorId = equipped?.colorProductId ?? null;
  const liveryId = equipped?.liveryProductId ?? null;

  const colorItem = getCosmeticById(colorId);
  const accentHex = colorItem?.swatchHex ?? '#64748B';

  const clickable = typeof onClick === 'function';

  // Pattern-fill style for the suit/livery overlay. Uses the scene PNG as
  // an alpha mask so the pattern stays inside the silhouette, and
  // mix-blend-mode multiply so underlying outlines / shading still show.
  const maskOverlayStyle = (patternPath: string, maskPath: string): React.CSSProperties => ({
    position: 'absolute',
    inset: 0,
    backgroundImage: `url(${patternPath})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    mixBlendMode: 'multiply',
    WebkitMaskImage: `url(${maskPath})`,
    maskImage: `url(${maskPath})`,
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    pointerEvents: 'none',
  });

  return (
    <div
      onClick={onClick}
      className={
        'relative rounded-2xl border border-slate-700 overflow-hidden bg-slate-900 ' +
        (clickable ? 'cursor-pointer hover:border-slate-500 transition-colors' : '')
      }
      style={{ boxShadow: `inset 0 0 80px -20px ${accentHex}33` }}
    >
      {/* Header row — only the label; emblem moved next to the driver below */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: accentHex }}>
          {t({ en: 'Your style', it: 'Il tuo stile', fr: 'Votre style', de: 'Dein Style', es: 'Tu estilo', ru: 'Ваш стиль', zh: '你的风格', ar: 'أسلوبك', ja: 'あなたのスタイル' })}
        </span>
      </div>

      {/* Scene container */}
      <div className="relative mx-3 mb-2 rounded-xl bg-gradient-to-b from-slate-950/40 via-slate-900/30 to-slate-950/60 border border-slate-800 overflow-hidden" style={{ aspectRatio: '4 / 5' }}>
        {/* Emblem — bigger, next to the driver on the left side at chest height */}
        <div className="absolute left-[6%] top-[15%] z-10">
          {emblemId ? (
            <CosmeticSlot
              productId={emblemId}
              size={72}
              title={t({ en: 'Emblem', it: 'Emblema' })}
            />
          ) : (
            <svg
              width={72}
              height={72}
              viewBox="0 0 72 72"
              aria-label={t({ en: 'Emblem (none equipped)', it: 'Emblema (nessuno equipaggiato)' })}
            >
              <circle cx="36" cy="36" r="31" fill="#475569" stroke="#1E293B" strokeWidth="3" />
              <circle cx="36" cy="36" r="22" fill="none" stroke="#64748B" strokeWidth="1.5" />
              <circle cx="36" cy="36" r="5" fill="#94A3B8" />
            </svg>
          )}
        </div>

        {/* --- Driver: centered, occupies roughly the top 70% of the scene --- */}
        <div className="absolute top-0 left-0 right-0 bottom-[38%] flex items-start justify-center pt-2">
          <div className="relative h-full" style={{ aspectRatio: '832 / 1216' }}>
            {/* Base driver art */}
            <img
              src={DRIVER_SRC}
              alt=""
              className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
              draggable={false}
            />
            {/* Suit pattern multiplied + masked to driver body-only alpha */}
            {suitId && (
              <div
                style={maskOverlayStyle(`/cosmetics/${suitId}@256.png`, DRIVER_MASK)}
                aria-hidden
              />
            )}
            {/* User's helmet — sits on the shoulders, bottom of helmet
                faded to hide the PNG crop edge. When nothing is equipped
                we render a neutral helmet silhouette SVG instead of the
                default CosmeticSlot "HL" letters. */}
            <div
              className="absolute left-1/2 -translate-x-1/2"
              style={{
                top: '-4%',
                WebkitMaskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)',
                maskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)',
              }}
            >
              {helmetId ? (
                <CosmeticSlot
                  productId={helmetId}
                  size={96}
                  title={t({ en: 'Helmet', it: 'Casco' })}
                />
              ) : (
                <img
                  src="/scene/helmet-placeholder.png"
                  width={96}
                  height={96}
                  alt=""
                  draggable={false}
                  style={{ objectFit: 'contain' }}
                  title={t({ en: 'Helmet (none equipped)', it: 'Casco (nessuno equipaggiato)' })}
                />
              )}
            </div>
          </div>
        </div>

        {/* --- Car: bottom strip, full width --- */}
        <div className="absolute left-0 right-0 bottom-0 h-[38%]">
          <div className="relative w-full h-full">
            <img
              src={CAR_SRC}
              alt=""
              className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
              draggable={false}
            />
            {liveryId && (
              <div
                style={maskOverlayStyle(`/cosmetics/${liveryId}@256.png`, CAR_MASK)}
                aria-hidden
              />
            )}
          </div>
        </div>

        {/* Tiny floor shadow between driver and car */}
        <div className="absolute left-[15%] right-[15%] bottom-[38%] h-[2px] rounded-full"
             style={{ background: `radial-gradient(ellipse at center, ${accentHex}55 0%, transparent 70%)` }} />
      </div>

      {/* Accent colour bar + edit hint */}
      <div className="px-4 pb-3 flex items-center gap-2">
        <div
          className="h-1.5 flex-1 rounded-full"
          style={{ backgroundColor: accentHex, boxShadow: `0 0 8px ${accentHex}66` }}
        />
        {clickable && (
          <span className="text-[10px] text-slate-500">
            {t({ en: 'Edit', it: 'Modifica', fr: 'Modifier', de: 'Bearbeiten', es: 'Editar', ru: 'Изменить', zh: '编辑', ar: 'تعديل', ja: '編集' })} →
          </span>
        )}
      </div>
    </div>
  );
};

export default MyDriverCard;
