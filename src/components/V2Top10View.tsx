import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Layers,
  CheckCircle2,
  ShieldCheck,
  TrendingUp,
  Award,
  BarChart3,
  Check,
  X,
} from 'lucide-react';
import { MarketSession } from '../types/market';
import {
  AutoWeightedV2Candidate,
  AutoWeightedV2ComponentModelId,
  AUTO_WEIGHTED_V2_COMPONENTS,
  ShadowSessionRecord,
} from '../types/autoWeightedV2';

interface V2Top10ViewProps {
  session: MarketSession;
  shadowRecord: ShadowSessionRecord | null;
  onSelectSession?: (session: MarketSession) => void;
  otherSessionAvailable?: boolean;
}

const ENGINE_LABELS: Record<AutoWeightedV2ComponentModelId, { name: string; short: string; color: string; bg: string }> = {
  SESSION_SPECIFIC_SET_VALUE_V1: {
    name: 'Session-Specific SET Value',
    short: 'Session SET',
    color: 'text-sky-400',
    bg: 'bg-sky-500/10 border-sky-500/20',
  },
  SET_VALUE_JOINT_RELATIONSHIP_V1: {
    name: 'SET & Value Joint Relationship',
    short: 'Joint SET-Value',
    color: 'text-indigo-400',
    bg: 'bg-indigo-500/10 border-indigo-500/20',
  },
  VALUE_TO_2D_RELATIONSHIP_V1: {
    name: 'Value-to-2D Direct Relationship',
    short: 'Value-to-2D',
    color: 'text-teal-400',
    bg: 'bg-teal-500/10 border-teal-500/20',
  },
  ALL_TIME_FREQUENCY_V1: {
    name: 'All-Time Historical Frequency',
    short: 'Hist Freq',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
  },
};

