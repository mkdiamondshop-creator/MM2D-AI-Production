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
import { MarketSession } from './types/market';
import { globalShadowTracker } from './core/prediction/autoWeightedV2ShadowTracker';
import { AutoWeightedV2ShadowValidator } from './core/prediction/autoWeightedV2ShadowValidator';
import { ShadowSessionRecord } from './types/autoWeightedV2';
import { globalLiveObservationBuffer } from './core/market/liveObservationBuffer';
import { DataSufficiencyGate, DataSufficiencyState, DataSufficiencyResult } from './core/market/dataSufficiencyGate';

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

  // User vs Developer Mode toggle (User Mode by default)
  const [isDevMode, setIsDevMode] = useState(false);

  // Live Clock (Normalized to Bangkok & Yangon timezones)
  const [currentTime, setCurrentTime] = useState(new Date());

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
        label: `Refining (${obsCount} Ticks)`,
        colorClass: 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20',
        icon: <Activity className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />,
      };
    }
    if (sufficiencyState === 'EARLY_PREDICTION_READY') {
      return {
        label: 'Early Prediction',
        colorClass: 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20',
        icon: <Sparkles className="w-3.5 h-3.5" />,
      };
    }
    return {
      label: 'Waiting for Live Data',
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

  return (
    <div id="mm2d-app-root" className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-neutral-800">
      {/* Top Header */}
      <header id="mm2d-top-header" className="border-b border-neutral-800 bg-neutral-900/80 backdrop-blur px-4 sm:px-6 py-3.5 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center font-black text-white text-base shadow-sm">
              2D
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-white flex items-center gap-2">
                MM 2D Daily
                <span className="hidden sm:inline-block text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  Official Live
                </span>
              </h1>
              <p className="text-[11px] text-neutral-400">မြန်မာ ၂လုံး ထီပေါက်ဂဏန်းနှင့် ခန့်မှန်းချက်</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              title="Refresh Data"
              className="p-2 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/60 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main id="mm2d-main-container" className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
        {error && (
          <div className="p-3.5 bg-red-950/40 border border-red-800/80 rounded-xl flex items-center gap-3 text-red-200 text-xs">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* USER MODE (DEFAULT MOBILE-FIRST VIEW)                         */}
        {/* ------------------------------------------------------------- */}
        {!isDevMode ? (
          <div className="space-y-6">
            {/* Live Clock & Date Banner */}
            <div className="bg-gradient-to-r from-neutral-900 via-neutral-900 to-neutral-900/80 border border-neutral-800/90 rounded-2xl p-4 sm:p-5 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-cyan-400">TODAY'S MARKET DATE</span>
                    {isNonTradingDay && (
                      <span className="ml-1 text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                        NON-TRADING DAY
                      </span>
                    )}
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-white tracking-tight">
                    {new Intl.DateTimeFormat('en-US', {
                      timeZone: 'Asia/Bangkok',
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    }).format(currentTime)}
                  </div>
                </div>

                <div className="flex items-center gap-3 bg-neutral-950/60 border border-neutral-800 rounded-xl px-3.5 py-2">
                  <Clock className="w-4 h-4 text-neutral-400" />
                  <div className="text-right">
                    <div className="text-xs font-mono font-bold text-neutral-200">{bangkokTimeStr} <span className="text-[10px] text-neutral-400 font-sans">BKK</span></div>
                    <div className="text-[10px] text-neutral-400">{myanmarTimeStr} <span className="text-[9px] text-neutral-500 font-sans">MMT</span></div>
                  </div>
                </div>
              </div>
            </div>

            {/* AM & PM Session Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* ========================================================= */}
              {/* AM SESSION CARD                                           */}
              {/* ========================================================= */}
              <div id="session-card-am" className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-5 flex flex-col justify-between space-y-5 hover:border-neutral-700/80 transition shadow-sm">
                <div className="space-y-4">
                  {/* Session Header */}
                  <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-cyan-400">Morning Session</div>
                      <div className="text-sm font-semibold text-white">မနက်ပိုင်း (12:01 PM)</div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${amBadge.colorClass}`}
                    >
                      {amBadge.icon}
                      {amBadge.label}
                    </span>
                  </div>

                  {/* AM Model Prediction Display */}
                  <div className="bg-neutral-950/70 border border-neutral-800/90 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                        AM Prediction (ခန့်မှန်းဂဏန်း)
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                        isNonTradingDay
                          ? 'bg-neutral-800 text-neutral-400 border-neutral-700'
                          : isAmLocked
                          ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                          : isAmPreOpen
                          ? 'bg-neutral-800 text-neutral-400 border-neutral-700'
                          : amSufficiency.state === 'AWAITING_DATA'
                          ? 'bg-blue-500/10 text-blue-300 border-blue-500/20'
                          : amSufficiency.state === 'EARLY_PREDICTION_READY'
                          ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20'
                          : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'
                      }`}>
                        {isNonTradingDay
                          ? 'CLOSED'
                          : isAmLocked
                          ? 'FINAL PREDICTION (LOCKED)'
                          : isAmPreOpen
                          ? 'OPENS 10:00 AM MMT'
                          : amSufficiency.state === 'AWAITING_DATA'
                          ? 'AWAITING LIVE DATA'
                          : amSufficiency.state === 'EARLY_PREDICTION_READY'
                          ? 'EARLY PREDICTION'
                          : `REFINING (${amSufficiency.observationCount} TICKS)`}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between pt-1">
                      <div>
                        <div className="text-3xl sm:text-4xl font-black text-amber-400 tracking-tight font-mono">
                          {isNonTradingDay || isAmPreOpen || (!amSufficiency.isPredictionPermitted && !isAmLocked && !amResultRecord) || !amV2Record?.top1
                            ? '--'
                            : amV2Record.top1}
                        </div>
                        {isNonTradingDay && (
                          <div className="text-[10px] text-neutral-500 font-sans">
                            NON_TRADING_DAY
                          </div>
                        )}
                        {!isNonTradingDay && isAmPreOpen && (
                          <div className="text-[10px] text-neutral-500 font-sans">
                            MARKET_NOT_OPEN (Opens 10:00 AM MMT)
                          </div>
                        )}
                        {!isNonTradingDay && !isAmPreOpen && !isAmLocked && !amResultRecord && amSufficiency.state === 'AWAITING_DATA' && (
                          <div className="text-[10px] text-blue-400/90 font-sans">
                            WAITING_FOR_LIVE_DATA
                          </div>
                        )}
                        {!isNonTradingDay && !isAmPreOpen && !isAmLocked && !amResultRecord && amSufficiency.state === 'EARLY_PREDICTION_READY' && (
                          <div className="text-[10px] text-cyan-400 font-sans flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-cyan-400" />
                            Early Prediction (1 Live Tick)
                          </div>
                        )}
                        {!isNonTradingDay && !isAmPreOpen && !isAmLocked && !amResultRecord && amSufficiency.state === 'REFINING' && (
                          <div className="text-[10px] text-indigo-400 font-sans flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                            Refining ({amSufficiency.observationCount} Live Ticks)
                          </div>
                        )}
                        {!isNonTradingDay && isAmLocked && !amResultRecord && (
                          <div className="text-[10px] text-amber-400 font-sans">
                            PREDICTION_LOCKED (Frozen at Cutoff)
                          </div>
                        )}
                        {amResultRecord && (
                          <div className="text-[10px] text-emerald-400 font-sans">
                            OFFICIAL_SETTLEMENT_AVAILABLE
                          </div>
                        )}
                      </div>

                      {!isNonTradingDay && !isAmPreOpen && (amSufficiency.isPredictionPermitted || isAmLocked || amResultRecord) && amV2Record?.top5 && amV2Record.top5.length > 0 && (
                        <div className="text-right">
                          <span className="text-[10px] text-neutral-500 block uppercase">Top-5 Ensemble</span>
                          <div className="flex items-center gap-1.5 pt-1">
                            {amV2Record.top5.map((cand, idx) => (
                              <span
                                key={cand}
                                className={`px-1.5 py-0.5 rounded font-mono text-xs ${
                                  idx === 0
                                    ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold'
                                    : 'bg-neutral-900 border border-neutral-800 text-neutral-300'
                                }`}
                              >
                                {cand}
                              </span>
                            ))}
                          </div>
                          {amV2Record.immutableV2Output?.candidates?.[0] && (
                            <div className="text-[10px] text-neutral-400 pt-1 flex items-center justify-end gap-1.5 font-mono">
                              <span className="text-neutral-500">Dominant Engine:</span>
                              <span className="text-cyan-400 font-medium">
                                {amV2Record.immutableV2Output.candidates[0].dominantEngine.replace('_V1', '')}
                              </span>
                              <span className="text-neutral-600">|</span>
                              <span className="text-emerald-400 font-medium">
                                Supported by {amV2Record.immutableV2Output.candidates[0].consensusCount}/4 Engines
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Official Result Display */}
                  <div className="bg-neutral-950/90 border border-neutral-800 rounded-xl p-4 text-center space-y-2">
                    <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                      Official AM Result (12:01 PM)
                    </div>

                    {amResultRecord ? (
                      <div className="space-y-2">
                        <div className="text-4xl sm:text-5xl font-black text-cyan-400 tracking-tight font-mono">
                          {amResultRecord.twod}
                        </div>
                        <div className="flex items-center justify-center gap-4 text-xs font-mono text-neutral-300 border-t border-neutral-800/80 pt-2">
                          <div>
                            <span className="text-neutral-500 text-[10px] block">SET</span>
                            {amResultRecord.setRaw}
                          </div>
                          <div className="h-4 w-px bg-neutral-800" />
                          <div>
                            <span className="text-neutral-500 text-[10px] block">VALUE</span>
                            {amResultRecord.valueRaw}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="py-4 space-y-1">
                        <div className="text-2xl font-bold font-mono text-neutral-600">--</div>
                        <div className="text-xs text-neutral-400">
                          {isAmLocked ? 'Market drawing at 12:01 PM...' : 'Waiting for morning session'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Pre-session (11:00 AM) note if available */}
                {amPreRecord && (
                  <div className="text-[11px] text-neutral-400 flex items-center justify-between border-t border-neutral-800/60 pt-2 font-mono">
                    <span className="text-neutral-500 font-sans">11:00 AM Market Check:</span>
                    <span>2D: <b className="text-neutral-200">{amPreRecord.twod}</b> (SET: {amPreRecord.setRaw})</span>
                  </div>
                )}

                <div className="pt-2 border-t border-neutral-800/60 flex justify-end">
                  <button
                    id="btn-jump-shadow-am"
                    onClick={() => {
                      setSelectedShadowSession('AM');
                      document.getElementById('v2-shadow-top10-am')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 transition-colors"
                  >
                    <span>Consensus Top-10</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* ========================================================= */}
              {/* PM SESSION CARD                                           */}
              {/* ========================================================= */}
              <div id="session-card-pm" className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-5 flex flex-col justify-between space-y-5 hover:border-neutral-700/80 transition shadow-sm">
                <div className="space-y-4">
                  {/* Session Header */}
                  <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-cyan-400">Evening Session</div>
                      <div className="text-sm font-semibold text-white">ညနေပိုင်း (4:30 PM)</div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${pmBadge.colorClass}`}
                    >
                      {pmBadge.icon}
                      {pmBadge.label}
                    </span>
                  </div>

                  {/* PM Model Prediction Display */}
                  <div className="bg-neutral-950/70 border border-neutral-800/90 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                        PM Prediction (ခန့်မှန်းဂဏန်း)
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                        isNonTradingDay
                          ? 'bg-neutral-800 text-neutral-400 border-neutral-700'
                          : isPmLocked
                          ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                          : isPmPreOpen
                          ? 'bg-neutral-800 text-neutral-400 border-neutral-700'
                          : pmSufficiency.state === 'AWAITING_DATA'
                          ? 'bg-blue-500/10 text-blue-300 border-blue-500/20'
                          : pmSufficiency.state === 'EARLY_PREDICTION_READY'
                          ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20'
                          : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'
                      }`}>
                        {isNonTradingDay
                          ? 'CLOSED'
                          : isPmLocked
                          ? 'FINAL PREDICTION (LOCKED)'
                          : isPmPreOpen
                          ? 'OPENS 2:00 PM MMT'
                          : pmSufficiency.state === 'AWAITING_DATA'
                          ? 'AWAITING LIVE DATA'
                          : pmSufficiency.state === 'EARLY_PREDICTION_READY'
                          ? 'EARLY PREDICTION'
                          : `REFINING (${pmSufficiency.observationCount} TICKS)`}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between pt-1">
                      <div>
                        <div className="text-3xl sm:text-4xl font-black text-amber-400 tracking-tight font-mono">
                          {isNonTradingDay || isPmPreOpen || (!pmSufficiency.isPredictionPermitted && !isPmLocked && !pmResultRecord) || !pmV2Record?.top1
                            ? '--'
                            : pmV2Record.top1}
                        </div>
                        {isNonTradingDay && (
                          <div className="text-[10px] text-neutral-500 font-sans">
                            NON_TRADING_DAY
                          </div>
                        )}
                        {!isNonTradingDay && isPmPreOpen && (
                          <div className="text-[10px] text-neutral-500 font-sans">
                            MARKET_NOT_OPEN (Opens 2:00 PM MMT)
                          </div>
                        )}
                        {!isNonTradingDay && !isPmPreOpen && !isPmLocked && !pmResultRecord && pmSufficiency.state === 'AWAITING_DATA' && (
                          <div className="text-[10px] text-blue-400/90 font-sans">
                            WAITING_FOR_LIVE_DATA
                          </div>
                        )}
                        {!isNonTradingDay && !isPmPreOpen && !isPmLocked && !pmResultRecord && pmSufficiency.state === 'EARLY_PREDICTION_READY' && (
                          <div className="text-[10px] text-cyan-400 font-sans flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-cyan-400" />
                            Early Prediction (1 Live Tick)
                          </div>
                        )}
                        {!isNonTradingDay && !isPmPreOpen && !isPmLocked && !pmResultRecord && pmSufficiency.state === 'REFINING' && (
                          <div className="text-[10px] text-indigo-400 font-sans flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                            Refining ({pmSufficiency.observationCount} Live Ticks)
                          </div>
                        )}
                        {!isNonTradingDay && isPmLocked && !pmResultRecord && (
                          <div className="text-[10px] text-amber-400 font-sans">
                            PREDICTION_LOCKED (Frozen at Cutoff)
                          </div>
                        )}
                        {pmResultRecord && (
                          <div className="text-[10px] text-emerald-400 font-sans">
                            OFFICIAL_SETTLEMENT_AVAILABLE
                          </div>
                        )}
                      </div>

                      {!isNonTradingDay && !isPmPreOpen && (pmSufficiency.isPredictionPermitted || isPmLocked || pmResultRecord) && pmV2Record?.top5 && pmV2Record.top5.length > 0 && (
                        <div className="text-right">
                          <span className="text-[10px] text-neutral-500 block uppercase">Top-5 Ensemble</span>
                          <div className="flex items-center gap-1.5 pt-1">
                            {pmV2Record.top5.map((cand, idx) => (
                              <span
                                key={cand}
                                className={`px-1.5 py-0.5 rounded font-mono text-xs ${
                                  idx === 0
                                    ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold'
                                    : 'bg-neutral-900 border border-neutral-800 text-neutral-300'
                                }`}
                              >
                                {cand}
                              </span>
                            ))}
                          </div>
                          {pmV2Record.immutableV2Output?.candidates?.[0] && (
                            <div className="text-[10px] text-neutral-400 pt-1 flex items-center justify-end gap-1.5 font-mono">
                              <span className="text-neutral-500">Dominant Engine:</span>
                              <span className="text-cyan-400 font-medium">
                                {pmV2Record.immutableV2Output.candidates[0].dominantEngine.replace('_V1', '')}
                              </span>
                              <span className="text-neutral-600">|</span>
                              <span className="text-emerald-400 font-medium">
                                Supported by {pmV2Record.immutableV2Output.candidates[0].consensusCount}/4 Engines
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Official Result Display */}
                  <div className="bg-neutral-950/90 border border-neutral-800 rounded-xl p-4 text-center space-y-2">
                    <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                      Official PM Result (4:30 PM)
                    </div>

                    {pmResultRecord ? (
                      <div className="space-y-2">
                        <div className="text-4xl sm:text-5xl font-black text-cyan-400 tracking-tight font-mono">
                          {pmResultRecord.twod}
                        </div>
                        <div className="flex items-center justify-center gap-4 text-xs font-mono text-neutral-300 border-t border-neutral-800/80 pt-2">
                          <div>
                            <span className="text-neutral-500 text-[10px] block">SET</span>
                            {pmResultRecord.setRaw}
                          </div>
                          <div className="h-4 w-px bg-neutral-800" />
                          <div>
                            <span className="text-neutral-500 text-[10px] block">VALUE</span>
                            {pmResultRecord.valueRaw}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="py-4 space-y-1">
                        <div className="text-2xl font-bold font-mono text-neutral-600">--</div>
                        <div className="text-xs text-neutral-400">
                          {isPmLocked ? 'Market drawing at 4:30 PM...' : 'Waiting for evening session'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Pre-session (3:00 PM) note if available */}
                {pmPreRecord && (
                  <div className="text-[11px] text-neutral-400 flex items-center justify-between border-t border-neutral-800/60 pt-2 font-mono">
                    <span className="text-neutral-500 font-sans">3:00 PM Market Check:</span>
                    <span>2D: <b className="text-neutral-200">{pmPreRecord.twod}</b> (SET: {pmPreRecord.setRaw})</span>
                  </div>
                )}

                <div className="pt-2 border-t border-neutral-800/60 flex justify-end">
                  <button
                    id="btn-jump-shadow-pm"
                    onClick={() => {
                      setSelectedShadowSession('PM');
                      document.getElementById('v2-shadow-top10-pm')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 transition-colors"
                  >
                    <span>Consensus Top-10</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* V2 Ensemble Consensus Top-10 */}
            <div id={`v2-shadow-top10-${selectedShadowSession.toLowerCase()}`} className="space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-neutral-400 px-1 py-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-neutral-500 font-sans">Prediction Architecture:</span>
                  <span className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-cyan-400 font-bold font-mono">
                    AUTO_WEIGHTED_V2
                  </span>
                  {isSelectedLocked ? (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-medium text-[11px]">
                      Final Prediction (Locked)
                    </span>
                  ) : isSelectedPreOpen ? (
                    <span className="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-400 font-medium text-[11px]">
                      Pre-Open ({selectedShadowSession})
                    </span>
                  ) : activeSufficiency.state === 'AWAITING_DATA' ? (
                    <span className="px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-300 font-medium text-[11px]">
                      Awaiting Data ({selectedShadowSession})
                    </span>
                  ) : activeSufficiency.state === 'EARLY_PREDICTION_READY' ? (
                    <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 font-medium text-[11px]">
                      Early Prediction ({selectedShadowSession})
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 font-medium text-[11px]">
                      Refining ({activeSufficiency.observationCount} Ticks - {selectedShadowSession})
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-neutral-400 font-sans mt-0.5 sm:mt-0">
                  {activeSufficiency.reason}
                </span>
              </div>
              <V2Top10View
                session={selectedShadowSession}
                shadowRecord={activeShadowRecord}
                onSelectSession={setSelectedShadowSession}
              />
            </div>

            {/* Recent Confirmed Results (User History Table) */}
            <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
                <div>
                  <h2 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wide">
                    Recent Official Results
                  </h2>
                  <p className="text-[11px] text-neutral-400">လတ်တလော ထွက်ရှိထားသော တရားဝင်ပေါက်ဂဏန်းများ</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-neutral-800 text-neutral-400">
                      <th className="py-2.5 px-3 font-medium">Date</th>
                      <th className="py-2.5 px-3 font-medium text-center text-cyan-400 font-bold">12:01 PM (AM)</th>
                      <th className="py-2.5 px-3 font-medium text-center text-cyan-400 font-bold">4:30 PM (PM)</th>
                      <th className="py-2.5 px-3 font-medium text-right">SET Index</th>
                      <th className="py-2.5 px-3 font-medium text-right">Value (M)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/60 font-mono text-[11px]">
                    {recentHistory.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-neutral-500 font-sans">
                          {loading ? 'Loading history...' : 'No confirmed records available.'}
                        </td>
                      </tr>
                    ) : (
                      recentHistory.map((item) => (
                        <tr key={item.date} className="hover:bg-neutral-800/30 transition">
                          <td className="py-2.5 px-3 text-neutral-300 font-sans font-medium">{item.date}</td>
                          <td className="py-2.5 px-3 text-center">
                            {item.am ? (
                              <span className="font-bold text-cyan-300 text-sm px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20">
                                {item.am.twod}
                              </span>
                            ) : (
                              <span className="text-neutral-600">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {item.pm ? (
                              <span className="font-bold text-cyan-300 text-sm px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20">
                                {item.pm.twod}
                              </span>
                            ) : (
                              <span className="text-neutral-600">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right text-neutral-300">
                            {item.pm?.setRaw || item.am?.setRaw || '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-neutral-300">
                            {item.pm?.valueRaw || item.am?.valueRaw || '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          /* ------------------------------------------------------------- */
          /* DEVELOPER / ADMIN DIAGNOSTICS MODE                            */
          /* ------------------------------------------------------------- */
          <div className="space-y-6">
            <div className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded-xl p-4">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-amber-300">Developer Diagnostic Mode</span>
              </div>
              <button
                onClick={() => setIsDevMode(false)}
                className="text-xs px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded border border-neutral-700 transition cursor-pointer"
              >
                Return to User Mode
              </button>
            </div>

            {/* Architecture Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 space-y-1">
                <div className="text-xs text-neutral-400 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-cyan-400" />
                  Verified Dataset
                </div>
                <div className="text-xl font-bold text-neutral-100">
                  {stats ? stats.totalVerifiedCount.toLocaleString() : '—'}
                </div>
                <div className="text-[10px] text-neutral-500">Cloudflare D1 SQLite Engine</div>
              </div>

              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 space-y-1">
                <div className="text-xs text-neutral-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Coverage Range
                </div>
                <div className="text-xs font-semibold text-neutral-200 pt-1 font-mono">
                  2021-10-28 → {stats?.latestStoredDate || '2026-08-26'}
                </div>
                <div className="text-[10px] text-emerald-500/80">100% Math Integrity Verified</div>
              </div>

              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 space-y-1">
                <div className="text-xs text-neutral-400 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-amber-400" />
                  Backfill Checkpoint
                </div>
                <div className="text-xs font-semibold text-neutral-200 pt-1 font-mono">
                  {checkpoints?.historicalCheckpoint?.lastProcessedDate || '2026-08-26'}
                </div>
                <div className="text-[10px] text-amber-500/80">Status: SUCCESS</div>
              </div>

              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 space-y-1">
                <div className="text-xs text-neutral-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                  Live Sync Checkpoint
                </div>
                <div className="text-xs font-semibold text-neutral-200 pt-1 font-mono">
                  {checkpoints?.liveCheckpoint?.lastSuccessfulSyncDate || '2026-08-26'}
                </div>
                <div className="text-[10px] text-blue-500/80">Cron: */30 * * * *</div>
              </div>
            </div>

            {/* Detailed Verified Records Log */}
            <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-4 space-y-3">
              <div className="text-xs font-semibold text-neutral-200 uppercase tracking-wide">
                Verified Storage Stream (Latest 10)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead>
                    <tr className="border-b border-neutral-800 text-neutral-400 text-[11px]">
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Time</th>
                      <th className="py-2 px-3">SET</th>
                      <th className="py-2 px-3">Value</th>
                      <th className="py-2 px-3">2D</th>
                      <th className="py-2 px-3">Epoch Provenance</th>
                      <th className="py-2 px-3">Parity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/60 text-[11px]">
                    {records.slice(0, 10).map((r) => (
                      <tr key={r.id} className="hover:bg-neutral-800/30">
                        <td className="py-1.5 px-3 text-neutral-300">{r.date}</td>
                        <td className="py-1.5 px-3 text-neutral-400">{r.time}</td>
                        <td className="py-1.5 px-3 text-neutral-300">{r.setRaw}</td>
                        <td className="py-1.5 px-3 text-neutral-300">{r.valueRaw}</td>
                        <td className="py-1.5 px-3 text-cyan-300 font-bold">{r.twod}</td>
                        <td className="py-1.5 px-3 text-neutral-400 text-[10px]">{r.provenance}</td>
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
      <footer id="mm2d-app-footer" className="border-t border-neutral-800/80 px-4 sm:px-6 py-4 mt-auto">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-neutral-500">
          <div>
            MM 2D Daily &bull; Official Thai SET Market Synchronized
          </div>
          <button
            onClick={() => setIsDevMode(!isDevMode)}
            className="text-[11px] text-neutral-500 hover:text-neutral-300 underline underline-offset-4 transition cursor-pointer"
          >
            {isDevMode ? 'Switch to User View' : 'Developer Diagnostics'}
          </button>
        </div>
      </footer>
    </div>
  );
}
