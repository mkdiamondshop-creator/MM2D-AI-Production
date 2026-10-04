import React, { useState, useEffect } from 'react';
import mm2dSplashImg from '../assets/mm2d_splash.png';

interface SplashScreenProps {
  isInitialized: boolean;
  onFinish: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  isInitialized,
  onFinish,
}) => {
  const [isExiting, setIsExiting] = useState(false);
  const [progress, setProgress] = useState(15);

  useEffect(() => {
    // Smooth progress simulation from 15% to 95%
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) {
          return 95;
        }
        const step = prev < 50 ? 8 : prev < 80 ? 5 : 2;
        return Math.min(95, prev + step);
      });
    }, 60);

    return () => clearInterval(progressInterval);
  }, []);

  useEffect(() => {
    let exitTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let finishTimeoutId: ReturnType<typeof setTimeout> | null = null;

    // Hard ceiling: MAXIMUM 3.2 seconds total splash duration
    const maxTimeoutId = setTimeout(() => {
      triggerExit();
    }, 3200);

    // When initialization finishes, fill progress to 100% and transition smoothly
    if (isInitialized) {
      setProgress(100);
      exitTimeoutId = setTimeout(() => {
        triggerExit();
      }, 1600);
    }

    function triggerExit() {
      setProgress(100);
      setIsExiting(true);
      finishTimeoutId = setTimeout(() => {
        onFinish();
      }, 400); // 400ms smooth fade-out transition
    }

    return () => {
      clearTimeout(maxTimeoutId);
      if (exitTimeoutId) clearTimeout(exitTimeoutId);
      if (finishTimeoutId) clearTimeout(finishTimeoutId);
    };
  }, [isInitialized, onFinish]);

  return (
    <div
      id="mm2d-splash-screen"
      role="banner"
      aria-label="MM2D Thai Market AI Splash Screen"
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#070B14] select-none transition-opacity duration-400 ease-out ${
        isExiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      {/* 1. Full-Screen Splash Background Image: mm2d_splash.png (preserves existing artwork) */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <img
          src={mm2dSplashImg}
          alt="MM2D Thai Market AI Splash Background"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover object-center filter brightness-100 contrast-105"
          onError={(e) => {
            const target = e.currentTarget;
            if (target.src !== '/mm2d_splash.png') {
              target.src = '/mm2d_splash.png';
            }
          }}
        />

        {/* Subtle dark vignette overlay to accentuate contrast for lower loading controls */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#070B14]/80 via-transparent to-[#070B14]/30 pointer-events-none" />
      </div>

      {/* 2. MM2D Loading Animation in Lower Third (matching reference design) */}
      <div className="absolute bottom-16 sm:bottom-20 md:bottom-24 left-0 right-0 z-10 flex flex-col items-center justify-center px-6 pointer-events-none space-y-3.5 sm:space-y-4">
        {/* Glowing Cyan/Blue Progress Bar */}
        <div className="w-64 sm:w-72 md:w-80 h-3 sm:h-3.5 rounded-full bg-[#030d1c]/80 border border-cyan-400/50 p-0.5 shadow-[0_0_20px_rgba(6,182,212,0.45)] relative overflow-hidden backdrop-blur-sm">
          {/* Active Progress Fill */}
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-600 via-cyan-400 to-sky-300 transition-all duration-300 ease-out relative overflow-hidden shadow-[0_0_12px_rgba(34,211,238,0.9)]"
            style={{ width: `${progress}%` }}
          >
            {/* Shimmer light sweep */}
            <div className="absolute inset-0 mm2d-progress-sweep" />
          </div>
        </div>

        {/* Loading... Typography */}
        <div className="text-xs sm:text-sm font-semibold tracking-[0.25em] text-white/95 uppercase drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
          Loading...
        </div>

        {/* 4 Subtle Pulsing Cyan Dots */}
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)] mm2d-dot-pulse-1" />
          <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)] mm2d-dot-pulse-2" />
          <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)] mm2d-dot-pulse-3" />
          <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)] mm2d-dot-pulse-4" />
        </div>
      </div>

      {/* Scoped CSS animations for shimmer & dots */}
      <style>{`
        @keyframes mm2dSweep {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(200%);
          }
        }

        .mm2d-progress-sweep {
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.7),
            transparent
          );
          animation: mm2dSweep 1.5s infinite ease-in-out;
        }

        @keyframes mm2dDotPulse {
          0%, 100% {
            opacity: 0.35;
            transform: scale(0.85);
          }
          50% {
            opacity: 1;
            transform: scale(1.25);
            box-shadow: 0 0 12px rgba(34, 211, 238, 1);
          }
        }

        .mm2d-dot-pulse-1 {
          animation: mm2dDotPulse 1.2s infinite ease-in-out;
          animation-delay: 0s;
        }
        .mm2d-dot-pulse-2 {
          animation: mm2dDotPulse 1.2s infinite ease-in-out;
          animation-delay: 0.2s;
        }
        .mm2d-dot-pulse-3 {
          animation: mm2dDotPulse 1.2s infinite ease-in-out;
          animation-delay: 0.4s;
        }
        .mm2d-dot-pulse-4 {
          animation: mm2dDotPulse 1.2s infinite ease-in-out;
          animation-delay: 0.6s;
        }
      `}</style>
    </div>
  );
};