export const V2Top10View: React.FC<V2Top10ViewProps> = ({
  session,
  shadowRecord,
  onSelectSession,
  otherSessionAvailable = true,
}) => {
  const [expandedCandidates, setExpandedCandidates] = useState<Record<string, boolean>>({});
  const [showSettlementDetails, setShowSettlementDetails] = useState<boolean>(true);

  const toggleCandidate = (twod: string) => {
    setExpandedCandidates((prev) => ({
      ...prev,
      [twod]: !prev[twod],
    }));
  };

  const toggleExpandAll = () => {
    if (!shadowRecord) return;
    const allExpanded = shadowRecord.immutableV2Output.top10.every((t) => expandedCandidates[t]);
    const newState: Record<string, boolean> = {};
    for (const t of shadowRecord.immutableV2Output.top10) {
      newState[t] = !allExpanded;
    }
    setExpandedCandidates(newState);
  };

  if (!shadowRecord) {
    return (
      <div id="v2-shadow-top10-empty" className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 text-center">
        <div className="flex items-center justify-center space-x-2 text-slate-400 mb-2">
          <Layers className="w-5 h-5 text-indigo-400" />
          <span className="font-semibold text-slate-200">AUTO_WEIGHTED_V2</span>
        </div>
        <p className="text-sm text-slate-400">
          Ensemble awaiting valid market data for today's session.
        </p>
      </div>
    );
  }

  const { immutableV2Output, settlementComparison } = shadowRecord;
  const top10Candidates: AutoWeightedV2Candidate[] = immutableV2Output.candidates.slice(0, 10);
  const actual2D = settlementComparison?.actualSettlement2D || null;
  const allExpanded = immutableV2Output.top10.every((t) => expandedCandidates[t]);
  const liveTickCount = shadowRecord.liveObservationSnapshot?.length || 0;

  return (
    <div id={`v2-shadow-top10-${session.toLowerCase()}`} className="bg-[#0B0E17]/90 border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl backdrop-blur-md">
      {/* Header Bar */}
      <div className="p-4 sm:p-5 border-b border-slate-800/80 bg-[#0F172A]/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2.5">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
            </span>
            <h3 className="font-bold text-white text-base sm:text-lg flex flex-wrap items-center gap-2">
              <span>Consensus Top-10</span>
              <span className="text-xs text-slate-400 font-medium">
                (ထိပ်တန်း ၁၀ ဦးစားပေး)
              </span>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono">
                AUTO_WEIGHTED_V2
              </span>
              {shadowRecord.isFrozenAtLock ? (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-amber-400" />
                  Final Locked
                </span>
              ) : liveTickCount <= 1 ? (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  Early Prediction
                </span>
              ) : (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Refining ({liveTickCount} Ticks)
                </span>
              )}
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Ensemble distribution of 4 statistical engines conditioned on today's live SET + Value.
          </p>
        </div>

        {/* AM / PM Toggle Controls */}
        <div className="flex items-center space-x-2 self-start sm:self-auto">
          {otherSessionAvailable && onSelectSession && (
            <div className="inline-flex rounded-xl bg-slate-950/80 p-0.5 border border-slate-800 text-xs font-semibold">
              <button
                id="btn-session-am"
                onClick={() => onSelectSession('AM')}
                className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                  session === 'AM'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                AM (12:01 PM)
              </button>
              <button
                id="btn-session-pm"
                onClick={() => onSelectSession('PM')}
                className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                  session === 'PM'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                PM (4:30 PM)
              </button>
            </div>
          )}

          <button
            id="btn-toggle-all-candidates"
            onClick={toggleExpandAll}
            className="text-xs px-2.5 py-1 rounded-lg bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800 transition-colors cursor-pointer"
          >
            {allExpanded ? 'Collapse All' : 'Expand All'}
          </button>
        </div>
      </div>

      {/* Engine Weights Banner */}
      <div className="px-4 py-3 bg-slate-950/60 border-b border-slate-800/80">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-slate-400 flex items-center space-x-1.5">
            <BarChart3 className="w-3.5 h-3.5 text-indigo-400" />
            <span>Learned Engine Weights ({session} Session)</span>
          </span>
          <span className="text-[11px] text-slate-400 font-mono">
            Sum = 100.0%
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {AUTO_WEIGHTED_V2_COMPONENTS.map((compId) => {
            const weight = immutableV2Output.weights[compId] || 0;
            const meta = ENGINE_LABELS[compId];
            return (
              <div
                key={compId}
                className={`px-2.5 py-1.5 rounded-lg border text-xs flex items-center justify-between ${meta.bg}`}
              >
                <span className={`font-medium truncate mr-1 ${meta.color}`}>{meta.short}</span>
                <span className="font-mono font-bold text-slate-200">{(weight * 100).toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top-10 Candidate List */}
      <div className="divide-y divide-slate-800/60">
        {top10Candidates.map((candidate) => {
          const isExpanded = !!expandedCandidates[candidate.twod];
          const isHit = actual2D !== null && candidate.twod === actual2D;
          const dominantMeta = ENGINE_LABELS[candidate.dominantEngine] || {
            name: candidate.dominantEngine,
            short: candidate.dominantEngine,
            color: 'text-indigo-400',
            bg: 'bg-indigo-500/10 border-indigo-500/20',
          };

          return (
            <div
              key={candidate.twod}
              id={`candidate-row-${candidate.twod}`}
              className={`transition-colors ${
                isHit ? 'bg-emerald-950/20 border-l-4 border-l-emerald-500' : 'hover:bg-slate-800/30'
              }`}
            >
              {/* Summary Row */}
              <div
                onClick={() => toggleCandidate(candidate.twod)}
                className="p-3.5 sm:px-5 flex items-center justify-between cursor-pointer select-none"
              >
                <div className="flex items-center space-x-3 sm:space-x-4">
                  {/* Rank Badge */}
                  <div
                    className={`w-7 h-7 rounded-md flex items-center justify-center font-bold text-xs font-mono ${
                      candidate.rank === 1
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : candidate.rank === 2
                        ? 'bg-slate-300/20 text-slate-200 border border-slate-400/40'
                        : candidate.rank === 3
                        ? 'bg-amber-700/20 text-amber-400 border border-amber-700/40'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    #{candidate.rank}
                  </div>

                  {/* 2D Number */}
                  <div className="flex items-center space-x-2">
                    <span className="text-xl sm:text-2xl font-black font-mono tracking-wider text-slate-100">
                      {candidate.twod}
                    </span>
                    {isHit && (
                      <span className="flex items-center space-x-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>SETTLED WIN</span>
                      </span>
                    )}
                  </div>

                  {/* Dominant Engine Tag */}
                  <div className="hidden md:flex items-center space-x-1.5">
                    <span className="text-[11px] text-slate-400">Dominant:</span>
                    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${dominantMeta.bg} ${dominantMeta.color}`}>
                      {dominantMeta.short}
                    </span>
                  </div>
                </div>

                {/* Right Metrics: Probability & Supporting Engine Count */}
                <div className="flex items-center space-x-3 sm:space-x-4">
                  {/* Probability progress bar */}
                  <div className="hidden sm:block w-16 md:w-24 bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        candidate.rank === 1
                          ? 'bg-gradient-to-r from-amber-400 to-amber-500'
                          : 'bg-gradient-to-r from-cyan-400 to-blue-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(8, candidate.probability * 100 * 4))}%` }}
                    />
                  </div>

                  <div className="text-right min-w-[55px]">
                    <div className="flex items-center justify-end space-x-1">
                      <span className={`text-sm sm:text-base font-black font-mono ${
                        candidate.rank === 1 ? 'text-amber-300' : 'text-cyan-300'
                      }`}>
                        {(candidate.probability * 100).toFixed(2)}%
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 hidden sm:block uppercase">
                      Prob Mass
                    </div>
                  </div>

                  {/* Supporting Engine Count */}
                  <div className="text-right">
                    <span
                      className={`text-xs px-2 py-1 rounded-md font-medium border inline-flex items-center space-x-1 ${
                        candidate.consensusCount >= 3
                          ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                          : candidate.consensusCount === 2
                          ? 'bg-sky-500/10 text-sky-300 border-sky-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                      title={`${candidate.consensusCount} of 4 engines place this number in their Top-10`}
                    >
                      <Layers className="w-3 h-3" />
                      <span>{candidate.consensusCount}/4 engines</span>
                    </span>
                  </div>

                  {/* Expand Chevron */}
                  <button
                    aria-label={`Toggle candidate ${candidate.twod} details`}
                    className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Mobile Dominant Engine row */}
              <div className="md:hidden px-3.5 pb-2 flex items-center space-x-2 text-xs">
                <span className="text-slate-400">Dominant:</span>
                <span className={`px-2 py-0.5 rounded border font-medium ${dominantMeta.bg} ${dominantMeta.color}`}>
                  {dominantMeta.short}
                </span>
              </div>

              {/* Expandable Detail View */}
              {isExpanded && (
                <div
                  id={`candidate-detail-${candidate.twod}`}
                  className="px-3.5 pb-4 sm:px-5 bg-slate-950/40 border-t border-slate-800/40"
                >
                  <div className="pt-3 mb-2 flex items-center justify-between text-xs text-slate-400">
                    <span className="font-semibold text-slate-300 flex items-center space-x-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Component Engine Attribution for [{candidate.twod}]</span>
                    </span>
                    <span className="text-[11px]">Ensemble Contribution Breakdown</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mt-2">
                    {AUTO_WEIGHTED_V2_COMPONENTS.map((compId) => {
                      const supp = candidate.engineSupports[compId];
                      const meta = ENGINE_LABELS[compId];
                      if (!supp) return null;

                      return (
                        <div
                          key={compId}
                          className={`p-2.5 rounded-lg border bg-slate-900/90 ${
                            supp.rankInModel <= 5
                              ? 'border-indigo-500/40'
                              : supp.rankInModel <= 10
                              ? 'border-slate-700'
                              : 'border-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className={`text-xs font-semibold truncate ${meta.color}`}>
                              {meta.short}
                            </span>
                            <span className="text-[11px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                              Rank #{supp.rankInModel}
                            </span>
                          </div>

                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between text-slate-400">
                              <span>Engine Weight:</span>
                              <span className="font-mono text-slate-200">{(supp.weight * 100).toFixed(1)}%</span>
                            </div>
                            <div className="flex justify-between text-slate-400">
                              <span>Engine Probability:</span>
                              <span className="font-mono text-slate-200">{(supp.probability * 100).toFixed(2)}%</span>
                            </div>
                            <div className="flex justify-between text-slate-400">
                              <span>Contribution Share:</span>
                              <span className="font-mono font-semibold text-indigo-300">
                                {(supp.contributionShare * 100).toFixed(1)}%
                              </span>
                            </div>
                          </div>

                          {/* Top 5 / Top 10 badges */}
                          <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center space-x-1.5">
                            {supp.isInModelTop5 ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-medium">
                                In Top-5
                              </span>
                            ) : supp.isInModelTop10 ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-medium">
                                In Top-10
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-medium">
                                Sub-Top 10
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Auto-Tracked Settlement Evaluation Section (When Settled) */}
      {settlementComparison && (
        <div id="v2-shadow-settlement-evaluation" className="border-t border-slate-800 bg-slate-950/70 p-4 sm:p-5">
          <div
            onClick={() => setShowSettlementDetails((prev) => !prev)}
            className="flex items-center justify-between cursor-pointer"
          >
            <div className="flex items-center space-x-2">
              <Award className="w-4 h-4 text-emerald-400" />
              <h4 className="text-sm font-bold text-slate-200">
                Official Settlement Auto-Tracking ({shadowRecord.targetDate} {shadowRecord.session})
              </h4>
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold">
                Actual: {settlementComparison.actualSettlement2D}
              </span>
            </div>
            <div className="flex items-center space-x-2 text-xs text-slate-400">
              <span>{showSettlementDetails ? 'Hide Evaluation' : 'Show Evaluation'}</span>
              {showSettlementDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>

          {showSettlementDetails && (
            <div className="mt-4 space-y-4">
              {/* Head-to-Head Card */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-xs text-slate-400 block mb-1 font-mono">AUTO_WEIGHTED_V2</span>
                  <div className="flex items-baseline space-x-2">
                    <span className="text-lg font-black font-mono text-indigo-400">
                      Rank #{settlementComparison.v2.actualRank}
                    </span>
                    <span className="text-xs text-slate-400">
                      ({(settlementComparison.v2.actualProbability * 100).toFixed(2)}%)
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex space-x-2">
                    <span>LogLoss: {settlementComparison.v2.logLoss.toFixed(3)}</span>
                    <span>MRR: {settlementComparison.v2.reciprocalRank.toFixed(3)}</span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-xs text-slate-400 block mb-1">Historical Frequency Baseline</span>
                  <div className="flex items-baseline space-x-2">
                    <span className="text-lg font-black font-mono text-amber-400">
                      Rank #{settlementComparison.champion.actualRank}
                    </span>
                    <span className="text-xs text-slate-400">
                      ({(settlementComparison.champion.actualProbability * 100).toFixed(2)}%)
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex space-x-2">
                    <span>LogLoss: {settlementComparison.champion.logLoss.toFixed(3)}</span>
                    <span>MRR: {settlementComparison.champion.reciprocalRank.toFixed(3)}</span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-xs text-slate-400 block mb-1">Outcome Delta</span>
                  <div className="flex items-baseline space-x-2">
                    <span
                      className={`text-lg font-black font-mono ${
                        settlementComparison.delta.winner === 'V2'
                          ? 'text-emerald-400'
                          : settlementComparison.delta.winner === 'CHAMPION'
                          ? 'text-amber-400'
                          : 'text-slate-300'
                      }`}
                    >
                      {settlementComparison.delta.winner === 'V2'
                        ? 'V2 Ahead'
                        : settlementComparison.delta.winner === 'CHAMPION'
                        ? 'Baseline Ahead'
                        : 'Tie'}
                    </span>
                    <span className="text-xs text-slate-400">
                      ({settlementComparison.delta.rankDifference > 0 ? '+' : ''}
                      {settlementComparison.delta.rankDifference} ranks)
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Δ LogLoss: {settlementComparison.delta.deltaLogLoss > 0 ? '+' : ''}
                    {settlementComparison.delta.deltaLogLoss.toFixed(4)}
                  </div>
                </div>
              </div>

              {/* Per-Engine Performance Breakdown */}
              {settlementComparison.perEnginePerformance && (
                <div>
                  <h5 className="text-xs font-semibold text-slate-300 mb-2">
                    Per-Engine Settlement Attribution for Actual [{settlementComparison.actualSettlement2D}]
                  </h5>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    {AUTO_WEIGHTED_V2_COMPONENTS.map((compId) => {
                      const perf = settlementComparison.perEnginePerformance?.[compId];
                      const meta = ENGINE_LABELS[compId];
                      if (!perf) return null;

                      return (
                        <div key={compId} className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-xs">
                          <div className="flex justify-between items-center mb-1">
                            <span className={`font-semibold ${meta.color}`}>{meta.short}</span>
                            <span className="font-mono font-bold text-slate-200">Rank #{perf.rankInModel}</span>
                          </div>
                          <div className="text-slate-400 space-y-0.5 text-[11px]">
                            <div className="flex justify-between">
                              <span>Prob:</span>
                              <span className="font-mono text-slate-200">{(perf.probability * 100).toFixed(2)}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span>LogLoss:</span>
                              <span className="font-mono text-slate-200">{perf.logLoss.toFixed(3)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Top-10 Hit:</span>
                              <span className="font-semibold flex items-center">
                                {perf.isTop10Hit ? (
                                  <span className="text-emerald-400 flex items-center">
                                    <Check className="w-3 h-3 mr-0.5" /> Hit
                                  </span>
                                ) : (
                                  <span className="text-slate-400 flex items-center">
                                    <X className="w-3 h-3 mr-0.5" /> Miss
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer Audit Guarantee */}
      <div className="px-4 py-2.5 bg-slate-950 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
        <span className="flex items-center space-x-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Strict Pre-Lock Immutability & Anti-Leakage Enforced</span>
        </span>
        <span className="text-slate-400 font-sans">
          Verified Official SET Sync
        </span>
      </div>
    </div>
  );
};
