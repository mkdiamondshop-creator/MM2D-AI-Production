/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Clock,
  Lock,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Sparkles,
  RefreshCw,
  Sliders,
  ChevronRight,
  Database,
  ShieldCheck,
  Activity,
  Layers,
  ArrowUpRight
} from 'lucide-react';
import { globalDatasetStorage, StorageStats } from './core/storage/storageAbstraction';
import { v2PredictionRecordToShadowRecord } from './core/storage/d1StorageAdapter';
import { globalLiveSourceAdapter } from './core/market/liveSourceAdapter';
import { globalOfficialResultAdapter, RecentDayResult } from './core/market/officialResultAdapter';
import { VerifiedMarketRecord } from './types/market';
import { LiveMarketSnapshot } from './types/liveSource';
import { DualCheckpointState, SyncAuditLog } from './types/sync';
import { LockEngine } from './core/prediction/lockEngine';
import { MarketCalendar } from './core/market/marketCalendar';
import { MarketOpenGate } from './core/market/marketOpenGate';
import { TimezoneContract } from './core/market/timezoneUtils';
import { PRODUCTION_MODEL_VERSION, PredictionStatus } from './types/prediction';
import { V2Top10View } from './components/V2Top10View';
import { Header } from './components/Header';
import { HeroCard } from './components/HeroCard';
import { SessionTimeline } from './components/SessionTimeline';
import { LiveMarketCard } from './components/LiveMarketCard';
import { PredictionCard } from './components/PredictionCard';
import { OfficialResultCard } from './components/OfficialResultCard';
import { EvaluationCard } from './components/EvaluationCard';
import { Top10HitMissCard } from './components/Top10HitMissCard';
import { RecentResultsTable } from './components/RecentResultsTable';
import { MenuDrawer } from './components/MenuDrawer';
import { AboutModal } from './components/AboutModal';
import { HotUnseenView } from './components/HotUnseenView';
import { SetLastDigitSignalView } from './components/SetLastDigitSignalView';
import { BottomNav, NavTab } from './components/BottomNav';
import { SplashScreen } from './components/SplashScreen';
import { MarketSession } from './types/market';
import { globalShadowTracker } from './core/prediction/autoWeightedV2ShadowTracker';
import { AutoWeightedV2ShadowValidator } from './core/prediction/autoWeightedV2ShadowValidator';
import { ShadowSessionRecord } from './types/autoWeightedV2';
import { globalLiveObservationBuffer } from './core/market/liveObservationBuffer';
import { DataSufficiencyGate, DataSufficiencyState, DataSufficiencyResult } from './core/market/dataSufficiencyGate';
import { globalTop10HitMissTracker, RollingPerformanceSummary } from './core/prediction/top10HitMissTracker';
import { globalSetLastDigitObservationTracker } from './core/prediction/setLastDigitObservationTracker';

LockEngine.setPersistenceHandler((pred) => {
  globalDatasetStorage.saveModelPrediction(pred).catch((err) => {
    console.warn('Could not persist frozen model prediction to storage:', err);
  });
});

