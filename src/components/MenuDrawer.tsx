import React from 'react';
import { X, Binary, Flame, Info, Sliders, ChevronRight } from 'lucide-react';

interface MenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSetLastDigit: () => void;
  onSelectHotUnseen: () => void;
  onSelectAbout: () => void;
  onOpenDevDiagnostics: () => void;
}

export const MenuDrawer: React.FC<MenuDrawerProps> = ({
  isOpen,
  onClose,
  onSelectSetLastDigit,
  onSelectHotUnseen,
  onSelectAbout,
  onOpenDevDiagnostics,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Container */}
      <div className="relative w-full max-w-xs sm:max-w-sm bg-[#0B0E17] border-l border-slate-800 h-full p-5 flex flex-col shadow-2xl z-10 animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-black text-white text-xs">
              2D
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">
                မီနူး (Menu)
              </h2>
              <p className="text-[11px] text-slate-400">MM 2D Daily</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Menu Items */}
        <div className="flex-1 py-4 space-y-2.5">
          {/* 1. SET Last Digit Signal (Isolated Experimental Feature) */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectSetLastDigit();
            }}
            className="w-full text-left p-3.5 rounded-xl bg-slate-900/70 hover:bg-slate-800/90 border border-slate-800/80 hover:border-indigo-500/40 transition-all cursor-pointer group flex items-center justify-between"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 group-hover:scale-105 transition-transform">
                <Binary className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white group-hover:text-indigo-300 transition-colors flex items-center gap-1.5">
                  <span>SET Last Digit Signal</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/50">
                    V1
                  </span>
                </div>
                <div className="text-[11px] text-indigo-400/90 font-medium mt-0.5">
                  စတော့ နောက်ဆုံးဒသမဂဏန်း အချက်ပြ
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  ၁ မှ ၃ လုံး သီးခြားခန့်မှန်းချက် (၀–၉)
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-colors shrink-0" />
          </button>

          {/* 2. Hot & Unseen Numbers */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectHotUnseen();
            }}
            className="w-full text-left p-3.5 rounded-xl bg-slate-900/70 hover:bg-slate-800/90 border border-slate-800/80 hover:border-cyan-500/40 transition-all cursor-pointer group flex items-center justify-between"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 group-hover:scale-105 transition-transform">
                <Flame className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors flex items-center gap-1.5">
                  <span>Hot & Unseen Numbers</span>
                </div>
                <div className="text-[11px] text-amber-400/90 font-medium mt-0.5">
                  ဂဏန်းအပူနှင့် မထွက်သေးသောဂဏန်းများ
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  လွန်ခဲ့သော ရက် ၃၀ စာရင်းအင်း
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-cyan-400 transition-colors shrink-0" />
          </button>

          {/* 3. About MM 2D Daily */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectAbout();
            }}
            className="w-full text-left p-3.5 rounded-xl bg-slate-900/70 hover:bg-slate-800/90 border border-slate-800/80 hover:border-cyan-500/40 transition-all cursor-pointer group flex items-center justify-between"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 group-hover:scale-105 transition-transform">
                <Info className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors flex items-center gap-1.5">
                  <span>About MM 2D Daily</span>
                </div>
                <div className="text-[11px] text-cyan-400/90 font-medium mt-0.5">
                  အက်ပ်အကြောင်း
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  ဗားရှင်းနှင့် ပရောဂျက် အချက်အလက်
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-cyan-400 transition-colors shrink-0" />
          </button>
        </div>

        {/* Footer: Keep Developer Diagnostic functionality internally available */}
        <div className="border-t border-slate-800/80 pt-3">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenDevDiagnostics();
            }}
            className="w-full py-2 px-3 rounded-lg text-[11px] text-slate-400 hover:text-amber-300 hover:bg-slate-900/80 transition flex items-center justify-center gap-1.5 border border-dashed border-slate-800 hover:border-amber-500/40 cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5 text-amber-400/80" />
            <span>Developer Diagnostics (စနစ်စစ်ဆေးမှု)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
