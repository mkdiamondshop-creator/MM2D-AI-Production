import React from 'react';
import { Clock, Sun, Moon, Lock, CheckCircle2, Activity, Shuffle } from 'lucide-react';
import { MarketSession } from '../types/market';

interface SessionTimelineProps {
  selectedSession: MarketSession;
  onSelectSession: (session: MarketSession) => void;
  isAmLocked: boolean;
  isPmLocked: boolean;
  hasAmResult: boolean;
  hasPmResult: boolean;
  isAmPreOpen: boolean;
  isPmPreOpen: boolean;
  amTickCount: number;
  pmTickCount: number;
}

export const SessionTimeline: React.FC<SessionTimelineProps> = ({
  selectedSession,
  onSelectSession,
  isAmLocked,
  isPmLocked,
  hasAmResult,
  hasPmResult,
  isAmPreOpen,
  isPmPreOpen,
  amTickCount,
  pmTickCount,
}) => {
  return (
    <div
      id="session-timeline-container"
      className="bg-[#0B0E17]/95 border border-slate-800/90 rounded-3xl p-5 sm:p-6 shadow-xl backdrop-blur-md space-y-5"
    >
      {/* Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
              MARKET SESSIONS & TIMELINE
            </span>
            <span className="text-[11px] text-slate-400 font-medium">
              (ဈေးကွက်အပိုင်းအခြား နှင့် အချိန်ဇယား)
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Select session to view synchronized market stages and official settlement
          </p>
        </div>

        <div className="text-[11px] font-mono text-cyan-400/90 bg-cyan-950/60 px-3 py-1 rounded-full border border-cyan-800/50">
          SET Official Schedule
        </div>
      </div>

      {/* 1. AM / PM SESSION — 2-COLUMN BASE GRID */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5 flex items-center justify-between">
          <span>Active Session Target (ရွေးချယ်ထားသော အပိုင်းအခြား)</span>
          <span className="text-[10px] text-slate-500 font-normal">Click to toggle</span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
          {/* AM Session Card */}
          <button
            type="button"
            id="session-card-am"
            onClick={() => onSelectSession('AM')}
            className={`text-left p-3 sm:p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between min-h-[120px] sm:min-h-[140px] min-w-0 group ${
              selectedSession === 'AM'
                ? 'bg-gradient-to-br from-cyan-950/60 via-[#070F1E] to-[#0B0E17] border-cyan-500 shadow-lg shadow-cyan-500/20 ring-1 ring-cyan-400/50'
                : 'bg-slate-950/80 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/50 text-slate-400'
            }`}
          >
            {selectedSession === 'AM' && (
              <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />
            )}

            <div className="flex items-center justify-between gap-1 w-full min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <div className={`p-1.5 rounded-xl shrink-0 transition-colors ${
                  selectedSession === 'AM' ? 'bg-cyan-500/25 text-cyan-300' : 'bg-slate-900 text-slate-400'
                }`}>
                  <Sun className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400 shrink-0" />
                </div>
                <div className="min-w-0">
                  <span className={`text-xs sm:text-sm font-bold uppercase tracking-wide block truncate ${
                    selectedSession === 'AM' ? 'text-white' : 'text-slate-300'
                  }`}>
                    AM Session
                  </span>
                  <span className="text-[10px] text-slate-400 font-sans block truncate">
                    မနက်ပိုင်း
                  </span>
                </div>
              </div>

              {/* Status Indicator Pill */}
              {hasAmResult ? (
                <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                  <span>SETTLED</span>
                </span>
              ) : isAmLocked ? (
                <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_#fbbf24]" />
                  <span>LOCKED</span>
                </span>
              ) : amTickCount > 0 ? (
                <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_6px_#38bdf8]" />
                  <span>REFINING</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700 shrink-0">
                  <span>WAITING</span>
                </span>
              )}
            </div>

            <div className="pt-2 min-w-0">
              <div className={`text-lg sm:text-2xl font-black font-mono tracking-tight truncate ${
                selectedSession === 'AM' ? 'text-cyan-300' : 'text-slate-300'
              }`}>
                12:01 PM
              </div>
              <div className="text-[10px] sm:text-[11px] text-slate-400 flex items-center justify-between gap-1 mt-0.5 min-w-0">
                <span className="truncate">Settlement (11:31 MMT)</span>
                {selectedSession === 'AM' && (
                  <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-cyan-400 font-mono shrink-0">
                    ACTIVE
                  </span>
                )}
              </div>
            </div>
          </button>

          {/* PM Session Card */}
          <button
            type="button"
            id="session-card-pm"
            onClick={() => onSelectSession('PM')}
            className={`text-left p-3 sm:p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between min-h-[120px] sm:min-h-[140px] min-w-0 group ${
              selectedSession === 'PM'
                ? 'bg-gradient-to-br from-purple-950/60 via-[#100C1F] to-[#0B0E17] border-purple-500 shadow-lg shadow-purple-500/20 ring-1 ring-purple-400/50'
                : 'bg-slate-950/80 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/50 text-slate-400'
            }`}
          >
            {selectedSession === 'PM' && (
              <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl pointer-events-none" />
            )}

            <div className="flex items-center justify-between gap-1 w-full min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <div className={`p-1.5 rounded-xl shrink-0 transition-colors ${
                  selectedSession === 'PM' ? 'bg-purple-500/25 text-purple-300' : 'bg-slate-900 text-slate-400'
                }`}>
                  <Moon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-400 shrink-0" />
                </div>
                <div className="min-w-0">
                  <span className={`text-xs sm:text-sm font-bold uppercase tracking-wide block truncate ${
                    selectedSession === 'PM' ? 'text-white' : 'text-slate-300'
                  }`}>
                    PM Session
                  </span>
                  <span className="text-[10px] text-slate-400 font-sans block truncate">
                    ညနေပိုင်း
                  </span>
                </div>
              </div>

              {/* Status Indicator Pill */}
              {hasPmResult ? (
                <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                  <span>SETTLED</span>
                </span>
              ) : isPmLocked ? (
                <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_#fbbf24]" />
                  <span>LOCKED</span>
                </span>
              ) : pmTickCount > 0 ? (
                <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse shadow-[0_0_6px_#c084fc]" />
                  <span>REFINING</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700 shrink-0">
                  <span>WAITING</span>
                </span>
              )}
            </div>

            <div className="pt-2 min-w-0">
              <div className={`text-lg sm:text-2xl font-black font-mono tracking-tight truncate ${
                selectedSession === 'PM' ? 'text-purple-300' : 'text-slate-300'
              }`}>
                4:30 PM
              </div>
              <div className="text-[10px] sm:text-[11px] text-slate-400 flex items-center justify-between gap-1 mt-0.5 min-w-0">
                <span className="truncate">Settlement (4:00 MMT)</span>
                {selectedSession === 'PM' && (
                  <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-purple-400 font-mono shrink-0">
                    ACTIVE
                  </span>
                )}
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* 2. MARKET SESSION & TIMELINE — 2-COLUMN BASE GRID (Cards 1-4: 2 cols, Card 5: col-span-2) */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5 flex items-center justify-between">
          <span>5 Official Settlement Stages ({selectedSession} Timeline)</span>
          <span className="text-[10px] font-mono text-cyan-400/90">2-Column Grid</span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5">
          {selectedSession === 'AM' ? (
            <>
              {/* AM Stage 1: Pre-Open (Col 1) */}
              <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-3 sm:p-4 flex flex-col justify-between space-y-2 min-h-[110px] sm:min-h-[115px] min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs min-w-0">
                  <span className="font-bold text-slate-200 truncate">1. Pre-Open I</span>
                  <span className="font-mono text-[9px] sm:text-[10px] text-cyan-400 bg-cyan-950/60 px-1.5 sm:px-2 py-0.5 rounded-full border border-cyan-800/50 shrink-0">
                    09:30 BKK
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">Order Matching</div>
                  <div className="text-[10px] sm:text-[11px] text-slate-400 truncate">09:00 MMT (ဈေးကွက်ကြို)</div>
                </div>
                <div className="text-[9px] sm:text-[10px] text-slate-500 font-mono flex items-center gap-1 pt-1 border-t border-slate-800/60 truncate">
                  <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="truncate">09:30 → T1</span>
                </div>
              </div>

              {/* AM Stage 2: Actual Market Open (Col 2) */}
              <div className={`rounded-2xl p-3 sm:p-4 border flex flex-col justify-between space-y-2 min-h-[110px] sm:min-h-[115px] min-w-0 transition-all ${
                !isAmPreOpen
                  ? 'bg-cyan-950/30 border-cyan-500/40 text-cyan-200 shadow-sm'
                  : 'bg-slate-900/80 border-slate-800/90 text-slate-400'
              }`}>
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs min-w-0">
                  <span className="font-bold text-slate-100 flex items-center gap-1 truncate">
                    <Shuffle className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-cyan-400 shrink-0" />
                    <span className="truncate">2. Market Open</span>
                  </span>
                  <span className="font-mono text-[9px] sm:text-[10px] text-cyan-300 bg-slate-900 px-1.5 sm:px-2 py-0.5 rounded-full border border-slate-700 shrink-0">
                    T1 Window
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">Random Opening</div>
                  <div className="text-[10px] sm:text-[11px] text-slate-300 truncate">09:55–10:00 BKK</div>
                </div>
                <div className="text-[9px] sm:text-[10px] text-cyan-400/90 font-mono pt-1 border-t border-slate-800/60 truncate">
                  SET Algorithm
                </div>
              </div>

              {/* AM Stage 3: Live Refining (Col 1) */}
              <div className={`rounded-2xl p-3 sm:p-4 border flex flex-col justify-between space-y-2 min-h-[110px] sm:min-h-[115px] min-w-0 transition-all ${
                !isAmPreOpen && !isAmLocked
                  ? 'bg-blue-950/35 border-blue-500/40 text-blue-200 shadow-sm'
                  : 'bg-slate-900/80 border-slate-800/90 text-slate-400'
              }`}>
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs min-w-0">
                  <span className="font-bold text-slate-100 truncate">3. Live Refining</span>
                  <span className="font-mono text-[9px] sm:text-[10px] text-blue-300 bg-slate-900 px-1.5 sm:px-2 py-0.5 rounded-full border border-slate-700 shrink-0">
                    Trading I
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">Ensemble Tuning</div>
                  <div className="text-[10px] sm:text-[11px] text-slate-300 truncate">T1 → 12:00 BKK</div>
                </div>
                <div className="text-[9px] sm:text-[10px] font-medium flex items-center gap-1 text-cyan-400 pt-1 border-t border-slate-800/60 truncate">
                  <Activity className="w-3 h-3 animate-pulse shrink-0" />
                  <span className="truncate">{amTickCount > 0 ? `${amTickCount} Ticks` : 'Awaiting Ingestion'}</span>
                </div>
              </div>

              {/* AM Stage 4: Final Prediction Lock (Col 2) */}
              <div className={`rounded-2xl p-3 sm:p-4 border flex flex-col justify-between space-y-2 min-h-[110px] sm:min-h-[115px] min-w-0 transition-all ${
                isAmLocked
                  ? 'bg-amber-950/35 border-amber-500/50 text-amber-200 shadow-md shadow-amber-500/10'
                  : 'bg-slate-900/80 border-slate-800/90 text-slate-400'
              }`}>
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs min-w-0">
                  <span className="font-bold text-slate-100 truncate">4. Final Lock</span>
                  <span className="font-mono text-[9px] sm:text-[10px] text-amber-400 bg-slate-900 px-1.5 sm:px-2 py-0.5 rounded-full border border-slate-700 shrink-0">
                    Cutoff
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">Prediction Frozen</div>
                  <div className="text-[10px] sm:text-[11px] text-amber-300 font-mono truncate">12:00:59 BKK</div>
                </div>
                <div className="text-[9px] sm:text-[10px] font-medium flex items-center gap-1 text-amber-400 pt-1 border-t border-slate-800/60 truncate">
                  <Lock className="w-3 h-3 shrink-0" />
                  <span className="truncate">{isAmLocked ? 'LOCKED' : 'Lock at Cutoff'}</span>
                </div>
              </div>

              {/* AM Stage 5: Official 2D Result (Spans full width: col-span-2) */}
              <div className={`col-span-2 rounded-2xl p-3.5 sm:p-4 border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 min-h-[85px] min-w-0 transition-all ${
                hasAmResult
                  ? 'bg-emerald-950/35 border-emerald-500/50 text-emerald-200 shadow-md shadow-emerald-500/10'
                  : 'bg-slate-900/80 border-slate-800/90 text-slate-400'
              }`}>
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 text-xs min-w-0">
                    <span className="font-bold text-slate-100 truncate">5. Official 2D Result</span>
                    <span className="font-mono text-[9px] sm:text-[10px] text-emerald-400 bg-slate-900 px-2 py-0.5 rounded-full border border-slate-700 shrink-0">
                      SET Settlement
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-white truncate">
                    Stock Exchange of Thailand Official Settlement
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-emerald-300 font-mono truncate">
                    12:01:00 BKK • (11:31:00 MMT)
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                  <div className="text-[10px] sm:text-[11px] font-medium flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-950/70 border border-slate-800 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{hasAmResult ? 'Verified by SET' : 'Awaiting Settlement'}</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* PM Stage 1: Pre-Open (Col 1) */}
              <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-3 sm:p-4 flex flex-col justify-between space-y-2 min-h-[110px] sm:min-h-[115px] min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs min-w-0">
                  <span className="font-bold text-slate-200 truncate">1. Pre-Open II</span>
                  <span className="font-mono text-[9px] sm:text-[10px] text-purple-400 bg-purple-950/60 px-1.5 sm:px-2 py-0.5 rounded-full border border-purple-800/50 shrink-0">
                    13:30 BKK
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">Order Matching</div>
                  <div className="text-[10px] sm:text-[11px] text-slate-400 truncate">13:00 MMT (ဈေးကွက်ကြို)</div>
                </div>
                <div className="text-[9px] sm:text-[10px] text-slate-500 font-mono flex items-center gap-1 pt-1 border-t border-slate-800/60 truncate">
                  <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="truncate">13:30 → T2</span>
                </div>
              </div>

              {/* PM Stage 2: Actual Market Open (Col 2) */}
              <div className={`rounded-2xl p-3 sm:p-4 border flex flex-col justify-between space-y-2 min-h-[110px] sm:min-h-[115px] min-w-0 transition-all ${
                !isPmPreOpen
                  ? 'bg-purple-950/30 border-purple-500/40 text-purple-200 shadow-sm'
                  : 'bg-slate-900/80 border-slate-800/90 text-slate-400'
              }`}>
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs min-w-0">
                  <span className="font-bold text-slate-100 flex items-center gap-1 truncate">
                    <Shuffle className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-purple-400 shrink-0" />
                    <span className="truncate">2. Market Open</span>
                  </span>
                  <span className="font-mono text-[9px] sm:text-[10px] text-purple-300 bg-slate-900 px-1.5 sm:px-2 py-0.5 rounded-full border border-slate-700 shrink-0">
                    T2 Window
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">Random Opening</div>
                  <div className="text-[10px] sm:text-[11px] text-slate-300 truncate">13:55–14:00 BKK</div>
                </div>
                <div className="text-[9px] sm:text-[10px] text-purple-400/90 font-mono pt-1 border-t border-slate-800/60 truncate">
                  SET Algorithm
                </div>
              </div>

              {/* PM Stage 3: Live Refining (Col 1) */}
              <div className={`rounded-2xl p-3 sm:p-4 border flex flex-col justify-between space-y-2 min-h-[110px] sm:min-h-[115px] min-w-0 transition-all ${
                !isPmPreOpen && !isPmLocked
                  ? 'bg-indigo-950/35 border-indigo-500/40 text-indigo-200 shadow-sm'
                  : 'bg-slate-900/80 border-slate-800/90 text-slate-400'
              }`}>
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs min-w-0">
                  <span className="font-bold text-slate-100 truncate">3. Live Refining</span>
                  <span className="font-mono text-[9px] sm:text-[10px] text-indigo-300 bg-slate-900 px-1.5 sm:px-2 py-0.5 rounded-full border border-slate-700 shrink-0">
                    Trading II
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">Ensemble Tuning</div>
                  <div className="text-[10px] sm:text-[11px] text-slate-300 truncate">T2 → 16:30 BKK</div>
                </div>
                <div className="text-[9px] sm:text-[10px] font-medium flex items-center gap-1 text-purple-400 pt-1 border-t border-slate-800/60 truncate">
                  <Activity className="w-3 h-3 animate-pulse shrink-0" />
                  <span className="truncate">{pmTickCount > 0 ? `${pmTickCount} Ticks` : 'Awaiting Ingestion'}</span>
                </div>
              </div>

              {/* PM Stage 4: Final Prediction Lock (Col 2) */}
              <div className={`rounded-2xl p-3 sm:p-4 border flex flex-col justify-between space-y-2 min-h-[110px] sm:min-h-[115px] min-w-0 transition-all ${
                isPmLocked
                  ? 'bg-amber-950/35 border-amber-500/50 text-amber-200 shadow-md shadow-amber-500/10'
                  : 'bg-slate-900/80 border-slate-800/90 text-slate-400'
              }`}>
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs min-w-0">
                  <span className="font-bold text-slate-100 truncate">4. Final Lock</span>
                  <span className="font-mono text-[9px] sm:text-[10px] text-amber-400 bg-slate-900 px-1.5 sm:px-2 py-0.5 rounded-full border border-slate-700 shrink-0">
                    Cutoff
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">Prediction Frozen</div>
                  <div className="text-[10px] sm:text-[11px] text-amber-300 font-mono truncate">16:29:59 BKK</div>
                </div>
                <div className="text-[9px] sm:text-[10px] font-medium flex items-center gap-1 text-amber-400 pt-1 border-t border-slate-800/60 truncate">
                  <Lock className="w-3 h-3 shrink-0" />
                  <span className="truncate">{isPmLocked ? 'LOCKED' : 'Lock at Cutoff'}</span>
                </div>
              </div>

              {/* PM Stage 5: Official 2D Result (Spans full width: col-span-2) */}
              <div className={`col-span-2 rounded-2xl p-3.5 sm:p-4 border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 min-h-[85px] min-w-0 transition-all ${
                hasPmResult
                  ? 'bg-emerald-950/35 border-emerald-500/50 text-emerald-200 shadow-md shadow-emerald-500/10'
                  : 'bg-slate-900/80 border-slate-800/90 text-slate-400'
              }`}>
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 text-xs min-w-0">
                    <span className="font-bold text-slate-100 truncate">5. Official 2D Result</span>
                    <span className="font-mono text-[9px] sm:text-[10px] text-emerald-400 bg-slate-900 px-2 py-0.5 rounded-full border border-slate-700 shrink-0">
                      SET Settlement
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-white truncate">
                    Stock Exchange of Thailand Official Settlement
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-emerald-300 font-mono truncate">
                    16:30:00 BKK • (16:00:00 MMT)
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                  <div className="text-[10px] sm:text-[11px] font-medium flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-950/70 border border-slate-800 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{hasPmResult ? 'Verified by SET' : 'Awaiting Settlement'}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};


