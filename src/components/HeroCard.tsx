import React from 'react';
import { Calendar, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import bangkokHeroImg from '../assets/bangkok_market_hero.webp';

interface HeroCardProps {
  currentTime: Date;
  bangkokDateStr: string;
  bangkokTimeStr: string;
  myanmarTimeStr: string;
  isNonTradingDay: boolean;
  marketStatusText: string;
  isMarketOpen: boolean;
}

export const HeroCard: React.FC<HeroCardProps> = ({
  currentTime,
  bangkokDateStr,
  bangkokTimeStr,
  myanmarTimeStr,
  isNonTradingDay,
  marketStatusText,
  isMarketOpen,
}) => {
  const formattedDate = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(currentTime);

  return (
    <div
      id="today-market-hero-card"
      className="relative overflow-hidden rounded-3xl border border-cyan-500/40 bg-[#070B14] shadow-[0_10px_35px_rgba(0,0,0,0.7)] shadow-cyan-950/25 transition-all"
      style={{
        backgroundImage: `url(${bangkokHeroImg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* Moderate dark overlay only for readability: keeps Bangkok temple/skyline/sunset visibly clear */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#070B14]/85 via-[#070B14]/40 to-[#070B14]/20 pointer-events-none" />
      <div className="absolute inset-0 bg-black/25 pointer-events-none" />

      {/* 3. Hero Content Layer */}
      <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-between min-h-[220px] sm:min-h-[240px] space-y-5">
        {/* Top Row: Date & Trading Day Badge */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-cyan-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                TODAY'S MARKET DATE
              </span>
              <span className="text-[11px] text-slate-200 font-medium hidden sm:inline drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                (ဒီနေ့ ဈေးကွက်ရက်စွဲ)
              </span>
            </div>
            <div className="text-xl sm:text-2xl font-black text-white tracking-tight drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
              {formattedDate}
            </div>
          </div>

          {/* Trading Day Status Badge */}
          <div>
            {isNonTradingDay ? (
              <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-amber-500/25 text-amber-300 border border-amber-500/50 backdrop-blur-md shadow-lg shadow-black/40">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>NON-TRADING DAY (ပိတ်ရက်)</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-emerald-500/25 text-emerald-300 border border-emerald-500/50 backdrop-blur-md shadow-lg shadow-black/40">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>TRADING DAY (ဖွင့်လှစ်သည့်နေ့)</span>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Row: Current Clocks & Market Status */}
        <div className="pt-3 border-t border-slate-700/50 flex flex-wrap items-center justify-between gap-3">
          {/* Market Status Pill */}
          <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-slate-950/85 backdrop-blur-md border border-slate-700/80 shadow-md shadow-black/30">
            <span className="flex h-2.5 w-2.5 relative">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  isMarketOpen ? 'bg-emerald-400' : 'bg-slate-400'
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isMarketOpen ? 'bg-emerald-500' : 'bg-slate-500'
                }`}
              />
            </span>
            <span className="text-xs font-bold text-slate-100 drop-shadow">
              {marketStatusText}
            </span>
          </div>

          {/* Clocks for Bangkok & Myanmar */}
          <div className="flex items-center gap-3 bg-slate-950/85 backdrop-blur-md border border-cyan-500/30 rounded-2xl px-4 py-2 shadow-md shadow-black/30">
            <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
            <div className="flex items-center gap-4 text-right">
              <div>
                <div className="text-xs font-mono font-bold text-white tracking-wide">
                  {bangkokTimeStr}
                </div>
                <div className="text-[10px] text-slate-300 font-sans">
                  Bangkok (UTC+7)
                </div>
              </div>
              <div className="w-px h-6 bg-slate-700/70" />
              <div>
                <div className="text-xs font-mono font-bold text-cyan-300 tracking-wide">
                  {myanmarTimeStr}
                </div>
                <div className="text-[10px] text-slate-300 font-sans">
                  Myanmar (UTC+6:30)
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};


