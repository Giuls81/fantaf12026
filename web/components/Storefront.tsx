// Cosmetics storefront modal. Opens over the app, shows the four slot
// categories + the starter bundle + the season pass.
//
// Purchase flow: user taps Buy → RevenueCat sheet opens → on success, the
// server webhook grants ownership and the modal polls /me/cosmetics until
// the new row appears (up to ~20s across retries), then updates state.
//
// Added 2026-04-17 — Phase 4b.
// Localised 2026-04-20 — accepts t() prop, mirrors App.tsx's 9-language setup.

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

type Translator = (dict: Record<string, string>) => string;

interface StorefrontProps {
  isOpen: boolean;
  onClose: () => void;
  state: CosmeticsState | null;
  equippedForTeam: EquippedCosmetics | null;
  teamId: string | null;
  onStateChange: (next: CosmeticsState) => void;
  t: Translator;
}

type BusyState =
  | { kind: 'idle' }
  | { kind: 'buying'; productId: string }
  | { kind: 'equipping'; productId: string };

const formatPrice = (eur: number): string =>
  `€${eur.toFixed(2).replace('.', ',')}`;

const Storefront: React.FC<StorefrontProps> = ({
  isOpen,
  onClose,
  state,
  equippedForTeam,
  teamId,
  onStateChange,
  t,
}) => {
  const [busy, setBusy] = useState<BusyState>({ kind: 'idle' });
  const [flash, setFlash] = useState<string | null>(null);

  const ownedIds = useMemo(
    () => new Set((state?.owned || []).map((o) => o.productId)),
    [state],
  );

  const isNative = Capacitor.getPlatform() !== 'web';

  // Localised category metadata. Keep the label generation inside the
  // component so every render picks up the current language.
  const categoryGroups: { key: CosmeticCategory; label: string; tileSize: number; columns: number }[] = [
    {
      key: 'emblem',
      label: t({ en: 'Emblems', it: 'Emblemi', fr: 'Emblèmes', de: 'Embleme', es: 'Emblemas', ru: 'Эмблемы', zh: '徽章', ar: 'شعارات', ja: 'エンブレム' }),
      tileSize: 64,
      columns: 4,
    },
    {
      key: 'helmet',
      label: t({ en: 'Helmets', it: 'Caschi', fr: 'Casques', de: 'Helme', es: 'Cascos', ru: 'Шлемы', zh: '头盔', ar: 'خوذ', ja: 'ヘルメット' }),
      tileSize: 64,
      columns: 4,
    },
    {
      key: 'suit',
      label: t({ en: 'Suits', it: 'Tute', fr: 'Combinaisons', de: 'Anzüge', es: 'Trajes', ru: 'Комбинезоны', zh: '赛服', ar: 'بدلات', ja: 'スーツ' }),
      tileSize: 72,
      columns: 3,
    },
    {
      key: 'color',
      label: t({ en: 'Colors', it: 'Colori', fr: 'Couleurs', de: 'Farben', es: 'Colores', ru: 'Цвета', zh: '颜色', ar: 'ألوان', ja: 'カラー' }),
      tileSize: 56,
      columns: 4,
    },
  ];

  if (!isOpen) return null;

  const handleBuy = async (item: CosmeticItem) => {
    if (!isNative) {
      setFlash(t({
        en: 'Purchases are only available in the mobile app.',
        it: "Gli acquisti sono disponibili solo nell'app mobile.",
        fr: "Les achats sont disponibles uniquement dans l'application mobile.",
        de: 'Käufe sind nur in der mobilen App verfügbar.',
        es: 'Las compras están disponibles solo en la app móvil.',
        ru: 'Покупки доступны только в мобильном приложении.',
        zh: '购买仅在移动应用中可用。',
        ar: 'عمليات الشراء متاحة فقط في التطبيق الجوّال.',
        ja: '購入はモバイルアプリでのみ可能です。',
      }));
      setTimeout(() => setFlash(null), 3000);
      return;
    }
    setBusy({ kind: 'buying', productId: item.productId });
    setFlash(null);
    try {
      const result = await buyCosmeticAndRefresh(item.productId);
      if (result.ok) {
        onStateChange(result.state);
        setFlash(t({
          en: `✓ Unlocked: ${item.displayName}`,
          it: `✓ Sbloccato: ${item.displayName}`,
          fr: `✓ Débloqué : ${item.displayName}`,
          de: `✓ Freigeschaltet: ${item.displayName}`,
          es: `✓ Desbloqueado: ${item.displayName}`,
          ru: `✓ Разблокировано: ${item.displayName}`,
          zh: `✓ 已解锁：${item.displayName}`,
          ar: `✓ تم الفتح: ${item.displayName}`,
          ja: `✓ 解除済み: ${item.displayName}`,
        }));
      } else if (result.reason === 'user_cancelled') {
        // Silent
      } else if (result.reason === 'not_found') {
        setFlash(t({
          en: 'Product not available in the store yet. Try again in a few minutes.',
          it: 'Prodotto non disponibile nello store. Riprova tra qualche minuto.',
          fr: "Produit non encore disponible dans la boutique. Réessayez dans quelques minutes.",
          de: 'Produkt im Store noch nicht verfügbar. Bitte in ein paar Minuten erneut versuchen.',
          es: 'Producto aún no disponible en la tienda. Inténtalo de nuevo en unos minutos.',
          ru: 'Товар пока недоступен в магазине. Повторите попытку через несколько минут.',
          zh: '商店中暂时无此商品，请稍后再试。',
          ar: 'المنتج غير متاح في المتجر حاليًا. حاول مرة أخرى بعد دقائق.',
          ja: 'ストアでまだ購入できません。しばらくしてから再度お試しください。',
        }));
      } else if (result.reason === 'webhook_timeout' && result.state) {
        onStateChange(result.state);
        setFlash(t({
          en: 'Purchase is being processed — check back in a minute.',
          it: 'Acquisto in elaborazione — controlla tra un minuto.',
          fr: "Achat en cours de traitement — revenez dans une minute.",
          de: 'Kauf wird verarbeitet — in einer Minute erneut prüfen.',
          es: 'Compra en proceso — vuelve a comprobar en un minuto.',
          ru: 'Покупка обрабатывается — проверьте через минуту.',
          zh: '购买处理中，请一分钟后再查看。',
          ar: 'جاري معالجة الشراء — عاود التحقق بعد دقيقة.',
          ja: '購入を処理中です。1分後に再度ご確認ください。',
        }));
      } else {
        setFlash(t({
          en: 'Purchase failed. Try again.',
          it: 'Acquisto non riuscito. Riprova.',
          fr: 'Échec de l’achat. Réessayez.',
          de: 'Kauf fehlgeschlagen. Bitte erneut versuchen.',
          es: 'La compra falló. Inténtalo de nuevo.',
          ru: 'Не удалось выполнить покупку. Повторите попытку.',
          zh: '购买失败，请重试。',
          ar: 'فشل الشراء. حاول مرة أخرى.',
          ja: '購入に失敗しました。もう一度お試しください。',
        }));
      }
    } catch (e) {
      console.error('handleBuy error', e);
      setFlash(t({
        en: 'Purchase failed. Try again.',
        it: 'Acquisto non riuscito. Riprova.',
        fr: 'Échec de l’achat. Réessayez.',
        de: 'Kauf fehlgeschlagen. Bitte erneut versuchen.',
        es: 'La compra falló. Inténtalo de nuevo.',
        ru: 'Не удалось выполнить покупку. Повторите попытку.',
        zh: '购买失败,请重试。',
        ar: 'فشل الشراء. حاول مرة أخرى.',
        ja: '購入に失敗しました。もう一度お試しください。',
      }));
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
      setFlash(t({
        en: `Equipped: ${item.displayName}`,
        it: `Equipaggiato: ${item.displayName}`,
        fr: `Équipé : ${item.displayName}`,
        de: `Ausgerüstet: ${item.displayName}`,
        es: `Equipado: ${item.displayName}`,
        ru: `Экипировано: ${item.displayName}`,
        zh: `已装备：${item.displayName}`,
        ar: `تم التجهيز: ${item.displayName}`,
        ja: `装備しました: ${item.displayName}`,
      }));
    } catch (e) {
      console.error('handleEquip error', e);
      setFlash(t({
        en: 'Could not equip.',
        it: 'Impossibile equipaggiare.',
        fr: 'Impossible d’équiper.',
        de: 'Ausrüsten nicht möglich.',
        es: 'No se pudo equipar.',
        ru: 'Не удалось экипировать.',
        zh: '无法装备。',
        ar: 'تعذّر التجهيز.',
        ja: '装備できませんでした。',
      }));
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
            <h2 className="text-lg font-bold">
              {t({ en: 'Customize your team', it: 'Personalizza il tuo team', fr: 'Personnaliser votre équipe', de: 'Team anpassen', es: 'Personaliza tu equipo', ru: 'Настройте команду', zh: '自定义你的车队', ar: 'خصّص فريقك', ja: 'チームをカスタマイズ' })}
            </h2>
            <p className="text-xs text-slate-400">
              {t({ en: 'Emblems, helmets, suits, colors', it: 'Emblemi, caschi, tute, colori', fr: 'Emblèmes, casques, combinaisons, couleurs', de: 'Embleme, Helme, Anzüge, Farben', es: 'Emblemas, cascos, trajes, colores', ru: 'Эмблемы, шлемы, комбинезоны, цвета', zh: '徽章、头盔、赛服、颜色', ar: 'شعارات وخوذ وبدلات وألوان', ja: 'エンブレム・ヘルメット・スーツ・カラー' })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center"
            aria-label={t({ en: 'Close', it: 'Chiudi', fr: 'Fermer', de: 'Schließen', es: 'Cerrar', ru: 'Закрыть', zh: '关闭', ar: 'إغلاق', ja: '閉じる' })}
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
                  {t({ en: 'Season Pass 2026', it: 'Season Pass 2026', fr: 'Season Pass 2026', de: 'Season Pass 2026', es: 'Season Pass 2026', ru: 'Season Pass 2026', zh: 'Season Pass 2026', ar: 'Season Pass 2026', ja: 'Season Pass 2026' })}
                </div>
                <div className="text-base font-bold">
                  {t({ en: 'Unlock everything now', it: 'Sblocca tutto subito', fr: 'Débloquez tout maintenant', de: 'Alles sofort freischalten', es: 'Desbloquea todo ahora', ru: 'Разблокируйте всё сейчас', zh: '立即解锁全部', ar: 'افتح كل شيء الآن', ja: '今すぐすべて解除' })}
                </div>
                <div className="text-xs text-slate-300 mt-1">
                  {t({ en: 'All emblems, helmets, suits and colors from the 2026 catalog.', it: 'Tutti gli emblemi, caschi, tute e colori del catalogo 2026.', fr: 'Tous les emblèmes, casques, combinaisons et couleurs du catalogue 2026.', de: 'Alle Embleme, Helme, Anzüge und Farben aus dem Katalog 2026.', es: 'Todos los emblemas, cascos, trajes y colores del catálogo 2026.', ru: 'Все эмблемы, шлемы, комбинезоны и цвета из каталога 2026.', zh: '2026 系列的全部徽章、头盔、赛服和颜色。', ar: 'جميع الشعارات والخوذ والبدلات والألوان من كتالوج 2026.', ja: '2026年カタログのすべてのエンブレム、ヘルメット、スーツ、カラー。' })}
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
            {t({ en: '✓ Season Pass active — every cosmetic unlocked', it: '✓ Season Pass attivo — tutti i cosmetici sbloccati', fr: '✓ Season Pass actif — tous les cosmétiques débloqués', de: '✓ Season Pass aktiv — alle Kosmetika freigeschaltet', es: '✓ Season Pass activo — todos los cosméticos desbloqueados', ru: '✓ Season Pass активен — все косметические предметы разблокированы', zh: '✓ Season Pass 已启用 — 所有装饰均已解锁', ar: '✓ تمريرة الموسم مفعّلة — جميع التجميلات مفتوحة', ja: '✓ シーズンパス有効 — すべてのコスメ解除済み' })}
          </div>
        )}

        {/* Starter bundle */}
        {starterBundle && !ownedIds.has(starterBundle.productId) &&
          seasonPass && !ownedIds.has(seasonPass.productId) && (
          <div className="mx-3 mb-3 p-3 rounded-xl bg-slate-800/60 border border-slate-700">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  {t({ en: 'Starter bundle', it: 'Bundle starter', fr: 'Pack de démarrage', de: 'Starter-Bundle', es: 'Pack inicial', ru: 'Стартовый набор', zh: '入门礼包', ar: 'حزمة البداية', ja: 'スターターバンドル' })}
                </div>
                <div className="text-sm font-bold">
                  {t({ en: '10 curated cosmetics', it: '10 cosmetici selezionati', fr: '10 cosmétiques sélectionnés', de: '10 ausgewählte Kosmetika', es: '10 cosméticos seleccionados', ru: '10 отборных косметических предметов', zh: '10 件精选装饰', ar: '10 تجميلات مختارة', ja: '厳選コスメ10点' })}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {t({ en: '4 emblems · 4 helmets · 2 colors', it: '4 emblemi · 4 caschi · 2 colori', fr: '4 emblèmes · 4 casques · 2 couleurs', de: '4 Embleme · 4 Helme · 2 Farben', es: '4 emblemas · 4 cascos · 2 colores', ru: '4 эмблемы · 4 шлема · 2 цвета', zh: '4 徽章 · 4 头盔 · 2 颜色', ar: '4 شعارات · 4 خوذ · 2 لون', ja: 'エンブレム4 · ヘルメット4 · カラー2' })}
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

        {/* Flash */}
        {flash && (
          <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200">
            {flash}
          </div>
        )}

        {/* Category grids */}
        <div className="overflow-y-auto px-3 pb-4" style={{ overscrollBehavior: 'contain' }}>
          {categoryGroups.map(({ key, label, tileSize, columns }) => {
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
                        {t({ en: 'remove', it: 'rimuovi', fr: 'retirer', de: 'entfernen', es: 'quitar', ru: 'убрать', zh: '移除', ar: 'إزالة', ja: '外す' })}
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
                            {t({ en: '✓ In use', it: '✓ In uso', fr: '✓ Utilisé', de: '✓ In Gebrauch', es: '✓ En uso', ru: '✓ Используется', zh: '✓ 使用中', ar: '✓ قيد الاستخدام', ja: '✓ 使用中' })}
                          </div>
                        ) : owned ? (
                          <button
                            onClick={() => handleEquip(item)}
                            disabled={isBusyHere}
                            className="w-full text-[10px] font-bold py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-60"
                          >
                            {isBusyHere
                              ? '...'
                              : t({ en: 'Use', it: 'Usa', fr: 'Utiliser', de: 'Nutzen', es: 'Usar', ru: 'Надеть', zh: '使用', ar: 'استخدم', ja: '使う' })}
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
              {t({ en: 'Purchases only work in the mobile app (iOS / Android).', it: "Gli acquisti funzionano solo nell'app mobile (iOS / Android).", fr: "Les achats ne fonctionnent que dans l'application mobile (iOS / Android).", de: 'Käufe funktionieren nur in der mobilen App (iOS / Android).', es: 'Las compras solo funcionan en la app móvil (iOS / Android).', ru: 'Покупки работают только в мобильном приложении (iOS / Android).', zh: '购买仅在移动应用中可用（iOS / Android）。', ar: 'عمليات الشراء تعمل في التطبيق الجوّال فقط (iOS / Android).', ja: '購入はモバイルアプリ (iOS / Android) でのみ有効です。' })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Storefront;
