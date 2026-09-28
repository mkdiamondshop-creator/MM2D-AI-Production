import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  writeBatch,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { getFirebaseFirestore, getFirebaseConfig } from './firebaseConfig';
import { VerifiedMarketRecord } from '../../types/market';
import { ReconciliationReport, LiveSyncCheckpoint, HistoricalBackfillCheckpoint } from '../../types/sync';

export interface FirestoreAdapterStatus {
  state: 'CONFIGURED' | 'UNCONFIGURED' | 'CONNECTED' | 'SYNCHRONIZED' | 'ERROR';
  isConfigured: boolean;
  remoteCount: number;
  lastRemoteSync: string | null;
  message: string;
  projectId?: string;
  error?: string | null;
}

/**
 * Real Google Cloud Firestore Synchronization & Reconciliation Adapter.
 * Interfaces with official Firebase Web SDK (firestore) collections:
 * - /verified_market_records/{id}
 * - /sync_checkpoints/{checkpointId}
 * - /sync_audit_logs/{logId}
 */
export class FirestoreSyncAdapter {
  private collectionName = 'verified_market_records';
  private checkpointsCollection = 'sync_checkpoints';
  private lastSyncTimestamp: string | null = null;
  private lastRemoteCount = 0;

  public getStatus(): FirestoreAdapterStatus {
    const { firestore, isConfigured, error } = getFirebaseFirestore();
    const config = getFirebaseConfig();

    if (!isConfigured || !firestore) {
      return {
        state: 'UNCONFIGURED',
        isConfigured: false,
        remoteCount: 0,
        lastRemoteSync: null,
        message: error || 'Firebase Firestore is unconfigured. Real cloud synchronization requires Firebase setup.',
        projectId: config?.projectId,
        error: error || 'Unconfigured',
      };
    }

    return {
      state: this.lastRemoteCount > 0 ? 'SYNCHRONIZED' : 'CONNECTED',
      isConfigured: true,
      remoteCount: this.lastRemoteCount,
      lastRemoteSync: this.lastSyncTimestamp,
      message: `Connected to Cloud Firestore (Project: ${config?.projectId || 'active'}). Collection: "${this.collectionName}".`,
      projectId: config?.projectId,
      error: null,
    };
  }

  /**
   * Syncs verified market records to Cloud Firestore.
   * Document ID uses the exact composite uniqueness key: ${date}_${time}_${historyId}
   */
  public async syncVerifiedRecords(
    records: VerifiedMarketRecord[]
  ): Promise<{ syncedCount: number; skippedCount: number; totalRemote: number; isConfigured: boolean; error?: string }> {
    const { firestore, isConfigured, error } = getFirebaseFirestore();

    if (!isConfigured || !firestore) {
      return {
        syncedCount: 0,
        skippedCount: 0,
        totalRemote: 0,
        isConfigured: false,
        error: error || 'Firestore not configured',
      };
    }

    try {
      let syncedCount = 0;
      let skippedCount = 0;

      // Batch in chunks of 450 (Firestore limit is 500 ops per batch)
      const chunkSize = 400;
      for (let i = 0; i < records.length; i += chunkSize) {
        const chunk = records.slice(i, i + chunkSize);
        const batch = writeBatch(firestore);

        for (const record of chunk) {
          const docId = record.id || `${record.date}_${record.time}_${record.historyId}`;
          const docRef = doc(firestore, this.collectionName, docId);

          const payload = {
            id: docId,
            date: record.date,
            time: record.time,
            session: record.session,
            isSettlement: record.isSettlement,
            setRaw: record.setRaw,
            valueRaw: record.valueRaw,
            setNumeric: record.setNumeric,
            valueNumeric: record.valueNumeric,
            twod: record.twod,
            historyId: record.historyId,
            mathematicalCheck: record.mathematicalCheck,
            verifiedAt: record.verifiedAt || new Date().toISOString(),
          };

          batch.set(docRef, payload, { merge: true });
          syncedCount++;
        }

        await batch.commit();
      }

      this.lastSyncTimestamp = new Date().toISOString();
      
      // Update count
      const allRemote = await this.fetchRemoteVerifiedRecords();
      this.lastRemoteCount = allRemote.length;

      return {
        syncedCount,
        skippedCount,
        totalRemote: this.lastRemoteCount,
        isConfigured: true,
      };
    } catch (err) {
      const errStr = err instanceof Error ? err.message : String(err);
      console.error('Failed to sync verified records to Firestore:', errStr);
      return {
        syncedCount: 0,
        skippedCount: 0,
        totalRemote: this.lastRemoteCount,
        isConfigured: true,
        error: errStr,
      };
    }
  }

  /**
   * Fetches all remote verified records from Firestore
   */
  public async fetchRemoteVerifiedRecords(): Promise<VerifiedMarketRecord[]> {
    const { firestore, isConfigured } = getFirebaseFirestore();
    if (!isConfigured || !firestore) {
      return [];
    }

    try {
      const colRef = collection(firestore, this.collectionName);
      const snapshot = await getDocs(colRef);
      const records: VerifiedMarketRecord[] = [];

      snapshot.forEach((d) => {
        const data = d.data() as VerifiedMarketRecord;
        records.push({
          ...data,
          id: d.id,
        });
      });

      this.lastRemoteCount = records.length;

      return records.sort((a, b) => {
        const dateComp = a.date.localeCompare(b.date);
        if (dateComp !== 0) return dateComp;
        return a.time.localeCompare(b.time);
      });
    } catch (err) {
      console.error('Failed to fetch records from Firestore:', err);
      return [];
    }
  }

