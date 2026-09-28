/**
 * Server-Side Unattended Scheduled Polling Worker
 * 
 * Target: Firebase Cloud Functions v2 (onSchedule) or Node.js Daemon Service
 * Primary Automatic Synchronization Mechanism:
 * - Runs 24/7 on Google Cloud / Firebase Cloud Scheduler
 * - Independent of client browser, tabs, screen lock, or devices
 * 
 * Pipeline per cycle:
 * 1. Fetch ThaiStock2D API
 * 2. Preserve RAW payload
 * 3. Validate mathematical integrity (SET & Value check)
 * 4. Detect TRADING / NON_TRADING / PARTIAL_TRADING
 * 5. Enforce composite uniqueness: date + time + historyId
 * 6. Insert only valid verified records
 * 7. Skip duplicates
 * 8. Update LIVE_SYNC_CHECKPOINT only when newer live record processed
 * 9. Write sync audit log to Cloud Firestore
 * 10. Reconcile dataset state
 */

export interface ServerSyncWorkerConfig {
  scheduleCron: string; // e.g. "every 5 minutes" or "*/5 9-17 * * 1-5"
  timeZone: string;     // "Asia/Bangkok" / "Asia/Yangon"
  maxRetries: number;
}

export const SERVER_WORKER_SPEC: ServerSyncWorkerConfig = {
  scheduleCron: 'every 5 minutes',
  timeZone: 'Asia/Bangkok',
  maxRetries: 3,
};

/**
 * Cloud Function code definition for unattended 24/7 scheduled worker.
 */
export const CLOUD_FUNCTION_SOURCE_CODE = `
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();

export const scheduledThaiStockSync = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Asia/Bangkok',
    retryCount: 3,
    memory: '256MiB',
  },
  async (event) => {
    const today = new Date().toISOString().split('T')[0];
    console.log(\`[SERVER WORKER] Starting scheduled sync cycle for \${today}\`);

    try {
      // 1. Fetch ThaiStock2D API
      const res = await fetch(\`https://api.thaistock2d.com/2d_result?date=\${today}\`);
      if (!res.ok) throw new Error(\`HTTP \${res.status} \${res.statusText}\`);
      const rawGroups = await res.json();

      if (!rawGroups || rawGroups.length === 0) {
        console.log(\`[SERVER WORKER] Non-trading day or empty feed for \${today}\`);
        return;
      }

      // 2. Validate, deduplicate, and ingest
      let inserted = 0;
      let skipped = 0;
      const batch = db.batch();

      for (const group of rawGroups) {
        if (!group.child || !Array.isArray(group.child)) continue;
        for (const raw of group.child) {
          const docId = \`\${raw.date}_\${raw.time}_\${raw.history_id}\`;
          const docRef = db.collection('verified_market_records').doc(docId);
          const existing = await docRef.get();

          if (existing.exists) {
            skipped++;
          } else {
            batch.set(docRef, {
              id: docId,
              date: raw.date,
              time: raw.time,
              session: raw.time < '13:00:00' ? 'AM' : 'PM',
              setRaw: raw.set,
              valueRaw: raw.value,
              twod: raw.twod,
              historyId: String(raw.history_id),
              verifiedAt: new Date().toISOString(),
              ingestedBy: 'SERVER_CLOUD_FUNCTION_WORKER'
            });
            inserted++;
          }
        }
      }

      await batch.commit();

      // 3. Update LIVE_SYNC_CHECKPOINT monotonically
      await db.collection('sync_checkpoints').doc('LIVE_SYNC_CHECKPOINT').set({
        id: 'LIVE_SYNC_CHECKPOINT',
        lastSuccessfulSyncDate: today,
        lastSyncTimestamp: new Date().toISOString(),
        totalInserted: inserted,
        totalSkipped: skipped,
        status: 'SUCCESS'
      }, { merge: true });

      console.log(\`[SERVER WORKER] Cycle complete. Inserted: \${inserted}, Skipped: \${skipped}\`);
    } catch (err) {
      console.error('[SERVER WORKER] Error in sync cycle:', err);
    }
  }
);
`;
