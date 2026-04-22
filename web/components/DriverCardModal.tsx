// DriverCardModal — full-screen overlay showing another user's MyDriverCard.
// Used from the Standings tab to "inspect" a league member's driver scene.
//
// Added 2026-04-22 — Phase 4c (social showcase).

import React from 'react';
import MyDriverCard from './MyDriverCard';
import type { EquippedCosmetics, LeagueStanding } from '../types';

type Translator = (dict: Record<string, string>) => string;

interface DriverCardModalProps {
  standing: LeagueStanding | null;
  t: Translator;
  onClose: () => void;
}

const DriverCardModal: React.FC<DriverCardModalProps> = ({ standing, t, onClose }) => {
  if (!standing) return null;

  const equipped: EquippedCosmetics = {
    teamId: standing.teamId ?? '',
    leagueId: '',
    emblemProductId: standing.emblemProductId,
    helmetProductId: standing.helmetProductId,
    suitProductId: standing.suitProductId,
    colorProductId: standing.colorProductId,
    liveryProductId: standing.liveryProductId,
  };

  const rankBadgeColor =
    standing.rank === 1
      ? 'bg-yellow-500 text-black'
      : standing.rank === 2
        ? 'bg-slate-300 text-black'
        : standing.rank === 3
          ? 'bg-orange-600 text-white'
          : 'bg-slate-700 text-slate-300';

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with rank + name + close button */}
        <div className="flex items-center gap-3 mb-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-base ${rankBadgeColor}`}
          >
            {standing.rank}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-bold truncate">{standing.userName}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
              {Number(standing.totalPoints).toFixed(1)}{' '}
              {t({
                en: 'pts',
                it: 'pt',
                fr: 'pts',
                de: 'Pkt',
                es: 'pts',
                ru: 'очк',
                zh: '分',
                ar: 'نقطة',
                ja: '点',
              })}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center text-lg"
            aria-label={t({ en: 'Close', it: 'Chiudi', fr: 'Fermer', de: 'Schließen', es: 'Cerrar', ru: 'Закрыть', zh: '关闭', ar: 'إغلاق', ja: '閉じる' })}
          >
            ×
          </button>
        </div>

        {/* The reusable scene */}
        <MyDriverCard equipped={equipped} t={t} />
      </div>
    </div>
  );
};

export default DriverCardModal;
