// StandingPodium — top-3 showcase at the head of the Standings tab.
// Each podium slot renders a compact MyDriverCard for the team, so the
// customization (helmet, suit, livery, emblem, accent colour) is immediately
// visible to every league member. Clicking a card opens the full scene modal.
//
// Added 2026-04-22 — Phase 4c (social showcase).

import React from 'react';
import MyDriverCard from './MyDriverCard';
import type { EquippedCosmetics, LeagueStanding } from '../types';

type Translator = (dict: Record<string, string>) => string;

interface StandingPodiumProps {
  top: LeagueStanding[];
  t: Translator;
  onCardClick: (standing: LeagueStanding) => void;
  currentUserId?: string | null;
}

const toEquipped = (s: LeagueStanding): EquippedCosmetics => ({
  teamId: s.teamId ?? '',
  leagueId: '',
  emblemProductId: s.emblemProductId,
  helmetProductId: s.helmetProductId,
  suitProductId: s.suitProductId,
  colorProductId: s.colorProductId,
  liveryProductId: s.liveryProductId,
});

const rankStyles: Record<number, { ring: string; badge: string; label: string }> = {
  1: { ring: 'ring-yellow-400/80', badge: 'bg-yellow-500 text-black', label: 'text-yellow-300' },
  2: { ring: 'ring-slate-300/70', badge: 'bg-slate-300 text-black', label: 'text-slate-200' },
  3: { ring: 'ring-orange-500/70', badge: 'bg-orange-600 text-white', label: 'text-orange-300' },
};

const StandingPodium: React.FC<StandingPodiumProps> = ({ top, t, onCardClick, currentUserId }) => {
  if (top.length === 0) return null;

  // Natural rank order: 1 — 2 — 3 left-to-right. This matches classifica
  // order and avoids the "silver left / gold centre" visual that confuses
  // users expecting 1st place to appear first.
  const ordered: LeagueStanding[] = top;

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
          <span className="text-lg">🏁</span>
          {t({
            en: 'Podium',
            it: 'Podio',
            fr: 'Podium',
            de: 'Podium',
            es: 'Podio',
            ru: 'Подиум',
            zh: '领奖台',
            ar: 'المنصة',
            ja: '表彰台',
          })}
        </h2>
        <span className="text-[10px] text-slate-500 uppercase tracking-widest">
          {t({
            en: 'Tap a card',
            it: 'Tocca una card',
            fr: 'Appuyez',
            de: 'Antippen',
            es: 'Pulsa',
            ru: 'Нажмите',
            zh: '点击',
            ar: 'اضغط',
            ja: 'タップ',
          })}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {ordered.map((s) => {
          const style = rankStyles[s.rank] ?? rankStyles[3];
          const isMe = currentUserId != null && s.userId === currentUserId;
          return (
            <div key={s.userId} className="relative">
              {/* Rank badge overlay */}
              <div
                className={`absolute -top-2 -left-2 z-20 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center font-bold text-sm sm:text-base shadow-lg ${style.badge}`}
              >
                {s.rank}
              </div>

              {/* "TU" chip if it's the current user */}
              {isMe && (
                <div className="absolute -top-2 right-1 z-20 text-[9px] sm:text-[10px] font-bold bg-blue-500 text-white px-1.5 sm:px-2 py-0.5 rounded-full shadow">
                  {t({ en: 'YOU', it: 'TU', fr: 'TOI', de: 'DU', es: 'TÚ', ru: 'ТЫ', zh: '你', ar: 'أنت', ja: 'あなた' })}
                </div>
              )}

              <div
                className={`rounded-2xl ring-2 ${style.ring} overflow-hidden cursor-pointer`}
                onClick={() => onCardClick(s)}
              >
                <MyDriverCard equipped={toEquipped(s)} t={t} onClick={() => onCardClick(s)} compact />
              </div>

              {/* Footer strip with name + points */}
              <div className="mt-2 flex flex-col gap-0.5 px-1">
                <div className={`text-[11px] sm:text-xs font-bold truncate ${style.label}`}>
                  {s.userName}
                </div>
                <div className="text-xs sm:text-sm font-mono font-bold text-blue-300">
                  {Number(s.totalPoints).toFixed(1)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StandingPodium;
