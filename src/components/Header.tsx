import React from 'react';
import { RefreshCw, Bell, Menu, Zap } from 'lucide-react';

interface HeaderProps {
  loading: boolean;
  onRefresh: () => void;
  onOpenMenu: () => void;
  liveStatus: 'SUCCESS' | 'INSUFFICIENT_LIVE_DATA' | 'LIVE_DATA_STALE' | 'MARKET_CLOSED' | 'SOURCE_UNAVAILABLE';
}

export const Header: React.FC<HeaderProps> = ({
  loading,
  onRefresh,
  onOpenMenu,
  liveStatus,
}) => {
  return (
    <header
      id="mm2d-top-header"
      className="sticky top-0 z-40 bg-[#0B0E17]/85 backdrop-blur-xl border-b border-slate-800/80 px-4 sm:px-6 py-3 transition-colors"
    >
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        {/* Brand identity */}
        <div className="flex items-center gap-3">
          <div className="relative group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-purple-600 p-[1px] shadow-lg shadow-cyan-500/20">
              <div className="w-full h-full bg-[#0B0E17] rounded-[11px] flex items-center justify-center font-black text-white text-base tracking-tight">
                <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                  2D
                </span>
              </div>
            </div>
            {/* Live pulsing dot */}
            <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  liveStatus === 'SUCCESS'
                    ? 'bg-emerald-400'
                    : liveStatus === 'LIVE_DATA_STALE'
                    ? 'bg-amber-400'
                    : 'bg-cyan-400'
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-3 w-3 border-2 border-[#0B0E17] ${
                  liveStatus === 'SUCCESS'
                    ? 'bg-emerald-500'
                    : liveStatus === 'LIVE_DATA_STALE'
                    ? 'bg-amber-500'
                    : 'bg-cyan-500'
                }`}
              />
            </span>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2">
                MM 2D Daily
              </h1>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" />
                Live V2
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">
              မြန်မာ ၂လုံး ထိုင်းစတော့ဒေတာ & AI ခန့်မှန်းချက်
            </p>
          </div>
        </div>

        {/* Action controls */}
        <div className="flex items-center gap-2">
          {/* Notification indicator */}
          <button
            type="button"
            title="Market Sync Notifications"
            className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-700 transition cursor-pointer relative"
          >
            <Bell className="w-4 h-4 text-slate-300" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-cyan-400 ring-2 ring-[#0B0E17]" />
          </button>

          {/* Refresh button */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh Live Market Data"
            className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-700 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>

          {/* Hamburger Menu button */}
          <button
            type="button"
            onClick={onOpenMenu}
            title="Open Menu (မီနူး)"
            className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-700 transition cursor-pointer"
            aria-label="Open menu"
          >
            <Menu className="w-4 h-4 text-slate-200" />
          </button>
        </div>
      </div>
    </header>
  );
};