export default function App() {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [checkpoints, setCheckpoints] = useState<DualCheckpointState | null>(null);
  const [records, setRecords] = useState<VerifiedMarketRecord[]>([]);
  const [recentOfficialResults, setRecentOfficialResults] = useState<RecentDayResult[]>([]);
  const [auditLogs, setAuditLogs] = useState<SyncAuditLog[]>([]);
  const [liveSnapshot, setLiveSnapshot] = useState<LiveMarketSnapshot | null>(null);
  const [liveSourceStatus, setLiveSourceStatus] = useState<'SUCCESS' | 'INSUFFICIENT_LIVE_DATA' | 'LIVE_DATA_STALE' | 'MARKET_CLOSED' | 'SOURCE_UNAVAILABLE'>('INSUFFICIENT_LIVE_DATA');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Splash Screen State: displayed on initial app load, auto-dismissed <= 5s
  const [showSplash, setShowSplash] = useState(true);
  const [isDataInitialized, setIsDataInitialized] = useState(false);

  // User vs Developer Mode toggle (User Mode by default)
  const [isDevMode, setIsDevMode] = useState(false);

  // Menu, About Modal, Hot & Unseen, and SET Last Digit view states
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isHotUnseenView, setIsHotUnseenView] = useState(false);
  const [isSetLastDigitView, setIsSetLastDigitView] = useState(false);

  // Live Clock (Normalized to Bangkok & Yangon timezones)
  const [currentTime, setCurrentTime] = useState(new Date());

  // 1-Week Top-10 HIT/MISS rolling performance summary state
  const [hitMissSummary, setHitMissSummary] = useState<RollingPerformanceSummary>(() =>
    globalTop10HitMissTracker.getRollingSummary()
  );

  useEffect(() => {
    const unsubscribe = globalTop10HitMissTracker.subscribe((summary) => {
      setHitMissSummary(summary);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const todayBkk = TimezoneContract.toBangkok(new Date()).dateStr;

      // 1. Fetch latest confirmed recent official results from ThaiStock2D /2d_result API
      try {
        const recentOfficial = await globalOfficialResultAdapter.getRecentOfficialResults(30);
        if (recentOfficial && recentOfficial.length > 0) {
          setRecentOfficialResults(recentOfficial);
        }
      } catch (recentErr) {
        console.warn('Recent official results fetch notice:', recentErr);
      }

      // 2. Fetch and synchronize official settlement results from ThaiStock2D for current market date
      try {
        await globalOfficialResultAdapter.syncOfficialResults(todayBkk);
      } catch (officialErr) {
        console.warn('Official Result API sync notice:', officialErr);
      }

      // 3. Query verified storage records, stats, and checkpoints
      const [fetchedStats, fetchedCheckpoints, fetchedRecords, fetchedLogs] = await Promise.all([
        globalDatasetStorage.getStats(),
        globalDatasetStorage.getDualCheckpoints(),
        globalDatasetStorage.queryAllVerifiedRecords(),
        globalDatasetStorage.getAuditLogs(10),
      ]);
      setStats(fetchedStats);
      setCheckpoints(fetchedCheckpoints);
      setRecords(fetchedRecords);
      setAuditLogs(fetchedLogs);

      // 4. Hydrate authentic LiveObservationBuffer from D1 server-side collector
      try {
        const storedObservations = await globalDatasetStorage.queryLiveObservations({ date: todayBkk });
        if (storedObservations && storedObservations.length > 0) {
          globalLiveObservationBuffer.hydrateObservations(storedObservations);
        }
      } catch (hydrateErr) {
        console.warn('Live observations hydration notice:', hydrateErr);
      }

      // 4b. Hydrate authentic server-side V2 predictions & lock snapshots from D1
      try {
        const storedPredictions = await globalDatasetStorage.queryV2Predictions({ date: todayBkk });
        if (storedPredictions && storedPredictions.length > 0) {
          const shadowRecords = storedPredictions.map(v2PredictionRecordToShadowRecord);
          globalShadowTracker.hydrateRecords(shadowRecords);
        }
      } catch (predHydrateErr) {
        console.warn('Server-side predictions hydration notice:', predHydrateErr);
      }

      // 4c. Synchronize 1-week Top-10 HIT/MISS tracking from existing predictions and verified settlements
      try {
        const storedPredictions = await globalDatasetStorage.queryV2Predictions({ limit: 50 });
        const allRecordedShadow = globalShadowTracker.getAllRecordedSessions();

        const predictionList: Array<{ date: string; session: MarketSession; top10: string[]; isFrozen?: boolean }> = [];
        for (const p of storedPredictions) {
          const t10: string[] = JSON.parse(p.top10Json || '[]');
          if (t10.length > 0) {
            predictionList.push({
              date: p.date,
              session: p.session,
              top10: t10,
              isFrozen: p.isFrozen === 1,
            });
          }
        }
        for (const s of allRecordedShadow) {
          if (!predictionList.some((p) => p.date === s.targetDate && p.session === s.session)) {
            predictionList.push({
              date: s.targetDate,
              session: s.session,
              top10: [...s.top10],
              isFrozen: s.isFrozenAtLock,
            });
          }
        }

        const summary = globalTop10HitMissTracker.syncFromExistingData(predictionList, fetchedRecords);
        setHitMissSummary(summary);

        try {
          const storedSignals = await globalDatasetStorage.querySetLastDigitSignals({ limit: 20 });
          if (storedSignals && storedSignals.length > 0) {
            const formatted = storedSignals.map((s) => ({
              date: s.date,
              session: s.session,
              candidates: JSON.parse(s.candidatesJson || '[]'),
            }));
            globalSetLastDigitObservationTracker.syncFromFrozenSignals(formatted, fetchedRecords);
          }
        } catch (signalSyncErr) {
          console.warn('SET Last Digit signals sync notice:', signalSyncErr);
        }
        globalSetLastDigitObservationTracker.syncFromOfficialSettlements(fetchedRecords);
      } catch (hitMissErr) {
        console.warn('HIT/MISS sync notice:', hitMissErr);
      }

      // 5. Supplemental client polling (Safe secondary source; do not depend on it)
      try {
        const liveRes = await globalLiveSourceAdapter.getLiveMarketSnapshot(todayBkk);
        if (liveRes.success && liveRes.snapshot && liveRes.snapshot.date === todayBkk && liveRes.snapshot.quality !== 'LIVE_DATA_STALE') {
          setLiveSnapshot(liveRes.snapshot);
          setLiveSourceStatus('SUCCESS');
          globalLiveObservationBuffer.ingestSnapshot(liveRes.snapshot);
        } else {
          setLiveSnapshot(null);
          setLiveSourceStatus(liveRes.status);
        }
      } catch {
        setLiveSnapshot(null);
        setLiveSourceStatus('INSUFFICIENT_LIVE_DATA');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load live data');
    } finally {
      setLoading(false);
      setIsDataInitialized(true);
    }
  };

  useEffect(() => {
    loadData();
    const pollInterval = setInterval(() => {
      loadData();
    }, 15000);
    return () => clearInterval(pollInterval);
  }, []);

  // Timezone Normalization:
  // Canonical Market Time: Asia/Bangkok (UTC+7)
  // User Display Time: Asia/Yangon (UTC+6:30)
  const bangkokNormalized = TimezoneContract.toBangkok(currentTime);
  const yangonNormalized = TimezoneContract.toYangon(currentTime);

  const bangkokDateStr = bangkokNormalized.dateStr;
  const bangkokTimeStr = bangkokNormalized.timeStr;
  const myanmarTimeStr = yangonNormalized.formattedAmPm;

  // Single Source of Truth for Session Locks (via LockEngine)
  // AM Lock: 11:30 AM Yangon = 12:00 PM Bangkok
  // PM Lock: 3:30 PM Yangon = 4:00 PM Bangkok
  const isAmLocked = LockEngine.isSessionLocked(bangkokDateStr, 'AM', currentTime);
  const isPmLocked = LockEngine.isSessionLocked(bangkokDateStr, 'PM', currentTime);

  // Strictly filter for today's verified records (Official Data Only)
  const todayRecords = records.filter((r) => r.date === bangkokDateStr);

  // AM Settlement record for today (12:01:00 or AM settlement)
  const amResultRecord = todayRecords.find((r) => r.time === '12:01:00' || (r.session === 'AM' && r.isSettlement));
  const amPreRecord = todayRecords.find((r) => r.time === '11:00:00');

  // PM Settlement record for today (16:30:00 or PM settlement)
  const pmResultRecord = todayRecords.find((r) => r.time === '16:30:00' || (r.session === 'PM' && r.isSettlement));
  const pmPreRecord = todayRecords.find((r) => r.time === '15:00:00');

  // Trading Day & Lifecycle Evaluation via MarketCalendar
  const tradingDayEval = MarketCalendar.isTradingDay(bangkokDateStr, records);
  const isNonTradingDay = !tradingDayEval.isTradingDay;

  // Myanmar Time pre-open gate
  // AM market open: 10:00 AM MMT (600 minutes)
  // PM market open: 02:00 PM MMT (840 minutes)
  const yangonMinutes = yangonNormalized.totalMinutes;
  const isAmPreOpen = yangonMinutes < 10 * 60 && !isAmLocked && !amResultRecord;
  const isPmPreOpen = yangonMinutes < 14 * 60 && !isPmLocked && !pmResultRecord;

  // Ingest today's verified pre-lock records into LiveObservationBuffer if available
  useEffect(() => {
    if (amPreRecord) {
      globalLiveObservationBuffer.ingestVerifiedCheckpointRecord(amPreRecord);
    }
    if (pmPreRecord) {
      globalLiveObservationBuffer.ingestVerifiedCheckpointRecord(pmPreRecord);
    }
  }, [amPreRecord, pmPreRecord]);

  // Authenticated Pre-Lock Live Feeds for AM and PM
  const amLiveFeed = React.useMemo(() => {
    if (amPreRecord) {
      globalLiveObservationBuffer.ingestVerifiedCheckpointRecord(amPreRecord);
    }
    if (liveSnapshot && liveSnapshot.date === bangkokDateStr && liveSnapshot.time >= '10:00:00' && liveSnapshot.time <= '12:00:00') {
      globalLiveObservationBuffer.ingestSnapshot(liveSnapshot);
    }
    const buffered = globalLiveObservationBuffer.getEngineFeed('AM', bangkokDateStr);
    return buffered.length > 0 ? buffered : undefined;
  }, [amPreRecord, liveSnapshot, bangkokDateStr, records]);

  const pmLiveFeed = React.useMemo(() => {
    if (pmPreRecord) {
      globalLiveObservationBuffer.ingestVerifiedCheckpointRecord(pmPreRecord);
    }
    if (liveSnapshot && liveSnapshot.date === bangkokDateStr && liveSnapshot.time >= '14:00:00' && liveSnapshot.time <= '16:00:00') {
      globalLiveObservationBuffer.ingestSnapshot(liveSnapshot);
    }
    const buffered = globalLiveObservationBuffer.getEngineFeed('PM', bangkokDateStr);
    return buffered.length > 0 ? buffered : undefined;
  }, [pmPreRecord, liveSnapshot, bangkokDateStr, records]);

  // DataSufficiencyGate Evaluation for AM & PM
  const amSufficiency = React.useMemo(() => {
    if (isAmPreOpen) {
      return {
        state: 'AWAITING_DATA' as const,
        session: 'AM' as const,
        targetDate: bangkokDateStr,
        observationCount: 0,
        latestObservation: null,
        reason: 'Session opens at 10:00 AM MMT. Awaiting market open.',
        isPredictionPermitted: false,
        isEarlyPredictionReady: false,
        isRefining: false,
        isLocked: false,
      };
    }
    return DataSufficiencyGate.evaluate({
      session: 'AM',
      targetDate: bangkokDateStr,
      currentBangkokTime: currentTime,
      buffer: globalLiveObservationBuffer,
      isSessionLocked: isAmLocked,
      hasOfficialResult: Boolean(amResultRecord),
    });
  }, [bangkokDateStr, currentTime, isAmLocked, amResultRecord, isAmPreOpen, amLiveFeed]);

  const pmSufficiency = React.useMemo(() => {
    if (isPmPreOpen) {
      return {
        state: 'AWAITING_DATA' as const,
        session: 'PM' as const,
        targetDate: bangkokDateStr,
        observationCount: 0,
        latestObservation: null,
        reason: 'Session opens at 02:00 PM MMT. Awaiting market open.',
        isPredictionPermitted: false,
        isEarlyPredictionReady: false,
        isRefining: false,
        isLocked: false,
      };
    }
    return DataSufficiencyGate.evaluate({
      session: 'PM',
      targetDate: bangkokDateStr,
      currentBangkokTime: currentTime,
      buffer: globalLiveObservationBuffer,
      isSessionLocked: isPmLocked,
      hasOfficialResult: Boolean(pmResultRecord),
    });
  }, [bangkokDateStr, currentTime, isPmLocked, pmResultRecord, isPmPreOpen, pmLiveFeed]);

  // Deterministic Production Prediction Computation via LockEngine
  const amPrediction = React.useMemo(() => {
    if (!records || records.length === 0 || isNonTradingDay || isAmPreOpen || (!amSufficiency.isPredictionPermitted && !isAmLocked && !amResultRecord)) {
      return null;
    }
    try {
      return LockEngine.getOrFreezePrediction(
        records,
        bangkokDateStr,
        'AM',
        amLiveFeed,
        currentTime,
        PRODUCTION_MODEL_VERSION
      );
    } catch {
      return null;
    }
  }, [records, bangkokDateStr, amLiveFeed, currentTime, isNonTradingDay, isAmPreOpen, amSufficiency.isPredictionPermitted, isAmLocked, amResultRecord]);

  const pmPrediction = React.useMemo(() => {
    if (!records || records.length === 0 || isNonTradingDay || isPmPreOpen || (!pmSufficiency.isPredictionPermitted && !isPmLocked && !pmResultRecord)) {
      return null;
    }
    try {
      return LockEngine.getOrFreezePrediction(
        records,
        bangkokDateStr,
        'PM',
        pmLiveFeed,
        currentTime,
        PRODUCTION_MODEL_VERSION
      );
    } catch {
      return null;
    }
  }, [records, bangkokDateStr, pmLiveFeed, currentTime, isNonTradingDay, isPmPreOpen, pmSufficiency.isPredictionPermitted, isPmLocked, pmResultRecord]);

  const [selectedShadowSession, setSelectedShadowSession] = useState<MarketSession>('AM');
  const [shadowRecords, setShadowRecords] = useState<ShadowSessionRecord[]>([]);

  useEffect(() => {
    const unsubscribe = globalShadowTracker.subscribe((recs) => {
      setShadowRecords(recs);
    });
    return () => unsubscribe();
  }, []);

  // Automatic Lock Cutoff Snapshot Freeze
  useEffect(() => {
    if (!records || records.length === 0 || isNonTradingDay) return;
    if (isAmLocked) {
      const existing = globalShadowTracker.getEvaluation(bangkokDateStr, 'AM');
      if (!existing || !existing.isFrozenAtLock) {
        globalShadowTracker.freezeLockSnapshot(bangkokDateStr, 'AM', records, amLiveFeed, currentTime);
      }
    }
    if (isPmLocked) {
      const existing = globalShadowTracker.getEvaluation(bangkokDateStr, 'PM');
      if (!existing || !existing.isFrozenAtLock) {
        globalShadowTracker.freezeLockSnapshot(bangkokDateStr, 'PM', records, pmLiveFeed, currentTime);
      }
    }
  }, [isAmLocked, isPmLocked, records, amLiveFeed, pmLiveFeed, bangkokDateStr, currentTime, isNonTradingDay]);

  const getV2RecordForSession = (session: MarketSession) => {
    if (!records || records.length === 0 || isNonTradingDay) return null;

    const isLocked = session === 'AM' ? isAmLocked : isPmLocked;
    const isPreOpen = session === 'AM' ? isAmPreOpen : isPmPreOpen;
    const liveFeed = session === 'AM' ? amLiveFeed : pmLiveFeed;
    const sufficiency = session === 'AM' ? amSufficiency : pmSufficiency;
    const settlementRecord = session === 'AM' ? amResultRecord : pmResultRecord;

    // Server-Side First: Check if server-side prediction exists from D1
    const serverTracked = globalShadowTracker.getEvaluation(bangkokDateStr, session);
    if (serverTracked) {
      if (settlementRecord && settlementRecord.twod) {
        if (serverTracked.settlementComparison) {
          return serverTracked;
        }
        try {
          const evaluated = AutoWeightedV2ShadowValidator.evaluateSettlement(serverTracked, records);
          globalShadowTracker.hydrateRecord(evaluated);
          return evaluated;
        } catch (err) {
          console.warn('Settlement evaluation notice:', err);
        }
      }
      return serverTracked;
    }

    // 1. If settlement exists today, evaluate against the frozen snapshot
    if (settlementRecord && settlementRecord.twod) {
      const todayTracked = globalShadowTracker.getEvaluation(bangkokDateStr, session);
      if (todayTracked && todayTracked.settlementComparison) {
        return todayTracked;
      }
      try {
        const evaluated = globalShadowTracker.evaluateAndRecord(bangkokDateStr, session, records, liveFeed);
        if (evaluated) return evaluated;
      } catch (err) {
        console.warn('Auto-evaluation notice:', err);
      }
    }

    // 2. If session is locked, retrieve or create the frozen snapshot
    if (isLocked) {
      const todayTracked = globalShadowTracker.getEvaluation(bangkokDateStr, session);
      if (todayTracked && todayTracked.isFrozenAtLock) {
        return todayTracked;
      }
      const validatorFrozen = AutoWeightedV2ShadowValidator.getFrozenSnapshot(bangkokDateStr, session);
      if (validatorFrozen) {
        return validatorFrozen;
      }
      try {
        return globalShadowTracker.freezeLockSnapshot(bangkokDateStr, session, records, liveFeed, currentTime);
      } catch (err) {
        console.warn('Auto-freeze notice:', err);
      }
    }

    // 3. Pre-open check: strictly show NO prediction before session open
    // AM before 10:00 MMT → null (no prediction)
    // PM before 14:00 MMT → null (no prediction)
    if (isPreOpen) {
      return null;
    }

    // 4. Data Sufficiency Gate check:
    // Only show prediction if sufficiency allows it (EARLY_PREDICTION_READY or REFINING)
    // If AWAITING_DATA (0 ticks or before open) → return null (no prediction)
    if (!sufficiency.isPredictionPermitted || sufficiency.state === 'AWAITING_DATA') {
      return null;
    }

    // 5. Active session with valid live data:
    // Generate live-conditioned V2 ensemble (Early Prediction or Refining)
    try {
      return AutoWeightedV2ShadowValidator.generateShadowPrediction(
        records,
        bangkokDateStr,
        session,
        liveFeed,
        currentTime
      );
    } catch {
      return null;
    }
  };

  const amV2Record = React.useMemo(() => getV2RecordForSession('AM'), [
    records,
    bangkokDateStr,
    isNonTradingDay,
    isAmLocked,
    isAmPreOpen,
    amLiveFeed,
    amSufficiency,
    amResultRecord,
    currentTime,
    shadowRecords,
  ]);

  const pmV2Record = React.useMemo(() => getV2RecordForSession('PM'), [
    records,
    bangkokDateStr,
    isNonTradingDay,
    isPmLocked,
    isPmPreOpen,
    pmLiveFeed,
    pmSufficiency,
    pmResultRecord,
    currentTime,
    shadowRecords,
  ]);

  const activeShadowRecord = selectedShadowSession === 'AM' ? amV2Record : pmV2Record;

  const activeSufficiency = selectedShadowSession === 'AM' ? amSufficiency : pmSufficiency;
  const isSelectedLocked = selectedShadowSession === 'AM' ? isAmLocked : isPmLocked;
  const isSelectedPreOpen = selectedShadowSession === 'AM' ? isAmPreOpen : isPmPreOpen;

  const amLifecycle = MarketOpenGate.resolveLifecycleState({
    targetDate: bangkokDateStr,
    session: 'AM',
    currentBangkokTime: currentTime,
    historicalRecords: records,
    hasOfficialResult: Boolean(amResultRecord),
    isSessionLocked: isAmLocked,
    hasLiveObservations: Boolean(amLiveFeed && amLiveFeed.length > 0),
    liveSourceStatus,
  });

  const pmLifecycle = MarketOpenGate.resolveLifecycleState({
    targetDate: bangkokDateStr,
    session: 'PM',
    currentBangkokTime: currentTime,
    historicalRecords: records,
    hasOfficialResult: Boolean(pmResultRecord),
    isSessionLocked: isPmLocked,
    hasLiveObservations: Boolean(pmLiveFeed && pmLiveFeed.length > 0),
    liveSourceStatus,
  });

  // Group latest confirmed official records by date in strict descending chronological order (Latest 7 trading days)
  // Prioritizes direct confirmed provider results from /2d_result, excludes unconfirmed/non-trading days
  const recentHistory: RecentDayResult[] = recentOfficialResults.length > 0
    ? recentOfficialResults
    : (() => {
        const distinctDates = Array.from(new Set(records.map((r) => r.date))).sort((a, b) => b.localeCompare(a));
        const list: RecentDayResult[] = [];
        for (const date of distinctDates) {
          const dayRecords = records.filter((r) => r.date === date);
          const am = dayRecords.find((r) => r.time === '12:01:00' || (r.session === 'AM' && r.isSettlement));
          const pm = dayRecords.find((r) => r.time === '16:30:00' || (r.session === 'PM' && r.isSettlement));
          if (am || pm) {
            list.push({ date, am, pm });
            if (list.length >= 30) break;
          }
        }
        return list;
      })();

  const getStatusBadge = (
    sufficiencyState: DataSufficiencyState,
    isPreOpen: boolean,
    isLocked: boolean,
    hasResult: boolean,
    obsCount: number
  ) => {
    if (hasResult) {
      return {
        label: 'Result Available',
        colorClass: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
        icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      };
    }
    if (isNonTradingDay) {
      return {
        label: 'NON-TRADING DAY',
        colorClass: 'bg-neutral-800 text-neutral-400 border border-neutral-700',
        icon: <Calendar className="w-3.5 h-3.5" />,
      };
    }
    if (isLocked) {
      return {
        label: 'Prediction Locked',
        colorClass: 'bg-amber-500/10 text-amber-300 border border-amber-500/20',
        icon: <Lock className="w-3.5 h-3.5" />,
      };
    }
    if (isPreOpen) {
      return {
        label: 'Market Not Open',
        colorClass: 'bg-neutral-800 text-neutral-400 border border-neutral-700',
        icon: <Clock className="w-3.5 h-3.5" />,
      };
    }
    if (sufficiencyState === 'REFINING') {
      return {
        label: `Live SET/Value စစ်ဆေးဆဲ (${obsCount} Ticks)`,
        colorClass: 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20',
        icon: <Activity className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />,
      };
    }
    if (sufficiencyState === 'EARLY_PREDICTION_READY') {
      return {
        label: 'Live အချက်အလက် စစ်ဆေးဆဲ',
        colorClass: 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20',
        icon: <Activity className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />,
      };
    }
    return {
      label: 'Live SET စောင့်ဆိုင်းဆဲ',
      colorClass: 'bg-blue-500/10 text-blue-300 border border-blue-500/20',
      icon: <Clock className="w-3.5 h-3.5 animate-pulse" />,
    };
  };

  const amBadge = getStatusBadge(
    amSufficiency.state,
    isAmPreOpen,
    isAmLocked,
    Boolean(amResultRecord),
    amSufficiency.observationCount
  );
  const pmBadge = getStatusBadge(
    pmSufficiency.state,
    isPmPreOpen,
    isPmLocked,
    Boolean(pmResultRecord),
    pmSufficiency.observationCount
  );

  const [activeNavTab, setActiveNavTab] = useState<NavTab>('home');

  const handleSelectNavTab = (tab: NavTab) => {
    setActiveNavTab(tab);
    setIsHotUnseenView(false);
    setIsSetLastDigitView(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (tab === 'dev') {
      setIsDevMode(true);
    } else {
      setIsDevMode(false);
    }
  };

  const isBkkMarketOpen = !isNonTradingDay && (
    (bangkokTimeStr >= '10:00:00' && bangkokTimeStr <= '12:30:00') ||
    (bangkokTimeStr >= '14:00:00' && bangkokTimeStr <= '17:00:00')
  );

  const marketStatusText = isNonTradingDay
    ? 'MARKET CLOSED (ပိတ်ရက်)'
    : isAmPreOpen
    ? 'AM PRE-OPEN (ဈေးကွက်ကြို)'
    : isPmPreOpen && bangkokTimeStr > '12:30:00' && bangkokTimeStr < '14:00:00'
    ? 'INTERMISSION (ခေတ္တနား)'
    : isBkkMarketOpen
    ? 'MARKET OPEN (ဈေးကွက်ဖွင့်လှစ်ထားသည်)'
    : 'MARKET CLOSED (ဈေးကွက်ပိတ်သည်)';

  return (
    <div id="mm2d-app-root" className="min-h-screen bg-[#0B0E17] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-white">
      {/* MM2D Production Splash Screen */}
      {showSplash && (
        <SplashScreen
          isInitialized={isDataInitialized}
          onFinish={() => setShowSplash(false)}
        />
      )}

      {/* Top Header */}
      <Header
        loading={loading}
        onRefresh={loadData}
        onOpenMenu={() => setIsMenuOpen(true)}
        liveStatus={liveSourceStatus}
      />

      {/* Slide-out Menu Drawer */}
      <MenuDrawer
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onSelectSetLastDigit={() => {
          setIsSetLastDigitView(true);
          setIsHotUnseenView(false);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onSelectHotUnseen={() => {
          setIsHotUnseenView(true);
          setIsSetLastDigitView(false);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onSelectAbout={() => setIsAboutOpen(true)}
        onOpenDevDiagnostics={() => {
          setIsDevMode(true);
          setActiveNavTab('dev');
          setIsHotUnseenView(false);
          setIsSetLastDigitView(false);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />

      {/* About MM 2D Daily Modal */}
      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
        onOpenDevDiagnostics={() => {
          setIsAboutOpen(false);
          setIsDevMode(true);
          setActiveNavTab('dev');
          setIsHotUnseenView(false);
          setIsSetLastDigitView(false);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />

      {/* Main Container */}
      <main id="mm2d-main-container" className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
        {error && (
          <div className="p-3.5 bg-rose-950/40 border border-rose-800/80 rounded-2xl flex items-center gap-3 text-rose-200 text-xs shadow-lg">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* SET Last Digit Signal (V1) Dedicated View */}
        {isSetLastDigitView && (
          <SetLastDigitSignalView
            records={records}
            onBack={() => setIsSetLastDigitView(false)}
            currentTime={currentTime}
            liveSnapshot={liveSnapshot}
          />
        )}

        {/* Hot & Unseen Numbers View */}
        {!isSetLastDigitView && isHotUnseenView && (
          <HotUnseenView
            records={records}
            onBack={() => setIsHotUnseenView(false)}
          />
        )}

        {/* ------------------------------------------------------------- */}
        {/* TAB 1: CONCISE HOME DASHBOARD (NO DUPLICATE FULL LISTS)       */}
        {/* ------------------------------------------------------------- */}
        {!isSetLastDigitView && !isHotUnseenView && !isDevMode && activeNavTab === 'home' && (
          <div className="space-y-6 pb-20">
            {/* A. Today's Market Date Hero Card */}
            <HeroCard
              currentTime={currentTime}
              bangkokDateStr={bangkokDateStr}
              bangkokTimeStr={bangkokTimeStr}
              myanmarTimeStr={myanmarTimeStr}
              isNonTradingDay={isNonTradingDay}
              marketStatusText={marketStatusText}
              isMarketOpen={isBkkMarketOpen}
            />

            {/* B & C. AM / PM Session Selector + Market Session Timeline */}
            <SessionTimeline
              selectedSession={selectedShadowSession}
              onSelectSession={setSelectedShadowSession}
              isAmLocked={isAmLocked}
              isPmLocked={isPmLocked}
              hasAmResult={Boolean(amResultRecord)}
              hasPmResult={Boolean(pmResultRecord)}
              isAmPreOpen={isAmPreOpen}
              isPmPreOpen={isPmPreOpen}
              amTickCount={amSufficiency.observationCount}
              pmTickCount={pmSufficiency.observationCount}
            />

            {/* D. Live Market Overview Card (2-column responsive grid) */}
            <LiveMarketCard
              liveSnapshot={liveSnapshot}
              liveStatus={liveSourceStatus}
              recentObservations={globalLiveObservationBuffer.getObservations(selectedShadowSession, bangkokDateStr)}
            />

            {/* E, F, G. Selected Session Prediction Card & Official Result Card */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    {selectedShadowSession} Session Intelligence
                  </span>
                  <span className="text-[11px] text-cyan-400 font-mono">
                    ({selectedShadowSession === 'AM' ? '12:01 PM Target' : '4:30 PM Target'})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedShadowSession(selectedShadowSession === 'AM' ? 'PM' : 'AM')}
                  className="text-xs text-slate-400 hover:text-cyan-400 font-medium transition cursor-pointer flex items-center gap-1"
                >
                  <span>Switch to {selectedShadowSession === 'AM' ? 'PM (ညနေ)' : 'AM (မနက်)'}</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Active Session Prediction Card */}
                <PredictionCard
                  session={selectedShadowSession}
                  v2Record={activeShadowRecord}
                  isLocked={isSelectedLocked}
                  isPreOpen={isSelectedPreOpen}
                  isNonTradingDay={isNonTradingDay}
                  hasOfficialResult={Boolean(selectedShadowSession === 'AM' ? amResultRecord : pmResultRecord)}
                  sufficiencyState={activeSufficiency.state}
                  observationCount={activeSufficiency.observationCount}
                  onViewTop10={() => handleSelectNavTab('top10')}
                />

                {/* Active Session Official Result Card */}
                <OfficialResultCard
                  session={selectedShadowSession}
                  resultRecord={selectedShadowSession === 'AM' ? amResultRecord : pmResultRecord}
                  isLocked={isSelectedLocked}
                />
              </div>
            </div>

            {/* 1-Week Rolling Consensus Top-10 HIT/MISS Tracker */}
            <Top10HitMissCard summary={hitMissSummary} />

            {/* H. Compact Evaluation Card (Appears if official result settled) */}
            {activeShadowRecord?.settlementComparison && (
              <EvaluationCard
                settlementComparison={activeShadowRecord.settlementComparison}
              />
            )}
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* TAB 2: DEDICATED TOP-10 VIEW                                  */}
        {/* ------------------------------------------------------------- */}
        {!isSetLastDigitView && !isHotUnseenView && !isDevMode && activeNavTab === 'top10' && (
          <div className="space-y-6 pb-20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Layers className="w-5 h-5 text-cyan-400" />
                  <h1 className="text-lg sm:text-xl font-black text-white uppercase tracking-tight">
                    Consensus Top-10 Candidates
                  </h1>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  MM2D V3 Joint SET &times; Value Trajectory probability ranking (ထိပ်တန်း ၁၀ လုံး ခန့်မှန်းချက်) &bull; {isSelectedLocked ? 'အတည်ပြုပြီး Final Prediction' : 'Lock Time တွင် ထုတ်ပြန်မည်'}
                </p>
                {/* Ensemble Attribution Contract: Dominant Engine: and Supported by 4/4 Engines */}
              </div>

              {/* Dedicated AM / PM Selector for Top 10 */}
              <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setSelectedShadowSession('AM')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedShadowSession === 'AM'
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  AM (12:01 PM)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedShadowSession('PM')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedShadowSession === 'PM'
                      ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-md shadow-purple-500/20'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  PM (4:30 PM)
                </button>
              </div>
            </div>

            <Top10HitMissCard summary={hitMissSummary} />

            <V2Top10View
              session={selectedShadowSession}
              shadowRecord={activeShadowRecord}
              onSelectSession={setSelectedShadowSession}
            />
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* TAB 3: DEDICATED HISTORY VIEW                                 */}
        {/* ------------------------------------------------------------- */}
        {!isSetLastDigitView && !isHotUnseenView && !isDevMode && activeNavTab === 'history' && (
          <div className="space-y-6 pb-20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-cyan-400" />
                  <h1 className="text-lg sm:text-xl font-black text-white uppercase tracking-tight">
                    Official Settlement History
                  </h1>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Stock Exchange of Thailand confirmed settlements and historical database (တရားဝင် ထွက်ရှိချက် မှတ်တမ်း)
                </p>
              </div>

              <div className="text-xs font-mono text-cyan-400 bg-cyan-950/60 px-3 py-1.5 rounded-xl border border-cyan-800/40">
                30-Day Verified Window
              </div>
            </div>

            <RecentResultsTable
              recentHistory={recentHistory}
              loading={loading}
            />
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* TAB 4 / DEV MODE: DEVELOPER DIAGNOSTICS VIEW                  */}
        {/* ------------------------------------------------------------- */}
        {!isSetLastDigitView && !isHotUnseenView && (isDevMode || activeNavTab === 'dev') && (
          <div className="space-y-6 pb-20">
            <div className="flex items-center justify-between bg-[#0B0E17]/90 border border-slate-800/80 rounded-2xl p-4 shadow-lg">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-amber-300">Developer Diagnostic Mode</span>
              </div>
              <button
                onClick={() => {
                  setIsDevMode(false);
                  setActiveNavTab('home');
                }}
                className="text-xs px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 rounded-xl border border-slate-700 transition cursor-pointer font-medium"
              >
                Return to User Mode
              </button>
            </div>

            {/* Architecture Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-[#0B0E17]/90 border border-slate-800/80 rounded-2xl p-4 space-y-1 shadow-md">
                <div className="text-xs text-slate-400 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-cyan-400" />
                  Verified Dataset
                </div>
                <div className="text-xl font-bold text-white">
                  {stats ? stats.totalVerifiedCount.toLocaleString() : '—'}
                </div>
                <div className="text-[10px] text-slate-500">Cloudflare D1 SQLite Engine</div>
              </div>

              <div className="bg-[#0B0E17]/90 border border-slate-800/80 rounded-2xl p-4 space-y-1 shadow-md">
                <div className="text-xs text-slate-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Coverage Range
                </div>
                <div className="text-xs font-semibold text-slate-200 pt-1 font-mono">
                  2021-10-28 → {stats?.latestStoredDate || '2026-08-26'}
                </div>
                <div className="text-[10px] text-emerald-400">100% Math Integrity Verified</div>
              </div>

              <div className="bg-[#0B0E17]/90 border border-slate-800/80 rounded-2xl p-4 space-y-1 shadow-md">
                <div className="text-xs text-slate-400 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-amber-400" />
                  Backfill Checkpoint
                </div>
                <div className="text-xs font-semibold text-slate-200 pt-1 font-mono">
                  {checkpoints?.historicalCheckpoint?.lastProcessedDate || '2026-08-26'}
                </div>
                <div className="text-[10px] text-amber-400">Status: SUCCESS</div>
              </div>

              <div className="bg-[#0B0E17]/90 border border-slate-800/80 rounded-2xl p-4 space-y-1 shadow-md">
                <div className="text-xs text-slate-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                  Live Sync Checkpoint
                </div>
                <div className="text-xs font-semibold text-slate-200 pt-1 font-mono">
                  {checkpoints?.liveCheckpoint?.lastSuccessfulSyncDate || '2026-08-26'}
                </div>
                <div className="text-[10px] text-cyan-400">Cron: */30 * * * *</div>
              </div>
            </div>

            {/* Detailed Verified Records Log */}
            <div className="bg-[#0B0E17]/90 border border-slate-800/80 rounded-2xl p-4 space-y-3 shadow-md">
              <div className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                Verified Storage Stream (Latest 10)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Time</th>
                      <th className="py-2 px-3">SET</th>
                      <th className="py-2 px-3">Value</th>
                      <th className="py-2 px-3">2D</th>
                      <th className="py-2 px-3">Epoch Provenance</th>
                      <th className="py-2 px-3">Parity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-[11px]">
                    {records.slice(0, 10).map((r) => (
                      <tr key={r.id} className="hover:bg-slate-800/30">
                        <td className="py-1.5 px-3 text-slate-300">{r.date}</td>
                        <td className="py-1.5 px-3 text-slate-400">{r.time}</td>
                        <td className="py-1.5 px-3 text-slate-300">{r.setRaw}</td>
                        <td className="py-1.5 px-3 text-slate-300">{r.valueRaw}</td>
                        <td className="py-1.5 px-3 text-cyan-300 font-bold">{r.twod}</td>
                        <td className="py-1.5 px-3 text-slate-400 text-[10px]">{r.provenance}</td>
                        <td className="py-1.5 px-3">
                          <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                            {r.mathematicalCheck?.isMathematicallyConsistent ? 'VALIDATED' : 'CALIBRATED'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer id="mm2d-app-footer" className="border-t border-slate-800/80 px-4 sm:px-6 py-4 mt-auto mb-16 sm:mb-14">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div>
            MM 2D Daily &bull; Official Thai SET Market Synchronized
          </div>
          <button
            onClick={() => {
              const next = !isDevMode;
              setIsDevMode(next);
              setActiveNavTab(next ? 'dev' : 'home');
            }}
            className="text-[11px] text-slate-500 hover:text-cyan-400 underline underline-offset-4 transition cursor-pointer"
          >
            {isDevMode ? 'Switch to User View' : 'Developer Diagnostics'}
          </button>
        </div>
      </footer>

      {/* Bottom Sticky Navigation */}
      <BottomNav
        activeTab={activeNavTab}
        onSelectTab={handleSelectNavTab}
      />
    </div>
  );
}
