import React from 'react';
import { Home, Layers, Calendar, Sliders } from 'lucide-react';

export type NavTab = 'home' | 'top10' | 'history' | 'dev';

interface BottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
}) => {
  return (
    <nav
      id="mm2d-bottom-navigation"
      className="fixed bottom-0 left-0 right-0 z-40 bg-[#0B0E17]/90 backdrop-blur-xl border-t border-slate-800/80 px-2 py-2"
    >
      <div className="max-w-md mx-auto flex items-center justify-around">
        {/* Home */}
        <button
          type="button"
          onClick={() => onSelectTab('home')}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
            activeTab === 'home'
              ? 'text-cyan-400 font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="relative">
            <Home className="w-5 h-5" />
            {activeTab === 'home' && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-cyan-400" />
            )}
          </div>
          <span className="text-[10px] mt-1">ပင်မ (Home)</span>
        </button>

        {/* Top 10 / Analysis */}
        <button
          type="button"
          onClick={() => onSelectTab('top10')}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
            activeTab === 'top10'
              ? 'text-cyan-400 font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="relative">
            <Layers className="w-5 h-5" />
            {activeTab === 'top10' && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-cyan-400" />
            )}
          </div>
          <span className="text-[10px] mt-1">ထိပ်တန်း (Top 10)</span>
        </button>

        {/* History */}
        <button
          type="button"
          onClick={() => onSelectTab('history')}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
            activeTab === 'history'
              ? 'text-cyan-400 font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="relative">
            <Calendar className="w-5 h-5" />
            {activeTab === 'history' && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-cyan-400" />
            )}
          </div>
          <span className="text-[10px] mt-1">မှတ်တမ်း (History)</span>
        </button>
      </div>
    </nav>
  );
};
