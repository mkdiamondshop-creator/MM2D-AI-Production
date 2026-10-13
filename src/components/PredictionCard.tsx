import React from 'react';
import { Sparkles, Lock, Clock, Layers, ShieldCheck, ChevronRight, Activity } from 'lucide-react';
import { MarketSession } from '../types/market';
import { ShadowSessionRecord } from '../types/autoWeightedV2';
import { DataSufficiencyState } from '../core/market/dataSufficiencyGate';

interface PredictionCardProps {
  session: MarketSession;
  v2Record: ShadowSessionRecord | null;
  isLocked: boolean;
  isPreOpen: boolean;
  isNonTradingDay: boolean;
  hasOfficialResult: boolean;
  sufficiencyState: DataSufficiencyState;
  observationCount: number;
  onViewTop10: () => void;
}

export const PredictionCard: React.FC<PredictionCardProps> = ({
  session,
  v2Record,
  isLocked,
  isPreOpen,
  isNonTradingDay,
  hasOfficialResult,
  sufficiencyState,
  observationCount,
  onViewTop10,
}) => {
  const sessionTitle = session === 'AM' ? 'AM Prediction (12:01 PM)' : 'PM Prediction (4:30 PM)';
  const sessionBurmese = session === 'AM' ? 'မနက်ပိုင်း ခန့်မှန်းချက်' : 'ညနေပိုင်း ခန့်မှန်းချက်';

  const top1 = v2Record?.top1;
  const top1Candidate = v2Record?.immutableV2Output?.candidates?.[0];
  const probability = top1Candidate ? (top1Candidate.probability * 100).toFixed(1) : null;
  const dominantEngine = top1Candidate?.dominantEngine?.replace('_V1', '') || null;
  const consensusCount = top1Candidate?.consensusCount || null;
  const top5 = v2Record?.top5 || [];

  return (
    <div
      id={`prediction-card-${session.toLowerCase()}`}
      className={`rounded-3xl p-5 sm:p-6 transition-all shadow-xl backdrop-blur-md relative overflow-hidden ${
        isLocked
          ? 'bg-[#0F172A]/95 border-2 border-amber-500/40 shadow-amber-500/10'
          : sufficiencyState === 'REFINING'
          ? 'bg-[#0F172A]/90 border border-cyan-500/40 shadow-cyan-500/10'
          : 'bg-[#0B0E17]/90 border border-slate-800/90'
      }`}
    >
      {/* Background glow for locked / refining state */}
      {isLocked && (
        <div className="absolute -top-16 -right-16 w-36 h-36 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      )}
      {!isLocked && sufficiencyState === 'REFINING' && (
        <div className="absolute -top-16 -right-16 w-36 h-36 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      )}

      {/* Card Header: Session Title & Lifecycle State Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
              {sessionTitle}
            </span>
            <span className="text-[11px] text-slate-400 font-medium">
              ({sessionBurmese})
            </span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            MM2D V3 Joint Trajectory Engine
          </div>
        </div>

        {/* State Badge */}
        <div>
          {isNonTradingDay ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700">
              CLOSED
            </span>
          ) : isLocked ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm">
              <Lock className="w-3.5 h-3.5 text-amber-400" />
              ခန့်မှန်းချက် အတည်ပြုပြီး (🔒 အတည်ပြုပြီး / မပြောင်းလဲတော့ပါ)
            </span>
          ) : isPreOpen ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-800/80 text-slate-400 border border-slate-700">
              <Clock className="w-3.5 h-3.5" />
              {session === 'AM' ? 'OPENS ~09:30 AM MMT (10:00 AM BKK)' : 'OPENS ~13:30 PM MMT (14:00 PM BKK)'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
              <Activity className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
              တိုက်ရိုက်အချက်အလက်များကို ခွဲခြမ်းစိတ်ဖြာနေဆဲ
            </span>
          )}
        </div>
      </div>

      {/* Main Prediction Section */}
      {isNonTradingDay || isPreOpen ? (
        <div className="py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-slate-500" />
              <span>ထိပ်တန်း ဦးစားပေး ခန့်မှန်းဂဏန်း (TOP 1 PICK)</span>
            </div>
            <div className="text-5xl sm:text-6xl font-black font-mono tracking-tight text-slate-600">
              --
            </div>
            <p className="text-xs text-slate-400">
              {isNonTradingDay ? 'စတော့ဈေးကွက် ပိတ်ရက်ဖြစ်ပါသည်' : 'စတော့ဈေးကွက်ဖွင့်ချိန်ကို စောင့်ဆိုင်းနေပါသည်'}
            </p>
          </div>
        </div>
      ) : !isLocked ? (
        /* Market Open → Final Lock: PREDICTION NUMBERS STRICTLY HIDDEN */
        <div className="py-6 space-y-4">
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-5 sm:p-6 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mx-auto">
              <Activity className="w-6 h-6 text-cyan-400 animate-pulse" />
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <div className="text-base sm:text-lg font-bold text-cyan-300">
                တိုက်ရိုက်အချက်အလက်များကို ခွဲခြမ်းစိတ်ဖြာနေပါသည်။
              </div>
              <div className="text-xs text-slate-300 leading-relaxed">
                ခန့်မှန်းချက်ကို သတ်မှတ်ချိန်တွင် ပြသပါမည်။
              </div>
            </div>

            <div className="inline-flex flex-wrap items-center justify-center gap-2 pt-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-slate-900 text-slate-300 border border-slate-700">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span>သတ်မှတ်ချိန်: {session === 'AM' ? '11:30 AM MMT (12:00 PM BKK)' : '03:30 PM MMT (04:00 PM BKK)'}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono text-cyan-400 bg-cyan-950/40 border border-cyan-800/40">
                <Activity className="w-3 h-3 text-cyan-400" />
                <span>{observationCount} Ticks စစ်ဆေးဆဲ</span>
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* Final Lock: DISPLAY FROZEN FINAL PREDICTION NUMBERS */
        <>
          <div className="py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>ထိပ်တန်း ဦးစားပေး ခန့်မှန်းဂဏန်း (TOP 1 PICK)</span>
              </div>

              <div className="flex items-baseline gap-4">
                <div className="text-5xl sm:text-6xl font-black font-mono tracking-tight text-amber-400 drop-shadow-[0_0_20px_rgba(245,158,11,0.35)]">
                  {top1 || '--'}
                </div>

                {probability && (
                  <div className="space-y-1">
                    <div className="text-base font-black text-white font-mono">
                      {probability}%
                    </div>
                    <div className="text-[10px] uppercase font-semibold text-slate-400">
                      Ensemble Prob
                    </div>
                  </div>
                )}
              </div>

              {/* Probability progress bar */}
              {probability && (
                <div className="w-48 sm:w-64 bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                  <div
                    className="bg-gradient-to-r from-cyan-400 via-amber-400 to-amber-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(5, parseFloat(probability) * 4))}%` }}
                  />
                </div>
              )}
            </div>

            {/* Engine metadata & Consensus */}
            {top1Candidate && (
              <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4 space-y-2.5 min-w-[220px]">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Algorithm Consensus
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Dominant Engine:</span>
                  <span className="font-semibold text-cyan-300 font-mono">
                    {dominantEngine}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Engine Agreement:</span>
                  <span className="font-semibold text-emerald-400 font-mono">
                    {consensusCount}/4 Engines
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Target Session:</span>
                  <span className="font-semibold text-slate-200">
                    {session} Settlement
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Top 5 Ensemble Candidates Row */}
          {top5.length > 0 && (
            <div className="pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-400">Top-5 V3 Candidates:</span>
                <div className="flex items-center gap-1.5">
                  {top5.map((num, idx) => (
                    <span
                      key={num}
                      className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold ${
                        idx === 0
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                          : 'bg-slate-900 border border-slate-800 text-slate-300'
                      }`}
                    >
                      {num}
                    </span>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={onViewTop10}
                className="px-3.5 py-1.5 rounded-xl bg-cyan-950/70 hover:bg-cyan-900/70 border border-cyan-500/40 text-xs text-cyan-300 hover:text-white font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm shadow-cyan-950/50"
              >
                <span>View Top-10 (ထိပ်တန်း ၁၀ လုံး)</span>
                <ChevronRight className="w-3.5 h-3.5 text-cyan-400" />
              </button>
            </div>
          )}

          {/* Locked Notice Banner */}
          <div className="mt-4 p-3 bg-amber-950/30 border border-amber-500/30 rounded-xl flex items-center gap-2.5 text-xs text-amber-200">
            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <b>🔒 အတည်ပြုပြီး / မပြောင်းလဲတော့ပါ</b> &bull; Final Lock At Cutoff Time.
            </span>
          </div>
        </>
      )}
    </div>
  );
};