  /**
   * Saves live or historical checkpoint to Firestore
   */
  public async saveRemoteCheckpoint(
    type: 'LIVE' | 'HISTORICAL',
    data: Partial<LiveSyncCheckpoint | HistoricalBackfillCheckpoint>
  ): Promise<boolean> {
    const { firestore, isConfigured } = getFirebaseFirestore();
    if (!isConfigured || !firestore) return false;

    try {
      const docId = type === 'LIVE' ? 'LIVE_SYNC_CHECKPOINT' : 'HISTORICAL_BACKFILL_CHECKPOINT';
      const docRef = doc(firestore, this.checkpointsCollection, docId);
      await setDoc(docRef, { ...data, updatedAt: new Date().toISOString() }, { merge: true });
      return true;
    } catch (err) {
      console.error(`Failed to save remote checkpoint ${type}:`, err);
      return false;
    }
  }

  /**
   * Performs deep bidirectional reconciliation between Local storage and Cloud Firestore.
   */
  public async reconcileWithLocal(localRecords: VerifiedMarketRecord[]): Promise<ReconciliationReport> {
    const { isConfigured } = getFirebaseFirestore();

    if (!isConfigured) {
      return {
        reconciledAt: new Date().toISOString(),
        localCount: localRecords.length,
        firestoreCount: 0,
        matchedCount: 0,
        missingLocallyCount: 0,
        missingRemotelyCount: localRecords.length,
        duplicateCount: 0,
        mismatchCount: 0,
        unverifiedCount: 0,
        status: 'REMOTE_EMPTY',
        details: {
          missingLocallyIds: [],
          missingRemotelyIds: localRecords.map((r) => r.id),
          mismatchedRecords: [],
        },
      };
    }

    const remoteRecords = await this.fetchRemoteVerifiedRecords();

    const localMap = new Map<string, VerifiedMarketRecord>();
    const remoteMap = new Map<string, VerifiedMarketRecord>();

    let duplicateCount = 0;
    const seenLocalKeys = new Set<string>();

    for (const r of localRecords) {
      if (seenLocalKeys.has(r.id)) {
        duplicateCount++;
      } else {
        seenLocalKeys.add(r.id);
        localMap.set(r.id, r);
      }
    }

    for (const r of remoteRecords) {
      remoteMap.set(r.id, r);
    }

    const missingLocallyIds: string[] = [];
    const missingRemotelyIds: string[] = [];
    const mismatchedRecords: Array<{ id: string; reason: string }> = [];
    let matchedCount = 0;
    let unverifiedCount = 0;

    // Check records in local against remote
    for (const [id, localRec] of localMap.entries()) {
      if (!localRec.mathematicalCheck?.isMathematicallyConsistent) {
        unverifiedCount++;
      }

      const remoteRec = remoteMap.get(id);
      if (!remoteRec) {
        missingRemotelyIds.push(id);
      } else {
        // Compare field integrity
        if (
          localRec.twod !== remoteRec.twod ||
          localRec.setRaw !== remoteRec.setRaw ||
          localRec.valueRaw !== remoteRec.valueRaw
        ) {
          mismatchedRecords.push({
            id,
            reason: `Data divergence: Local (SET: ${localRec.setRaw}, 2D: ${localRec.twod}) vs Remote (SET: ${remoteRec.setRaw}, 2D: ${remoteRec.twod})`,
          });
        } else {
          matchedCount++;
        }
      }
    }

    // Check records in remote against local
    for (const [id] of remoteMap.entries()) {
      if (!localMap.has(id)) {
        missingLocallyIds.push(id);
      }
    }

    let status: ReconciliationReport['status'] = 'SYNCHRONIZED';
    if (localRecords.length === 0 && remoteRecords.length === 0) {
      status = 'SYNCHRONIZED';
    } else if (localRecords.length === 0) {
      status = 'LOCAL_EMPTY';
    } else if (remoteRecords.length === 0) {
      status = 'REMOTE_EMPTY';
    } else if (missingLocallyIds.length > 0 || missingRemotelyIds.length > 0 || mismatchedRecords.length > 0) {
      status = 'DRIFT_DETECTED';
    }

    return {
      reconciledAt: new Date().toISOString(),
      localCount: localRecords.length,
      firestoreCount: remoteRecords.length,
      matchedCount,
      missingLocallyCount: missingLocallyIds.length,
      missingRemotelyCount: missingRemotelyIds.length,
      duplicateCount,
      mismatchCount: mismatchedRecords.length,
      unverifiedCount,
      status,
      details: {
        missingLocallyIds,
        missingRemotelyIds,
        mismatchedRecords,
      },
    };
  }
}

export const firestoreSyncAdapter = new FirestoreSyncAdapter();
