import React, { useState, useMemo } from 'react';
import { ArrowLeft, Flame, Clock, Calendar, AlertTriangle, ShieldCheck } from 'lucide-react';
import { VerifiedMarketRecord } from '../types/market';
import { calculateHotAndUnseen, HotUnseenSessionFilter } from '../core/market/hotUnseenCalculator';

interface HotUnseenViewProps {
  records: VerifiedMarketRecord[];
  onBack: () => void;
}

export const HotUnseenView: React.FC<HotUnseenViewProps> = ({ records, onBack }) => {
  const [sessionFilter, setSessionFilter] = useState<HotUnseenSessionFilter>('ALL');
  const [activeSection, setActiveSection] = useState<'HOT' | 'UNSEEN'>('HOT');

  const analysis = useMemo(() => {
    return calculateHotAndUnseen(records, sessionFilter, 30);
  }, [records, sessionFilter]);

  const {
    windowTradingDays,
    totalSessionsInWindow,
    dateRange,
    hotNumbers,
    unseenNumbers,
  } = analysis;

  return (
    <div id="mm2d-hot-unseen-view" className="space-y-6 pb-24 animate-in fade-in duration-150">
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
              <Flame className="w-5 h-5 text-amber-400" />
              <h1 className="text-base sm:text-lg font-black text-white uppercase tracking-tight">
                Hot & Unseen Numbers
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              ဂဏန်းအပူနှင့် မထွက်သေးသောဂဏန်းများ (ရက် ၃၀ စာရင်းအင်း)
            </p>
          </div>
        </div>

        {/* AM / PM / ALL Session Filter Tabs */}
        <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setSessionFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              sessionFilter === 'ALL'
                ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            ALL (အားလုံး)
          </button>
          <button
            type="button"
            onClick={() => setSessionFilter('AM')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              sessionFilter === 'AM'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            AM (မနက်)
          </button>
          <button
            type="button"
            onClick={() => setSessionFilter('PM')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              sessionFilter === 'PM'
                ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-md shadow-purple-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            PM (ညနေ)
          </button>
        </div>
      </div>

      {/* Overview Info Banner */}
      <div className="bg-[#0B0E17]/90 border border-slate-800/80 rounded-2xl p-4 shadow-lg flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-300">
          <Calendar className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>
            Analysis Window: <strong className="text-white">{windowTradingDays} Trading Days</strong>
            {dateRange && (
              <span className="text-slate-400 ml-1 font-mono text-[11px]">
                ({dateRange.start} ~ {dateRange.end})
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-cyan-400 bg-cyan-950/60 px-2.5 py-1 rounded-lg border border-cyan-800/40">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>{totalSessionsInWindow} Official Sessions Verified</span>
        </div>
      </div>

      {/* Sub-Tabs: Hot vs Unseen */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setActiveSection('HOT')}
          className={`py-3 px-4 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
            activeSection === 'HOT'
              ? 'bg-amber-500/10 border-amber-500/40 text-amber-300 shadow-lg shadow-amber-500/10'
              : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider">
              <Flame className="w-4 h-4 text-amber-400" />
              <span>🔥 Hot Numbers</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              အထွက်များသော ဂဏန်းအပူများ
            </div>
          </div>
          <span className="font-mono text-base font-black text-white">
            {hotNumbers.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('UNSEEN')}
          className={`py-3 px-4 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
            activeSection === 'UNSEEN'
              ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300 shadow-lg shadow-cyan-500/10'
              : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider">
              <Clock className="w-4 h-4 text-cyan-400" />
              <span>⏳ Unseen Numbers</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              မထွက်သေးသော ဂဏန်းများ
            </div>
          </div>
          <span className="font-mono text-base font-black text-white">
            {unseenNumbers.length}
          </span>
        </button>
      </div>

      {/* SECTION 1: HOT NUMBERS */}
      {activeSection === 'HOT' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1 text-xs">
            <span className="font-semibold text-slate-300">
              Ranked by Appearance Frequency in latest 30 trading days
            </span>
            <span className="text-slate-400 font-mono text-[11px]">
              {hotNumbers.length} numbers appeared
            </span>
          </div>

          {hotNumbers.length === 0 ? (
            <div className="p-8 text-center bg-slate-900/40 border border-slate-800 rounded-2xl text-slate-400 text-xs">
              No verified settlement records found for this session window.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {hotNumbers.map((item) => (
                <div
                  key={item.twod}
                  className="bg-slate-900/80 border border-slate-800/80 hover:border-amber-500/40 rounded-xl p-3 flex flex-col justify-between transition group shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                      #{item.rank}
                    </span>
                    <span className="text-[11px] font-mono text-amber-400 font-semibold">
                      {item.count} ကြိမ် ({item.percentage}%)
                    </span>
                  </div>

                  <div className="my-2 text-center">
                    <span className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-white group-hover:text-amber-300 transition-colors">
                      {item.twod}
                    </span>
                  </div>

                  <div className="text-[10px] text-slate-500 font-mono text-center truncate">
                    {item.lastSeenDate ? `နောက်ဆုံး: ${item.lastSeenDate}` : 'ရက်စွဲမရှိ'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: UNSEEN NUMBERS */}
      {activeSection === 'UNSEEN' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1 text-xs">
            <span className="font-semibold text-slate-300">
              Numbers with 0 appearances in the latest 30 trading days ({sessionFilter})
            </span>
            <span className="text-slate-400 font-mono text-[11px]">
              {unseenNumbers.length} numbers unseen
            </span>
          </div>

          {unseenNumbers.length === 0 ? (
            <div className="p-8 text-center bg-slate-900/40 border border-slate-800 rounded-2xl text-slate-400 text-xs">
              All numbers 00–99 have appeared at least once in this window.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {unseenNumbers.map((item) => (
                <div
                  key={item.twod}
                  className="bg-slate-900/60 border border-slate-800/80 hover:border-cyan-500/40 rounded-xl p-3 flex flex-col justify-between transition group shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800/80 text-rose-400 font-semibold">
                      0 ကြိမ်
                    </span>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                      Unseen
                    </span>
                  </div>

                  <div className="my-2 text-center">
                    <span className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-slate-300 group-hover:text-cyan-300 transition-colors">
                      {item.twod}
                    </span>
                  </div>

                  <div className="text-[10px] text-slate-400 font-mono text-center truncate">
                    {item.lastSeenDate ? `နောက်ဆုံး: ${item.lastSeenDate}` : 'မှတ်တမ်းမရှိ'}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Statistical Truth & Disclaimer Notice */}
          <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-800/40 text-amber-200/90 text-xs flex items-start gap-3 shadow-lg">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1 leading-relaxed">
              <strong className="text-amber-300 font-bold block">
                စာရင်းအင်းဆိုင်ရာ သတိပြုချက် (Statistical Probability Notice)
              </strong>
              <p className="text-[11px] text-slate-300">
                ဤစာရင်းသည် သမိုင်းဝင် တရားဝင်ထွက်ဂဏန်းများကိုသာ အခြေခံတွက်ချက်ထားခြင်း ဖြစ်ပါသည်။ မထွက်သေးသောဂဏန်းများသည် နောက်ထွက်ရန် အလားအလာပိုများကြောင်း သင်္ချာနည်းအရ အာမခံချက်မရှိပါ။ (Unseen numbers do not possess a higher mathematical probability of appearing next.)
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
