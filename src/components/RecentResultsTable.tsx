import React from 'react';
import { Calendar, Hash, ArrowUpRight } from 'lucide-react';
import { RecentDayResult } from '../core/market/officialResultAdapter';

interface RecentResultsTableProps {
  recentHistory: RecentDayResult[];
  loading: boolean;
}

export const RecentResultsTable: React.FC<RecentResultsTableProps> = ({
  recentHistory,
  loading,
}) => {
  return (
    <div
      id="recent-official-results-card"
      className="bg-[#0B0E17]/90 border border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-lg backdrop-blur-md space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-cyan-400" />
            <h2 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wide">
              Recent Official Results
            </h2>
            <span className="text-[11px] text-slate-400 font-medium">
              (လတ်တလော ထွက်ရှိထားသော တရားဝင်ပေါက်ဂဏန်းများ)
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Confirmed SET settlements strictly ordered by market date
          </p>
        </div>

        <div className="text-[11px] text-slate-400 font-mono">
          Showing latest {recentHistory.length} trading days
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="py-2.5 px-3 font-semibold">Date (ရက်စွဲ)</th>
              <th className="py-2.5 px-3 font-semibold text-center text-cyan-400">
                12:01 PM (AM)
              </th>
              <th className="py-2.5 px-3 font-semibold text-center text-purple-400">
                4:30 PM (PM)
              </th>
              <th className="py-2.5 px-3 font-semibold text-right">SET Index</th>
              <th className="py-2.5 px-3 font-semibold text-right">Value (THB M)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
            {recentHistory.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-500 font-sans">
                  {loading ? 'Loading verified history from Cloudflare D1...' : 'No confirmed records available.'}
                </td>
              </tr>
            ) : (
              recentHistory.map((item) => (
                <tr
                  key={item.date}
                  className="hover:bg-slate-800/30 transition-colors group"
                >
                  <td className="py-2.5 px-3 text-slate-300 font-sans font-medium flex items-center gap-1.5">
                    <span>{item.date}</span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {item.am ? (
                      <span className="inline-block font-black text-cyan-300 text-sm px-2.5 py-0.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 group-hover:border-cyan-500/40">
                        {item.am.twod}
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {item.pm ? (
                      <span className="inline-block font-black text-purple-300 text-sm px-2.5 py-0.5 rounded-lg bg-purple-500/10 border border-purple-500/20 group-hover:border-purple-500/40">
                        {item.pm.twod}
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-300">
                    {item.pm?.setRaw || item.am?.setRaw || '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-300">
                    {item.pm?.valueRaw || item.am?.valueRaw || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
