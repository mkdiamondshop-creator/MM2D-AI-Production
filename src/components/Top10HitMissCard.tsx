import React from 'react';
import { Target, CheckCircle2, XCircle, Clock, Calendar, BarChart3, ShieldCheck } from 'lucide-react';
import { RollingPerformanceSummary } from '../core/prediction/top10HitMissTracker';

interface Top10HitMissCardProps {
  summary: RollingPerformanceSummary;
}

export const Top10HitMissCard: React.FC<Top10HitMissCardProps> = ({ summary }) => {
  const { am, pm, overall, tradingDays } = summary;

  const amPercent = Math.round((am.hitCount / am.total) * 100);
  const pmPercent = Math.round((pm.hitCount / pm.total) * 100);
  const overallPercent = Math.round((overall.hitCount / overall.total) * 100);

  return (
    <div
      id="top10-hitmiss-tracker-card"
      className="bg-[#0B0E17]/90 border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-xl backdrop-blur-md space-y-5"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Target className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-black text-white uppercase tracking-wide">
                1-Week Top-10 HIT/MISS Tracker
              </h2>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800/60">
                Rolling 5 Days
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              တရားဝင် ၂ လုံး ထွက်ဂဏန်းနှင့် Final AUTO_WEIGHTED_V2 Top 10 ကိုက်ညီမှု စောင့်ကြည့်ချက်
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto text-[11px] font-mono text-slate-400 bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-800">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>Official 2D Ground Truth</span>
        </div>
      </div>

      {/* 3 Summary Metrics: AM, PM, Overall */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {/* AM Session */}
        <div className="bg-slate-900/70 border border-slate-800/90 rounded-xl p-3.5 space-y-2 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
              AM Session (12:01 PM)
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-cyan-950/80 text-cyan-300 border border-cyan-800/40">
              {amPercent}% Rate
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="text-2xl font-black font-mono tracking-tight text-cyan-400">
              {am.ratioText}
            </div>
            <span className="text-xs text-slate-400">5 Trading Days</span>
          </div>
          {/* Visual Mini Progress Bar */}
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-cyan-400 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, amPercent))}%` }}
            />
          </div>
        </div>

        {/* PM Session */}
        <div className="bg-slate-900/70 border border-slate-800/90 rounded-xl p-3.5 space-y-2 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
              PM Session (4:30 PM)
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-purple-950/80 text-purple-300 border border-purple-800/40">
              {pmPercent}% Rate
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="text-2xl font-black font-mono tracking-tight text-purple-400">
              {pm.ratioText}
            </div>
            <span className="text-xs text-slate-400">5 Trading Days</span>
          </div>
          {/* Visual Mini Progress Bar */}
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-purple-400 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, pmPercent))}%` }}
            />
          </div>
        </div>

        {/* Overall Consensus */}
        <div className="bg-slate-900/70 border border-slate-800/90 rounded-xl p-3.5 space-y-2 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
              Overall (10 Sessions)
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-950/80 text-emerald-300 border border-emerald-800/40">
              {overallPercent}% Rate
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="text-2xl font-black font-mono tracking-tight text-emerald-400">
              {overall.ratioText}
            </div>
            <span className="text-xs text-slate-400">Total Consensus</span>
          </div>
          {/* Visual Mini Progress Bar */}
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-cyan-400 to-emerald-400 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, overallPercent))}%` }}
            />
          </div>
        </div>
      </div>

      {/* 5 Trading-Day AM/PM HIT/MISS Details Table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 uppercase tracking-wider">
            <Calendar className="w-3.5 h-3.5 text-cyan-400" />
            <span>5 Trading-Day Session Outcomes</span>
          </div>
          <span className="text-[11px] text-slate-400">
            Automated Retention Window (ရှေးအကျဆုံးအလိုအလျောက်ဖျက်သိမ်း)
          </span>
        </div>

        {tradingDays.length === 0 ? (
          <div className="p-6 text-center bg-slate-900/40 border border-slate-800/60 rounded-xl text-xs text-slate-400">
            Waiting for official settlement records to populate the 5-day observation window.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-800/80">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900/90 text-slate-400 border-b border-slate-800 text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3 font-semibold">Date (ရက်စွဲ)</th>
                  <th className="py-2.5 px-3 font-semibold text-center">AM 2D</th>
                  <th className="py-2.5 px-3 font-semibold text-center">AM Outcome</th>
                  <th className="py-2.5 px-3 font-semibold text-center">PM 2D</th>
                  <th className="py-2.5 px-3 font-semibold text-center">PM Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-950/40 font-mono">
                {tradingDays.map((day) => (
                  <tr key={day.date} className="hover:bg-slate-900/50 transition-colors">
                    {/* Date */}
                    <td className="py-2.5 px-3 font-bold text-slate-200 whitespace-nowrap">
                      {day.date}
                    </td>

                    {/* AM Official 2D */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      {day.am?.officialTwod ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-black text-xs border border-slate-700">
                          {day.am.officialTwod}
                        </span>
                      ) : (
                        <span className="text-slate-600 font-sans text-[11px]">--</span>
                      )}
                    </td>

                    {/* AM Status */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      {day.am ? (
                        day.am.status === 'HIT' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            HIT
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                            <XCircle className="w-3 h-3 text-rose-400" />
                            MISS
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-500 text-[11px] font-sans">
                          <Clock className="w-3 h-3" />
                          Pending
                        </span>
                      )}
                    </td>

                    {/* PM Official 2D */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      {day.pm?.officialTwod ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-slate-800 text-purple-300 font-black text-xs border border-slate-700">
                          {day.pm.officialTwod}
                        </span>
                      ) : (
                        <span className="text-slate-600 font-sans text-[11px]">--</span>
                      )}
                    </td>

                    {/* PM Status */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      {day.pm ? (
                        day.pm.status === 'HIT' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            HIT
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                            <XCircle className="w-3 h-3 text-rose-400" />
                            MISS
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-500 text-[11px] font-sans">
                          <Clock className="w-3 h-3" />
                          Pending
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-slate-500 gap-2 border-t border-slate-800/80 pt-3">
        <span>
          Rule: Official 2D in AUTO_WEIGHTED_V2 Top 10 = HIT, otherwise MISS.
        </span>
        <span className="font-mono text-cyan-400/80">
          5 Trading Days • Max 10 Sessions Window
        </span>
      </div>
    </div>
  );
};
