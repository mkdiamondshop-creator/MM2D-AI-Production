import React from 'react';
import { Award, CheckCircle2, TrendingUp, BarChart2 } from 'lucide-react';
import { ShadowSessionRecord } from '../types/autoWeightedV2';

interface EvaluationCardProps {
  settlementComparison: ShadowSessionRecord['settlementComparison'] | null | undefined;
}

export const EvaluationCard: React.FC<EvaluationCardProps> = ({
  settlementComparison,
}) => {
  if (!settlementComparison) return null;

  const {
    actualSettlement2D,
    v2,
  } = settlementComparison;

  const {
    actualRank,
    actualProbability,
    isTop1Hit,
    isTop5Hit,
    isTop10Hit,
    logLoss,
    reciprocalRank,
  } = v2;

  return (
    <div
      id="prediction-evaluation-card"
      className="bg-[#0B0E17]/85 border border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-lg backdrop-blur-md space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wide">
            Model Prediction Evaluation
          </h3>
          <span className="text-[11px] text-slate-400 font-medium">
            (ခန့်မှန်းချက် အကဲဖြတ်မှု)
          </span>
        </div>

        {isTop1Hit ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            TOP 1 DIRECT HIT! 🎉
          </span>
        ) : isTop5Hit ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
            <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
            TOP 5 ENSEMBLE HIT (Rank #{actualRank})
          </span>
        ) : isTop10Hit ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
            TOP 10 CONSENSUS HIT (Rank #{actualRank})
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700">
            Rank #{actualRank !== null ? actualRank : 'Out of Top 10'}
          </span>
        )}
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Actual 2D */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 space-y-1">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">
            Actual Winning 2D
          </div>
          <div className="text-xl font-black font-mono text-emerald-400">
            {actualSettlement2D}
          </div>
          <div className="text-[10px] text-slate-500 font-sans">
            Settlement Target
          </div>
        </div>

        {/* Rank of Actual */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 space-y-1">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">
            Ensemble Rank
          </div>
          <div className="text-xl font-black font-mono text-cyan-300">
            {actualRank !== null ? `#${actualRank}` : '> 100'}
          </div>
          <div className="text-[10px] text-slate-500 font-sans">
            Out of 100 Digits
          </div>
        </div>

        {/* Assigned Probability */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 space-y-1">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">
            Probability Assigned
          </div>
          <div className="text-xl font-black font-mono text-amber-300">
            {(actualProbability * 100).toFixed(2)}%
          </div>
          <div className="text-[10px] text-slate-500 font-sans">
            Prior to Settlement
          </div>
        </div>

        {/* MRR & Log Loss */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 space-y-1">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">
            Log Loss / MRR
          </div>
          <div className="text-xl font-black font-mono text-purple-300">
            {reciprocalRank.toFixed(2)} <span className="text-xs text-slate-400">MRR</span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono">
            Loss: {logLoss.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="text-[11px] text-slate-400 font-mono flex items-center justify-between border-t border-slate-800/60 pt-2">
        <span>Evaluated strictly against frozen lock cutoff snapshot.</span>
        <span className="text-emerald-400 font-sans font-medium">Zero Future Leakage</span>
      </div>
    </div>
  );
};
