// Cosmetics storefront modal. Opens over the app, shows the four slot
// categories + the starter bundle + the season pass.
//
// Purchase flow: user taps Buy → RevenueCat sheet opens → on success, the
// server webhook grants ownership and the modal polls /me/cosmetics until
// the new row appears (up to ~20s across retries), then updates state.
//
// Added 2026-04-17 — Phase 4b.

import React, { useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import CosmeticSlot from './CosmeticSlot';
import {
  COSMETIC_CATALOG,
  CosmeticItem,
  buyCosmeticAndRefresh,
  equipCosmetic,
  getCosmeticsByCategory,
} from '../services/cosmetics';
import type {
  CosmeticCategory,
  CosmeticsState,
  EquippedCosmetics,
} from '../types';

interface StorefrontProps {
  isOpen: boolean;
  onClose: () => void;
  state: CosmeticsState | null;
  equippedForTeam: EquippedCosmetics | null;
  teamId: string | null;
  onStateChange: (next: CosmeticsState) => void;
}

type BusyState =
  | { kind: 'idle' }
  | { kind: 'buying'; productId: string }
  | { kind: 'equipping'; productId: string };

const CATEGORY_ORDER: { key: CosmeticCategory; label: string; tileSize: number; columns: number }[] = [
  { key: 'emblem', label: 'Emblemi', tileSize: 64, columns: 4 },
  { key: 'helmet', label: 'Caschi', tileSize: 64, columns: 4 },
  { key: 'suit', label: 'Tute', tileSize: 72, columns: 3 },
  { key: 'color', label: 'Colori', tileSize: 56, columns: 4 },
];

const formatPrice = (eur: number): string =>
  `€${eur.toFixed(2).replace('.', ',')}`;

const Storefront: React.FC<StorefrontProps> = ({
  isOpen,
  onClose,
  state,
  equippedForTeam,
  teamId,
  onStateChange,
}) => {
  const [busy, setBusy] = useState<BusyState>({ kind: 'idle' });
  const [flash, setFlash] = useState<string | null>(null);

  const ownedIds = useMemo(
    () => new Set((state?.owned || []).map((o) => o.productId)),
    [state],
  );

  const isNative = Capacitor.getPlatform() !== 'web';

  if (!isOpen) return null;

  const handleBuy = async (item: CosmeticItem) => {
    if (!isNative) {
      setFlash('Gli acquisti sono disponibili solo nell\'app mobile.');
      setTimeout(() => setFlash(null), 3000);
      return;
    }
    setBusy({ kind: 'buying', productId: item.productId });
    setFlash(null);
    try {
      const result = await buyCosmeticAndRefresh(item.productId);
      if (result.ok) {
        onStateChange(result.state);
        setFlash(`✓ Sbloccato: ${item.displayName}`);
      } else if (result.reason === 'user_cancelled') {
        // Silent
      } else if (result.reason === 'not_found') {
        setFlash('Prodotto non disponibile nello store. Riprova tra qualche minuto.');
      } else if (result.reason === 'webhook_timeout' && result.state) {
        // Grant may still land; show current state anyway
        onStateChange(result.state);
        setFlash('Acquisto in elaborazione — controlla tra un minuto.');
      } else {
        setFlash('Acquisto non riuscito. Riprova.');
      }
    } catch (e) {
      console.error('handleBuy error', e);
      setFlash('Acquisto non riuscito. Riprova.');
    } finally {
      setBusy({ kind: 'idle' });
      setTimeout(() => setFlash(null), 4000);
    }
  };

  const handleEquip = async (item: CosmeticItem) => {
    if (!teamId) return;
    if (item.category === 'bundle' || item.category === 'pass') return;
    setBusy({ kind: 'equipping', productId: item.productId });
    try {
      await equipCosmetic(teamId, item.category, item.productId);
      // Optimistic local update (state change reflected on next refetch)
      if (equippedForTeam && state) {
        const field =
          item.category === 'emblem' ? 'emblemProductId' :
          item.category === 'helmet' ? 'helmetProductId' :
          item.category === 'suit'   ? 'suitProductId'   :
          'colorProductId';
        const nextEquipped = state.equipped.map((e) =>
          e.teamId === teamId ? { ...e, [field]: item.productId } : e,
        );
        onStateChange({ ...state, equipped: nextEquipped });
      }
      setFlash(`Equipaggiato: ${item.displayName}`);
    } catch (e) {
      console.error('handleEquip error', e);
      setFlash('Impossibile equipaggiare.');
    } finally {
      setBusy({ kind: 'idle' });
      setTimeout(() => setFlash(null), 3000);
    }
  };

  const handleUnequip = async (category: CosmeticCategory) => {
    if (!teamId) return;
    try {
      await equipCosmetic(teamId, category, null);
      if (equippedForTeam && state) {
        const field =
          category === 'emblem' ? 'emblemProductId' :
          category === 'helmet' ? 'helmetProductId' :
          category === 'suit'   ? 'suitProductId'   :
          'colorProductId';
        const nextEquipped = state.equipped.map((e) =>
          e.teamId === teamId ? { ...e, [field]: null } : e,
        );
        onStateChange({ ...state, equipped: nextEquipped });
      }
    } catch (e) {
      console.error('handleUnequip error', e);
    }
  };

  const isEquipped = (item: CosmeticItem): boolean => {
    if (!equippedForTeam) return false;
    if (item.category === 'emblem') return equippedForTeam.emblemProductId === item.productId;
    if (item.category === 'helmet') return equippedForTeam.helmetProductId === item.productId;
    if (item.category === 'suit') return equippedForTeam.suitProductId === item.productId;
    if (item.category === 'color') return equippedForTeam.colorProductId === item.productId;
    return false;
  };

  const seasonPass = COSMETIC_CATALOG.find(
    (c) => c.productId === 'fantaf1.cosmetic.pass.season2026',
  );
  const starterBundle = COSMETIC_CATALOG.find(
    (c) => c.productId === 'fantaf1.cosmetic.bundle.starter',
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-slate-900 text-slate-100 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold">Personalizza il tuo team</h2>
            <p className="text-xs text-slate-400">Emblemi, caschi, tute, colori</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center"
            aria-label="Chiudi"
          >
            ✕
          </button>
        </div>

        {/* Season pass hero */}
        {seasonPass && !ownedIds.has(seasonPass.productId) && (
          <div className="m-3 p-4 rounded-xl bg-gradient-to-br from-amber-500/20 via-pink-500/20 to-purple-600/20 border border-amber-500/40">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-amber-300 uppercase tracking-wide">
                  Season Pass 2026
                </div>
                <div className="text-base font-bold">Sblocca tutto subito</div>
                <div className="text-xs text-slate-300 mt-1">
                  Tutti gli emblemi, caschi, tute e colori del catalogo 2026.
                </div>
              </div>
              <button
                onClick={() => handleBuy(seasonPass)}
                disabled={busy.kind === 'buying'}
                className="shrink-0 px-3 py-2 rounded-lg bg-amber-400 text-slate-950 font-bold text-sm disabled:opacity-60"
              >
                {busy.kind === 'buying' && busy.productId === seasonPass.productId
                  ? '...'
                  : formatPrice(seasonPass.priceEur)}
              </button>
            </div>
          </div>
        )}
        {seasonPass && ownedIds.has(seasonPass.productId) && (
          <div className="mx-3 my-2 px-3 py-2 rounded-lg bg-emerald-600/20 border border-emerald-600/40 text-xs text-emerald-300 font-semibold">
            ✓ Season Pass attivo — tutti i cosmetici sbloccati
          </div>
        )}

        {/* Starter bundle (only shown if pass not owned) */}
        {starterBundle && !ownedIds.has(starterBundle.productId) &&
          seasonPass && !ownedIds.has(seasonPass.productId) && (
          <div className="mx-3 mb-3 p-3 rounded-xl bg-slate-800/60 border border-slate-700">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Bundle starter
                </div>
                <div className="text-sm font-bold">10 cosmetici selezionati</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  4 emblemi · 4 caschi · 2 colori
                </div>
              </div>
              <button
                onClick={() => handleBuy(starterBundle)}
                disabled={busy.kind === 'buying'}
                className="shrink-0 px-3 py-2 rounded-lg bg-slate-200 text-slate-900 font-bold text-sm disabled:opacity-60"
              >
                {formatPrice(starterBundle.priceEur)}
              </button>
            </div>
          </div>
        )}

        {/* Flash message */}
        {flash && (
          <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200">
            {flash}
          </div>
        )}

        {/* Category grids */}
        <div className="overflow-y-auto px-3 pb-4" style={{ overscrollBehavior: 'contain' }}>
          {CATEGORY_ORDER.map(({ key, label, tileSize, columns }) => {
            const items = getCosmeticsByCategory(key);
            if (items.length === 0) return null;
            return (
              <section key={key} className="mt-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-slate-200">{label}</h3>
                  {equippedForTeam &&
                    ((key === 'emblem' && equippedForTeam.emblemProductId) ||
                      (key === 'helmet' && equippedForTeam.helmetProductId) ||
                      (key === 'suit' && equippedForTeam.suitProductId) ||
                      (key === 'color' && equippedForTeam.colorProductId)) && (
                      <button
                        onClick={() => handleUnequip(key)}
                        className="text-[11px] text-slate-400 hover:text-slate-200 underline"
                      >
                        rimuovi
                      </button>
                    )}
                </div>
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                >
                  {items.map((item) => {
                    const owned = ownedIds.has(item.productId);
                    const equipped = isEquipped(item);
                    const isBusyHere =
                      (busy.kind === 'buying' && busy.productId === item.productId) ||
                      (busy.kind === 'equipping' && busy.productId === item.productId);
                    return (
                      <div
                        key={item.productId}
                        className={
                          'p-2 rounded-lg flex flex-col items-center gap-1 border transition ' +
                          (equipped
                            ? 'bg-emerald-600/15 border-emerald-500/60'
                            : owned
                              ? 'bg-slate-800/70 border-slate-700 hover:border-slate-500'
                              : 'bg-slate-800/40 border-slate-800 hover:border-slate-700')
                        }
                      >
                        <CosmeticSlot
                          productId={item.productId}
                          size={tileSize}
                          title={item.displayName}
                        />
                        <div className="text-[10px] text-center leading-tight text-slate-300 w-full truncate">
                          {item.displayName}
                        </div>
                        {equipped ? (
                          <div className="text-[10px] font-bold text-emerald-400">
                            ✓ In uso
                          </div>
                        ) : owned ? (
                          <button
                            onClick={() => handleEquip(item)}
                            disabled={isBusyHere}
                            className="w-full text-[10px] font-bold py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-60"
                          >
                            {isBusyHere ? '...' : 'Usa'}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleBuy(item)}
                            disabled={busy.kind === 'buying'}
                            className="w-full text-[10px] font-bold py-1 rounded bg-amber-400 text-slate-950 disabled:opacity-60"
                          >
                            {isBusyHere
                              ? '...'
                              : formatPrice(item.priceEur)}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {!isNative && (
            <p className="text-[11px] text-center text-slate-500 mt-4">
              Gli acquisti funzionano solo nell'app mobile (iOS / Android).
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Storefront;
