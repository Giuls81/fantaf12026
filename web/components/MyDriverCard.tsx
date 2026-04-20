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

      {/* Suit pattern — full-width strip */}
      <div
        className="mx-4 mb-2 h-10 rounded-lg border border-slate-700"
        style={suitBgStyle}
        title={t({ en: 'Suit', it: 'Tuta', fr: 'Combinaison', de: 'Anzug', es: 'Traje', ru: 'Комбинезон', zh: '赛服', ar: 'بدلة', ja: 'スーツ' })}
      />

      {/* Car livery — wider, asymmetric rounded corner hints at car nose */}
      <div className="mx-4 mb-3 relative">
        <div
          className="h-12 border border-slate-700 relative overflow-hidden"
          style={{
            ...liveryBgStyle,
            borderRadius: '6px 22px 6px 6px',
          }}
          title={t({ en: 'Car livery', it: 'Livrea auto', fr: 'Livrée voiture', de: 'Auto-Lackierung', es: 'Librea del coche', ru: 'Ливрея машины', zh: '赛车涂装', ar: 'طلاء السيارة', ja: 'カーリバリー' })}
        >
          {/* Wheel hint: two subtle dark circles at the bottom to suggest tyres */}
          <div className="absolute bottom-0 left-3 w-4 h-2 bg-slate-950/60 rounded-full" />
          <div className="absolute bottom-0 right-4 w-4 h-2 bg-slate-950/60 rounded-full" />
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
