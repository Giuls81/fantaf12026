import React from 'react';
import { Tab } from '../types';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  showAdmin: boolean;
  lang: string;
  t: (dict: { [key: string]: string }) => string;
}

const Layout: React.FC<LayoutProps> = ({ children, activeTab, onTabChange, showAdmin, lang, t }) => {
  
  const getLabel = (tab: Tab) => {
      const labels: Record<Tab, Record<string, string>> = {
          [Tab.HOME]: { en: 'Home', it: 'Home', fr: 'Accueil', de: 'Start', es: 'Inicio', ru: 'Главная', zh: '主页', ar: 'الرئيسية', ja: 'ホーム' },
          [Tab.TEAM]: { en: 'Team', it: 'Squadra', fr: 'Équipe', de: 'Team', es: 'Equipo', ru: 'Команда', zh: '车队', ar: 'فريق', ja: 'チーム' },
          [Tab.LINEUP]: { en: 'Lineup', it: 'Formazione', fr: 'Alignement', de: 'Aufstellung', es: 'Alineación', ru: 'Состав', zh: '阵容', ar: 'التشكيلة', ja: 'ラインナップ' },
          [Tab.MARKET]: { en: 'Market', it: 'Mercato', fr: 'Marché', de: 'Markt', es: 'Mercado', ru: 'Рынок', zh: '市场', ar: 'سوق', ja: '市場' },
          [Tab.ADMIN]: { en: 'Admin', it: 'Admin', fr: 'Admin', de: 'Admin', es: 'Admin', ru: 'Админ', zh: '管理', ar: 'مسؤول', ja: '管理' },
      };
      return t(labels[tab]);
  };

  const tabs = [
    { id: Tab.HOME, label: getLabel(Tab.HOME), icon: '🏠' },
    { id: Tab.TEAM, label: getLabel(Tab.TEAM), icon: '🏎️' },
    { id: Tab.LINEUP, label: getLabel(Tab.LINEUP), icon: '📋' },
    { id: Tab.MARKET, label: getLabel(Tab.MARKET), icon: '💰' },
    { id: Tab.ADMIN, label: getLabel(Tab.ADMIN), icon: '⚙️' },
  ];

  const visibleTabs = showAdmin ? tabs : tabs.filter(t => t.id !== Tab.ADMIN);

  return (
    <div className="flex flex-col h-screen w-full max-w-md mx-auto bg-slate-900 shadow-2xl overflow-hidden">
      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto no-scrollbar p-4 pb-24 pt-[calc(1rem+env(safe-area-inset-top,0px))]">
        {children}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 w-full max-w-md bg-slate-800 border-t border-slate-700 flex justify-around items-center h-16 z-50">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex flex-col items-center justify-center w-full h-full transition-colors ${
              activeTab === tab.id ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className="text-xl mb-1">{tab.icon}</span>
            <span className="text-[10px] font-medium uppercase tracking-wide">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
};

export default Layout;