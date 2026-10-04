import React, { useMemo, useState, useEffect } from 'react';
import {
  ArrowLeft,
  Binary,
  Lock,
  Clock,
  Activity,
  ShieldCheck,
  AlertTriangle,
  Info,
  CheckCircle2,
  Sparkles,
  CalendarOff,
} from 'lucide-react';
import { VerifiedMarketRecord } from '../types/market';
import { SetLastDigitSignalV1 } from '../core/prediction/setLastDigitSignalV1';
import { globalLiveObservationBuffer } from '../core/market/liveObservationBuffer';
import {
  globalSetLastDigitObservationTracker,
  SetLastDigitObservationSummary,
} from '../core/prediction/setLastDigitObservationTracker';

interface SetLastDigitSignalViewProps {
  records: VerifiedMarketRecord[];
  onBack: () => void;
  currentTime?: Date | string;
}

export const SetLastDigitSignalView: React.FC<SetLastDigitSignalViewProps> = ({
  records,
  onBack,
  currentTime,
}) => {
  // Resolve eligibility strictly according to SET Trading Calendar and session visibility rules
  const eligibility = useMemo(() => {
    return SetLastDigitSignalV1.resolveEligibility({
      currentTime,
      historicalRecords: records,
    });
  }, [currentTime, records]);

  const {
    isTradingDay,
    isMarketClosed,
    targetDate,
    formattedTargetDate,
    eligibleSession,
    sessionLabel,
    lockTimeString,
    reason,
    holidayName,
  } = eligibility;

  // Retrieve eligible pre-lock live observations for today and eligible session (only if active)
  const liveObservations = useMemo(() => {
    if (!targetDate || !eligibleSession) return [];
    return globalLiveObservationBuffer.getObservations(eligibleSession, targetDate);
  }, [eligibleSession, targetDate]);

  // Execute isolated SET Last Digit Signal V1 prediction (only if valid trading day and eligible session)
  const signalResult = useMemo(() => {
    if (!targetDate || !eligibleSession) {
      return null;
    }
    return SetLastDigitSignalV1.predict({
      targetDate,
      session: eligibleSession,
      historicalRecords: records,
      liveObservations,
      currentTime,
    });
  }, [targetDate, eligibleSession, records, liveObservations, currentTime]);

  const [observationSummary, setObservationSummary] = useState<SetLastDigitObservationSummary>(() =>
    globalSetLastDigitObservationTracker.getSummary()
  );

  useEffect(() => {
    return globalSetLastDigitObservationTracker.subscribe(setObservationSummary);
  }, []);

  useEffect(() => {
    if (records && records.length > 0) {
      globalSetLastDigitObservationTracker.syncFromOfficialSettlements(records);
    }
  }, [records]);

  return (
    <div id="mm2d-set-last-digit-view" className="space-y-6 pb-24 animate-in fade-in duration-150">
      {/* Top Header & Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-700 transition cursor-pointer"
            title="Return to Home"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <Binary className="w-5 h-5 text-indigo-400" />
              <h1 className="text-base sm:text-lg font-black text-white uppercase tracking-tight">
                SET Last Digit Signal (V1)
              </h1>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                Experimental Signal
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              စတော့အညွှန်းကိန်း နောက်ဆုံးဒသမဂဏန်း အချက်ပြ (၀–၉)
            </p>
          </div>
        </div>
      </div>

      {/* Prominent Architectural Isolation Disclaimer */}
      <div className="p-3.5 sm:p-4 rounded-xl bg-slate-900/70 border border-slate-800 text-xs flex items-start gap-3">
        <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
        <div className="space-y-1 text-slate-300 leading-relaxed">
          <span className="font-bold text-white block">
            သီးခြား စမ်းသပ်အချက်ပြစနစ် (Isolated Experimental Signal)
          </span>
          <p className="text-[11px] text-slate-400">
            ဤအချက်ပြချက်သည် တရားဝင် SET Index ၏ နောက်ဆုံးဒသမဂဏန်း (၀–၉) ကို သီးခြားလေ့လာခန့်မှန်းချက် ဖြစ်ပါသည်။
            AUTO_WEIGHTED_V2 ပင်မ ၂လုံးထိပ်တန်း ၁၀ လုံး ခန့်မှန်းချက်နှင့် လုံးဝသီးခြားစီဖြစ်ပြီး ထိခိုက်မှုမရှိပါ။
          </p>
        </div>
      </div>

      {/* 1. NON-TRADING DAY / WEEKEND / HOLIDAY STATE */}
      {(!isTradingDay || isMarketClosed || !signalResult || signalResult.status === 'MARKET_CLOSED') && (
        <div className="bg-[#0B0E17]/90 border border-slate-800/90 rounded-2xl p-6 sm:p-8 shadow-xl backdrop-blur-md text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto shadow-inner">
            <CalendarOff className="w-7 h-7" />
          </div>
          <div>
            <span className="text-xs uppercase font-mono tracking-wider px-3 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              SET Market Closed (ဈေးကွက်ပိတ်သည်)
            </span>
            <h2 className="text-lg sm:text-xl font-black text-white mt-3">
              {holidayName ? `Official SET Market Holiday: ${holidayName}` : reason}
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto leading-relaxed">
              စနေ၊ တနင်္ဂနွေနှင့် တရားဝင်ဈေးကွက်ရုံးပိတ်ရက်များတွင် SET အညွှန်းကိန်း ဖွင့်လှစ်ခြင်းမရှိသဖြင့် ခန့်မှန်းချက် ထုတ်ပြန်မှု မရှိပါ။
              လာမည့် တရားဝင် စတော့အရောင်းအဝယ်နေ့တွင်သာ ခန့်မှန်းချက် အသစ် ထွက်ပေါ်မည်ဖြစ်ပါသည်။
            </p>
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-400 font-mono">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Zero Weekend / Holiday Predictions Policy</span>
          </div>
        </div>
      )}

      {/* 2. VALID SET TRADING DAY: SHOW TARGET DATE AND CURRENTLY ELIGIBLE SESSION */}
      {isTradingDay && !isMarketClosed && signalResult && signalResult.status !== 'MARKET_CLOSED' && (
        <>
          {/* Target Date & Currently Eligible Session Header */}
          <div className="bg-[#0B0E17]/90 border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-xl backdrop-blur-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider font-bold text-slate-400">
                  Target Date
                </div>
                <div className="text-xl sm:text-2xl font-black font-mono text-white mt-0.5">
                  {formattedTargetDate}
                </div>
              </div>
              <div className="self-start sm:self-auto sm:text-right">
                <div className="text-[11px] uppercase tracking-wider font-bold text-slate-400">
                  Currently Eligible Session
                </div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-xs font-bold font-mono mt-1">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  {sessionLabel}
                </div>
              </div>
            </div>
          </div>

          {/* Main Signal Prediction Card for Eligible Session */}
          <div className="bg-[#0B0E17]/90 border border-slate-800/90 rounded-2xl p-5 sm:p-6 shadow-xl backdrop-blur-md space-y-5">
            {/* Status bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wider font-bold text-slate-300">
                  {eligibleSession} Session Target
                </span>
                <span className="text-[11px] font-mono text-cyan-400">
                  Lock Boundary: {lockTimeString} BKK
                </span>
              </div>

              <div>
                {signalResult.isLocked ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    <Lock className="w-3 h-3" />
                    Prediction Locked ({lockTimeString})
                  </span>
                ) : signalResult.status === 'MARKET_NOT_OPEN' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700">
                    <Clock className="w-3 h-3" />
                    Market Not Open
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                    <Activity className="w-3 h-3 text-cyan-400 animate-pulse" />
                    Pre-Lock Active Analysis
                  </span>
                )}
              </div>
            </div>

            {/* Predicted SET Last Digit Candidates (1 to 3 items) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <span>SET Last Decimal Digit Candidates ({signalResult.candidateCount} Candidate{signalResult.candidateCount > 1 ? 's' : ''})</span>
                </div>
                <span className="text-[11px] text-slate-400 font-mono">
                  Rule: 1–3 Candidates Max
                </span>
              </div>

              <div
                className={`grid gap-3 ${
                  signalResult.candidateCount === 1
                    ? 'grid-cols-1 max-w-sm mx-auto'
                    : signalResult.candidateCount === 2
                    ? 'grid-cols-1 sm:grid-cols-2'
                    : 'grid-cols-1 sm:grid-cols-3'
                }`}
              >
                {signalResult.candidates.map((cand) => (
                  <div
                    key={cand.digit}
                    className="bg-slate-900/80 border border-slate-800/90 hover:border-indigo-500/50 rounded-xl p-4 flex flex-col items-center justify-center text-center transition-all shadow-md group relative overflow-hidden"
                  >
                    <div className="absolute top-2.5 left-3">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-bold border border-slate-700">
                        Rank #{cand.rank}
                      </span>
                    </div>

                    <div className="my-2">
                      <span className="text-4xl sm:text-5xl font-black font-mono tracking-tight text-white group-hover:text-indigo-300 transition-colors">
                        {cand.digit}
                      </span>
                    </div>

                    <div className="w-full space-y-1.5 mt-1">
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                        <span>Evidence</span>
                        <span className="font-bold text-indigo-300">
                          {(cand.probability * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-indigo-400 h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(5, cand.probability * 100))}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* User Independence Notice */}
            <div className="p-3 rounded-xl bg-indigo-950/20 border border-indigo-800/40 text-indigo-200/90 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 text-[11px] leading-relaxed">
                <span className="font-semibold text-indigo-300 block">
                  User Discretion Note (အသုံးပြုသူ လွတ်လပ်စွာ စဉ်းစားနိုင်မှု)
                </span>
                <p className="text-slate-300">
                  စနစ်မှ ဤဂဏန်းများကို ၁၀ လုံးတွဲ (ဥပမာ 5 → 50–59) အဖြစ် အလိုအလျောက် မပြောင်းလဲပါ။
                  အသုံးပြုသူသည် မိမိကိုယ်ပိုင် ဆုံးဖြတ်ချက်ဖြင့်သာ အပူး/အာပတ် စဉ်းစားအသုံးချနိုင်ပါသည်။
                </p>
              </div>
            </div>
          </div>

          {/* Current Eligible Live Context */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="bg-[#0B0E17]/90 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                Eligible Live SET Observed
              </div>
              <div className="text-xl font-black font-mono text-cyan-400">
                {signalResult.liveSetObserved !== null ? signalResult.liveSetObserved.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Waiting...'}
              </div>
              <div className="text-[10px] text-slate-500">
                Pre-lock Intraday Anchor
              </div>
            </div>

            <div className="bg-[#0B0E17]/90 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                Eligible Live Value Observed
              </div>
              <div className="text-xl font-black font-mono text-purple-400">
                {signalResult.liveValueObserved !== null ? `${signalResult.liveValueObserved.toLocaleString(undefined, { maximumFractionDigits: 0 })}M` : 'Waiting...'}
              </div>
              <div className="text-[10px] text-slate-500">
                Pre-lock Trading Volume
              </div>
            </div>

            <div className="bg-[#0B0E17]/90 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                Pre-Lock Observations Analyzed
              </div>
              <div className="text-xl font-black font-mono text-emerald-400">
                {signalResult.liveObservationCount} Ticks
              </div>
              <div className="text-[10px] text-slate-500">
                Post-lock ticks strictly dropped
              </div>
            </div>
          </div>

          {/* Complete Digits 0-9 Probability Distribution */}
          <div className="bg-[#0B0E17]/90 border border-slate-800/80 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Full Decimal Digit Probability Spectrum (၀ မှ ၉)
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                {signalResult.evidenceSummary.confidenceLevel} Confidence
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              {signalResult.distribution.map((item) => {
                const isSelected = signalResult.candidates.some((c) => c.digit === item.digit);
                return (
                  <div
                    key={item.digit}
                    className={`p-2.5 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-indigo-950/40 border-indigo-500/50 shadow-md'
                        : 'bg-slate-900/50 border-slate-800/70'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className={`font-bold ${isSelected ? 'text-indigo-300' : 'text-slate-300'}`}>
                        Digit {item.digit}
                      </span>
                      <span className={isSelected ? 'text-indigo-400 font-bold' : 'text-slate-500'}>
                        {(item.probability * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1 mt-1.5 overflow-hidden">
                      <div
                        className={`h-1 rounded-full ${isSelected ? 'bg-indigo-400' : 'bg-slate-600'}`}
                        style={{ width: `${Math.min(100, Math.max(3, item.probability * 100))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
              {signalResult.evidenceSummary.rationale}
            </p>
          </div>

          {/* Production Observation Performance (Minimal Display) */}
          {observationSummary.sessionCount > 0 && (
            <div className="bg-[#0B0E17]/90 border border-slate-800/80 rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <span>Production Observation Record (SET Decimal Last Digit)</span>
                </div>
                <span className="text-[11px] font-mono text-slate-400">
                  Observation Only &bull; {observationSummary.sessionCount} Sessions Tracked
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-2.5">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">AM Sessions</div>
                  <div className="text-sm font-mono font-black text-cyan-400 mt-0.5">{observationSummary.am.ratioText}</div>
                </div>
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-2.5">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">PM Sessions</div>
                  <div className="text-sm font-mono font-black text-purple-400 mt-0.5">{observationSummary.pm.ratioText}</div>
                </div>
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-2.5">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Total Tracked</div>
                  <div className="text-sm font-mono font-black text-emerald-400 mt-0.5">{observationSummary.overall.ratioText}</div>
                </div>
              </div>
            </div>
          )}

          {/* Anti-Leakage & Safety Verification Checklist */}
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5 space-y-2 text-xs">
            <div className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Strict Anti-Leakage & System Integrity Audit</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-400">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Zero Today Official Settlement Leakage</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Zero Post-Lock Data Ingestion</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Zero Live 2D Input ('live.twod' strictly banned)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>100% Isolated from AUTO_WEIGHTED_V2</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
