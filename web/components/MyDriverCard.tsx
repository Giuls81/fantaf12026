// MyDriverCard — compact "showcase" component that shows all 4 cosmetic
// categories the user has equipped in one visible scene on the HOME tab.
//
// Layout (top → bottom):
//   - tiny label "YOUR STYLE" + emblem badge in the top-right corner
//   - centered helmet icon
//   - suit pattern strip (full-width rectangle filled with the suit image)
//   - thin accent-color bar at the bottom
//
// Uses the equipped team cosmetics; falls back to placeholders for any
// slot the user hasn't equipped yet (CosmeticSlot handles that).
//
// Added 2026-04-20.

import React from 'react';
import CosmeticSlot from './CosmeticSlot';
import { getCosmeticById } from '../services/cosmetics';
import type { EquippedCosmetics } from '../types';

type Translator = (dict: Record<string, string>) => string;

interface MyDriverCardProps {
  equipped: EquippedCosmetics | null;
  t: Translator;
  onClick?: () => void; // optional — opens the storefront
}

const MyDriverCard: React.FC<MyDriverCardProps> = ({ equipped, t, onClick }) => {
  const emblemId = equipped?.emblemProductId ?? null;
  const helmetId = equipped?.helmetProductId ?? null;
  const suitId = equipped?.suitProductId ?? null;
  const colorId = equipped?.colorProductId ?? null;
  const liveryId = equipped?.liveryProductId ?? null;

  const colorItem = getCosmeticById(colorId);
  const accentHex = colorItem?.swatchHex ?? '#64748B'; // slate-500 fallback

  // Suit: render as a CSS background-image so we can shape it as a strip
  // rather than a fixed square. Null → gradient fallback.
  const suitBgStyle: React.CSSProperties = suitId
    ? {
        backgroundImage: `url(/cosmetics/${suitId}@256.png)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    : {
        background:
          'linear-gradient(135deg, rgba(51,65,85,0.6) 0%, rgba(15,23,42,0.6) 100%)',
      };

  // Livery: wider + asymmetric rounded corner on the right to hint at a
  // car's nose profile. Same background fallback pattern as suit.
  const liveryBgStyle: React.CSSProperties = liveryId
    ? {
        backgroundImage: `url(/cosmetics/${liveryId}@256.png)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    : {
        background:
          'linear-gradient(90deg, rgba(30,41,59,0.7) 0%, rgba(71,85,105,0.7) 100%)',
      };

  const clickable = typeof onClick === 'function';

  return (
    <div
      onClick={onClick}
      className={
        'relative rounded-2xl border border-slate-700 overflow-hidden bg-slate-900 ' +
        (clickable ? 'cursor-pointer hover:border-slate-500 transition-colors' : '')
      }
      style={{
        // Soft radial tint from accent colour in the background
        boxShadow: `inset 0 0 80px -20px ${accentHex}33`,
      }}
    >
      {/* Header row: label + emblem badge */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span
          className="text-[10px] font-bold tracking-widest uppercase"
          style={{ color: accentHex }}
        >
          {t({
            en: 'Your style',
            it: 'Il tuo stile',
            fr: 'Votre style',
            de: 'Dein Style',
            es: 'Tu estilo',
            ru: 'Ваш стиль',
            zh: '你的风格',
            ar: 'أسلوبك',
            ja: 'あなたのスタイル',
          })}
        </span>
        <CosmeticSlot
          productId={emblemId}
          size={32}
          fallbackHex="#1E293B"
          fallbackLabel="·"
          title={t({ en: 'Emblem', it: 'Emblema', fr: 'Emblème', de: 'Emblem', es: 'Emblema', ru: 'Эмблема', zh: '徽章', ar: 'شعار', ja: 'エンブレム' })}
        />
      </div>

      {/* Helmet — centered, prominent */}
      <div className="flex justify-center pt-2 pb-3">
        <CosmeticSlot
          productId={helmetId}
          size={80}
          fallbackHex="#1E293B"
          fallbackLabel="HL"
          title={t({ en: 'Helmet', it: 'Casco', fr: 'Casque', de: 'Helm', es: 'Casco', ru: 'Шлем', zh: '头盔', ar: 'خوذة', ja: 'ヘルメット' })}
        />
      </div>

      {/* Suit pattern — wrapped in a vest-like V-neck silhouette + label */}
      <div className="mx-4 mb-3 relative">
        <div
          className="h-14 border border-slate-700 relative overflow-hidden rounded-lg"
          style={suitBgStyle}
          title={t({ en: 'Suit', it: 'Tuta', fr: 'Combinaison', de: 'Anzug', es: 'Traje', ru: 'Комбинезон', zh: '赛服', ar: 'بدلة', ja: 'スーツ' })}
        >
          {/* V-neck hint at the top center, shoulders rounded */}
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-3 bg-slate-900/80"
            style={{ clipPath: 'polygon(0 0, 100% 0, 60% 100%, 40% 100%)' }}
          />
          {/* Label pill */}
          <div className="absolute top-1 left-2 bg-slate-950/75 px-2 py-0.5 rounded text-[9px] font-bold tracking-wider text-slate-100 uppercase">
            🧥 {t({ en: 'Suit', it: 'Tuta', fr: 'Combinaison', de: 'Anzug', es: 'Traje', ru: 'Костюм', zh: '赛服', ar: 'بدلة', ja: 'スーツ' })}
          </div>
        </div>
      </div>

      {/* Car livery — shaped like an F1 side profile: cockpit bump,
          rear wing, bigger tyres + front nose cone */}
      <div className="mx-4 mb-3 relative">
        <div
          className="h-16 border border-slate-700 relative overflow-hidden"
          style={{
            ...liveryBgStyle,
            // Shape: flat bottom, rising cockpit bump, rear wing, tapered nose
            clipPath:
              'polygon(0% 75%, 0% 55%, 8% 55%, 10% 25%, 12% 20%, 50% 20%, 55% 40%, 80% 40%, 92% 50%, 100% 65%, 100% 75%, 90% 75%, 87% 85%, 78% 85%, 75% 75%, 25% 75%, 22% 85%, 13% 85%, 10% 75%)',
          }}
          title={t({ en: 'Car livery', it: 'Livrea auto', fr: 'Livrée voiture', de: 'Auto-Lackierung', es: 'Librea del coche', ru: 'Ливрея машины', zh: '赛车涂装', ar: 'طلاء السيارة', ja: 'カーリバリー' })}
        />
        {/* Two visible tyres overlaid on top (not clipped) */}
        <div className="absolute bottom-0 left-[11%] w-5 h-5 bg-slate-950 rounded-full border-2 border-slate-800" />
        <div className="absolute bottom-0 right-[16%] w-5 h-5 bg-slate-950 rounded-full border-2 border-slate-800" />
        {/* Label pill */}
        <div className="absolute top-1 left-2 bg-slate-950/75 px-2 py-0.5 rounded text-[9px] font-bold tracking-wider text-slate-100 uppercase">
          🏎️ {t({ en: 'Livery', it: 'Livrea', fr: 'Livrée', de: 'Lackierung', es: 'Librea', ru: 'Ливрея', zh: '涂装', ar: 'طلاء', ja: 'リバリー' })}
        </div>
      </div>

      {/* Accent colour bar */}
      <div className="px-4 pb-3 flex items-center gap-2">
        <div
          className="h-1.5 flex-1 rounded-full"
          style={{ backgroundColor: accentHex, boxShadow: `0 0 8px ${accentHex}66` }}
        />
        {clickable && (
          <span className="text-[10px] text-slate-500">
            {t({
              en: 'Edit',
              it: 'Modifica',
              fr: 'Modifier',
              de: 'Bearbeiten',
              es: 'Editar',
              ru: 'Изменить',
              zh: '编辑',
              ar: 'تعديل',
              ja: '編集',
            })} →
          </span>
        )}
      </div>
    </div>
  );
};

export default MyDriverCard;
