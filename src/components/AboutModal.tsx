import React from 'react';
import { X, Info, ShieldCheck, Database, Zap, Code, Sliders } from 'lucide-react';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDevDiagnostics: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({
  isOpen,
  onClose,
  onOpenDevDiagnostics,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-md bg-[#0B0E17] border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl z-10 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Info className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm sm:text-base font-black text-white uppercase tracking-wide">
              About MM 2D Daily
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Basic Project Information */}
        <div className="space-y-3 text-xs text-slate-300">
          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white text-sm">MM 2D Daily</span>
              <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-cyan-950 text-cyan-300 border border-cyan-800/40">
                v2.0.0 (Production)
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              မြန်မာ ၂လုံး ထိုင်းစတော့ဈေးကွက် (SET) အချိန်နှင့်တပြေးညီ တရားဝင်ဒေတာ စိစစ်ချက်နှင့် အယ်လဂိုရီသမ် စာရင်းအင်း သုတေသန စနစ်။
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-900/40 border border-slate-800/60">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-slate-200">Official SET Ground Truth</span>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  ထိုင်းစတော့ဈေးကွက် တရားဝင် အပိတ်ဂဏန်းများဖြင့်သာ တိုက်ရိုက်တွက်ချက်ထားပြီး အတုအယောင်ဒေတာ လုံးဝအသုံးမပြုပါ။
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-900/40 border border-slate-800/60">
              <Database className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-slate-200">D1 Edge SQLite Architecture</span>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Cloudflare Workers နှင့် D1 SQLite ကို အသုံးပြုထားပြီး မြန်ဆန်တိကျသော ဒေတာရရှိစေပါသည်။
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer & Internal Developer Diagnostics */}
        <div className="border-t border-slate-800 pt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenDevDiagnostics();
            }}
            className="text-[11px] text-slate-500 hover:text-amber-400 transition flex items-center gap-1 cursor-pointer"
          >
            <Sliders className="w-3 h-3 text-amber-500" />
            <span>Developer Diagnostics</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition cursor-pointer"
          >
            ပိတ်မည် (Close)
          </button>
        </div>
      </div>
    </div>
  );
};
