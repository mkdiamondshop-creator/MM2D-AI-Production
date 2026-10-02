import React from 'react';
import { TrendingUp, TrendingDown, DollarSign, Activity, Zap, Clock, ShieldCheck } from 'lucide-react';
import { LiveMarketSnapshot } from '../types/liveSource';
import { LiveObservation } from '../core/market/liveObservationBuffer';

interface LiveMarketCardProps {
  liveSnapshot: LiveMarketSnapshot | null;
  liveStatus: 'SUCCESS' | 'INSUFFICIENT_LIVE_DATA' | 'LIVE_DATA_STALE' | 'MARKET_CLOSED' | 'SOURCE_UNAVAILABLE';
  recentObservations: LiveObservation[];
}

export const LiveMarketCard: React.FC<LiveMarketCardProps> = ({
  liveSnapshot,
  liveStatus,
  recentObservations,
}) => {
  // Use real latest observation or live snapshot
  const latestObs = recentObservations.length > 0
    ? recentObservations[recentObservations.length - 1]
    : null;

  const hasLiveData = Boolean(liveSnapshot?.setRaw || latestObs);
  const currentSet = liveSnapshot?.setRaw || (latestObs ? latestObs.set.toFixed(2) : null);
  const currentValue = liveSnapshot?.valueRaw || (latestObs ? latestObs.value.toFixed(2) : null);
  const updateTime = liveSnapshot?.time || latestObs?.time || null;

  // Real trend calculation if at least 2 real observations exist
  let setDiff = 0;
  let setDiffPercent = 0;
  let hasRealTrend = false;

  if (recentObservations.length >= 2) {
    const prev = recentObservations[recentObservations.length - 2].set;
    const curr = recentObservations[recentObservations.length - 1].set;
    if (prev > 0 && curr > 0) {
      setDiff = curr - prev;
      setDiffPercent = (setDiff / prev) * 100;
      hasRealTrend = true;
    }
  }

  // Generate real SVG sparkline coordinates strictly from authentic observation history
  const sparklinePoints = React.useMemo(() => {
    if (!recentObservations || recentObservations.length < 2) return null;
    const values = recentObservations.map((o) => o.set).filter((v) => v > 0);
    if (values.length < 2) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const width = 130;
    const height = 36;

    const points = values.map((val, idx) => {
      const x = (idx / (values.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    return points;
  }, [recentObservations]);

  return (
    <div
      id="live-market-overview-card"
      className="bg-[#0B0E17]/95 border border-slate-800/90 rounded-3xl p-5 sm:p-6 shadow-xl backdrop-blur-md space-y-4"
    >
      {/* Header bar with Official Source & Update Time */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-cyan-950/80 border border-cyan-800/50">
            <Activity className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wide">
                Live Market Overview
              </h2>
              <span className="text-[11px] text-slate-400 font-medium hidden sm:inline">
                (ထိုင်းစတော့ဈေးကွက် တိုက်ရိုက်အခြေအနေ)
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Official SET Source: Stock Exchange of Thailand</span>
            </div>
          </div>
        </div>

        {/* Status / Update Time Badge */}
        <div className="flex items-center gap-2">
          {updateTime ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-500/30 text-[11px] text-cyan-300 font-mono">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#38bdf8]" />
              <span>Updated {updateTime}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-400 font-sans">
              <Clock className="w-3 h-3 text-slate-400 animate-pulse" />
              <span>
                {liveStatus === 'MARKET_CLOSED'
                  ? 'Market Closed'
                  : 'Waiting for Live SET + Value'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 2-Column Responsive Grid (SET INDEX | TRADING VALUE) */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
        {/* Column 1: SET INDEX */}
        <div className="bg-slate-950/80 border border-slate-800/90 rounded-2xl p-3 sm:p-5 flex flex-col justify-between space-y-3 relative overflow-hidden group min-h-[135px] sm:min-h-[155px] min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-1 min-w-0">
            <span className="text-[11px] sm:text-xs font-bold text-slate-300 flex items-center gap-1.5 uppercase tracking-wide truncate">
              <Zap className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="truncate">SET INDEX</span>
            </span>
            {hasRealTrend ? (
              <span className={`text-[9px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.5 rounded-full flex items-center gap-1 font-mono shrink-0 ${
                setDiff >= 0
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                  : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
              }`}>
                {setDiff >= 0 ? <TrendingUp className="w-3 h-3 shrink-0" /> : <TrendingDown className="w-3 h-3 shrink-0" />}
                <span>{setDiff >= 0 ? `+${setDiff.toFixed(2)}` : setDiff.toFixed(2)}</span>
              </span>
            ) : hasLiveData ? (
              <span className="text-[9px] sm:text-[10px] font-semibold px-1.5 sm:px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono shrink-0">
                Active
              </span>
            ) : (
              <span className="text-[9px] sm:text-[10px] font-semibold px-1.5 sm:px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-400 border border-slate-700 font-sans shrink-0">
                Waiting
              </span>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1.5 pt-1 min-w-0">
            <div className="min-w-0">
              {currentSet ? (
                <div className="text-xl sm:text-4xl font-black text-white font-mono tracking-tight drop-shadow-sm truncate">
                  {currentSet}
                </div>
              ) : (
                <div className="text-xl sm:text-3xl font-bold text-slate-500 font-mono truncate">
                  —.—
                </div>
              )}
              <div className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 truncate">
                {currentSet ? 'Stock Exchange Thailand' : 'Waiting for Live SET'}
              </div>
            </div>

            {/* Authentic Sparkline if real data exists */}
            {sparklinePoints ? (
              <div className="w-full max-w-[90px] sm:max-w-[130px] h-[26px] sm:h-[36px] self-end sm:self-auto shrink-0">
                <svg className="w-full h-full overflow-visible" viewBox="0 0 130 36">
                  <polyline
                    fill="none"
                    stroke="#38BDF8"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={sparklinePoints}
                  />
                </svg>
              </div>
            ) : null}
          </div>
        </div>

        {/* Column 2: TRADING VALUE */}
        <div className="bg-slate-950/80 border border-slate-800/90 rounded-2xl p-3 sm:p-5 flex flex-col justify-between space-y-3 relative overflow-hidden group min-h-[135px] sm:min-h-[155px] min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-1 min-w-0">
            <span className="text-[11px] sm:text-xs font-bold text-slate-300 flex items-center gap-1.5 uppercase tracking-wide truncate">
              <DollarSign className="w-3.5 h-3.5 text-teal-400 shrink-0" />
              <span className="truncate">TRADING VALUE</span>
            </span>
            <span className="text-[9px] sm:text-[10px] font-semibold px-1.5 sm:px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-300 border border-teal-500/20 font-mono shrink-0">
              THB M
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1.5 pt-1 min-w-0">
            <div className="min-w-0">
              {currentValue ? (
                <div className="text-xl sm:text-4xl font-black text-white font-mono tracking-tight drop-shadow-sm truncate">
                  {currentValue} <span className="text-xs sm:text-lg font-bold text-teal-400 font-sans">M</span>
                </div>
              ) : (
                <div className="text-xl sm:text-3xl font-bold text-slate-500 font-mono truncate">
                  —.— <span className="text-xs sm:text-lg font-bold text-slate-600 font-sans">M</span>
                </div>
              )}
              <div className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 truncate">
                {currentValue ? 'ကုန်သွယ်မှုပမာဏ (THB M)' : 'Waiting for Value'}
              </div>
            </div>

            <div className="text-right text-[9px] sm:text-[10px] font-mono text-slate-400 self-end sm:self-auto shrink-0">
              <span className="hidden sm:inline">Settlement Factor</span>
              <div className="text-teal-400 font-bold">2D Derivation</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

