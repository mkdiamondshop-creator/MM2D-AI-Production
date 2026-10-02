import React from 'react';
import { CheckCircle2, Clock, ShieldCheck, Hash, ExternalLink } from 'lucide-react';
import { MarketSession, VerifiedMarketRecord } from '../types/market';

interface OfficialResultCardProps {
  session: MarketSession;
  resultRecord: VerifiedMarketRecord | undefined;
  isLocked: boolean;
}

export const OfficialResultCard: React.FC<OfficialResultCardProps> = ({
  session,
  resultRecord,
  isLocked,
}) => {
  const sessionName = session === 'AM' ? '12:01 PM (AM)' : '4:30 PM (PM)';

  return (
    <div
      id={`official-result-card-${session.toLowerCase()}`}
      className={`rounded-3xl p-5 sm:p-6 transition-all shadow-xl backdrop-blur-md relative overflow-hidden ${
        resultRecord
          ? 'bg-gradient-to-br from-[#061e1b]/95 via-[#0B0E17]/95 to-[#0B0E17]/95 border-2 border-emerald-500/40 shadow-emerald-500/10'
          : 'bg-[#0B0E17]/90 border border-slate-800/90'
      }`}
    >
      {/* Background glow when result is verified */}
      {resultRecord && (
        <div className="absolute -top-16 -right-16 w-36 h-36 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      )}

      {/* Card Header: Official Settlement Label & Verified Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              Official SET Result ({sessionName})
            </span>
            <span className="text-[11px] text-slate-400 font-medium">
              (တရားဝင် ထွက်ရှိသည့်ဂဏန်း)
            </span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            Verified Settlement from Stock Exchange of Thailand
          </div>
        </div>

        <div>
          {resultRecord ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              VERIFIED SETTLEMENT (အတည်ပြုပြီး)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-800/80 text-slate-400 border border-slate-700">
              <Clock className="w-3.5 h-3.5" />
              {isLocked ? 'DRAWING IN PROGRESS' : 'AWAITING SESSION CLOSE'}
            </span>
          )}
        </div>
      </div>

      {/* Official 2D Number Display */}
      {resultRecord ? (
        <div className="py-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-emerald-400/90 uppercase tracking-wider flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5" />
                <span>OFFICIAL 2D WINNING NUMBER</span>
              </div>
              <div className="text-6xl sm:text-7xl font-black font-mono tracking-tight text-emerald-400 drop-shadow-[0_0_25px_rgba(16,185,129,0.35)]">
                {resultRecord.twod}
              </div>
              <div className="text-xs text-slate-300">
                Official closing result for {resultRecord.date} {resultRecord.time}
              </div>
            </div>

            {/* SET & Value associated with this settlement */}
            <div className="bg-slate-950/80 border border-emerald-500/30 rounded-2xl p-4 space-y-3 min-w-[240px]">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Settlement Price Metrics
              </div>

              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400 font-sans">SET Index:</span>
                <span className="font-bold text-white text-sm">
                  {resultRecord.setRaw}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400 font-sans">Trading Value:</span>
                <span className="font-bold text-white text-sm">
                  {resultRecord.valueRaw}
                </span>
              </div>

              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Integrity:</span>
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  {resultRecord.mathematicalCheck?.isMathematicallyConsistent ? '100% Validated' : 'Calibrated'}
                </span>
              </div>
            </div>
          </div>

          {/* Mathematical derivation footnote */}
          <div className="p-3 bg-emerald-950/20 border border-emerald-500/20 rounded-xl text-xs text-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-emerald-300/90">
              Formula: SET last digit ({resultRecord.mathematicalCheck?.setLastDigit ?? '—'}) + Value last integer digit ({resultRecord.mathematicalCheck?.valueLastDigitBeforeDecimal ?? '—'}) = 2D ({resultRecord.twod})
            </span>
            <span className="text-[10px] text-slate-400 font-sans">
              Recorded at {resultRecord.time}
            </span>
          </div>
        </div>
      ) : (
        <div className="py-8 text-center space-y-3">
          <div className="text-5xl font-black font-mono text-slate-700 tracking-wider">
            --
          </div>
          <div className="text-xs text-slate-400 max-w-sm mx-auto">
            {isLocked
              ? `Session locked at cutoff. Official SET settlement will be published at ${sessionName}.`
              : session === 'AM'
              ? 'Awaiting morning session settlement. Official result is released at 12:01 PM.'
              : 'Awaiting afternoon session settlement. Official result is released at 4:30 PM.'}
          </div>
        </div>
      )}
    </div>
  );
};
