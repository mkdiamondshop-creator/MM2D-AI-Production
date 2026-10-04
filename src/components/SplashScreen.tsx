import React, { useState, useEffect } from 'react';
import mm2dSplashImg from '../assets/mm2d_splash.png';
import mm2dLogoImg from '../assets/mm2d_logo.png';

interface SplashScreenProps {
  isInitialized: boolean;
  onFinish: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  isInitialized,
  onFinish,
}) => {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    let exitTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let finishTimeoutId: ReturnType<typeof setTimeout> | null = null;

    // Hard ceiling: MAXIMUM 5.0 seconds total splash duration
    const maxTimeoutId = setTimeout(() => {
      triggerExit();
    }, 4500);

    // If initialization finishes earlier, allow smooth transition after at least 2.5s logo viewing
    if (isInitialized) {
      exitTimeoutId = setTimeout(() => {
        triggerExit();
      }, 2500);
    }

    function triggerExit() {
      setIsExiting(true);
      finishTimeoutId = setTimeout(() => {
        onFinish();
      }, 500); // 500ms fade-out transition, reaching Home strictly <= 5.0s
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
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#070B14] select-none transition-opacity duration-500 ease-out ${
        isExiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      {/* 1. Full-Screen Splash Background Image: mm2d_splash.png */}
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

        {/* Subtle dark vignette overlay to accentuate the center logo and protect contrast */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#070B14]/85 via-transparent to-[#070B14]/60 pointer-events-none" />
      </div>

      {/* 2. Overlay Animated Logo: mm2d_logo.png */}
      <div className="relative z-10 flex flex-col items-center justify-center pointer-events-none px-6">
        <div className="splash-logo-container">
          <img
            src={mm2dLogoImg}
            alt="MM2D Official Logo"
            referrerPolicy="no-referrer"
            className="w-32 h-32 sm:w-40 sm:h-40 md:w-48 md:h-48 object-contain rounded-3xl drop-shadow-[0_12px_36px_rgba(6,182,212,0.45)]"
            onError={(e) => {
              const target = e.currentTarget;
              if (target.src !== '/mm2d_logo.png') {
                target.src = '/mm2d_logo.png';
              }
            }}
          />
        </div>
      </div>

      {/* Keyframe animation scoped for splash logo */}
      <style>{`
        @keyframes mm2dSplashLogoSequence {
          /* 0–0.5 sec: fade in + subtle scale from 95% to 100% */
          0% {
            opacity: 0;
            transform: scale(0.95);
            filter: drop-shadow(0 0 12px rgba(6, 182, 212, 0.25));
          }
          10% {
            opacity: 1;
            transform: scale(1.0);
            filter: drop-shadow(0 0 20px rgba(6, 182, 212, 0.45));
          }
          /* 0.5–1.5 sec: remain smoothly visible */
          30% {
            opacity: 1;
            transform: scale(1.0);
            filter: drop-shadow(0 0 22px rgba(6, 182, 212, 0.5));
          }
          /* 1.5–3.5 sec: subtle professional glow/scale animation */
          50% {
            opacity: 1;
            transform: scale(1.03);
            filter: drop-shadow(0 0 32px rgba(6, 182, 212, 0.8)) drop-shadow(0 0 50px rgba(245, 158, 11, 0.4));
          }
          70% {
            opacity: 1;
            transform: scale(1.0);
            filter: drop-shadow(0 0 24px rgba(6, 182, 212, 0.55));
          }
          /* 3.5–5.0 sec: remain stable */
          100% {
            opacity: 1;
            transform: scale(1.0);
            filter: drop-shadow(0 0 24px rgba(6, 182, 212, 0.55));
          }
        }

        .splash-logo-container {
          animation: mm2dSplashLogoSequence 5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          will-change: transform, opacity, filter;
        }
      `}</style>
    </div>
  );
};
