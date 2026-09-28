import { VerifiedMarketRecord, MarketSession, RawThaiStockResultDateGroup } from '../../types/market';

export interface StorageStats {
  totalVerifiedCount: number;
  latestStoredDate: string | null;
  amCount: number;
  pmCount: number;
  totalRawPayloadCount: number;
}

export interface InsertStats {
  attempted: number;
  inserted: number;
  duplicatesSkipped: number;
}

export interface RawFeedRecord {
  id: string;
  date: string;
  source: string;
  endpoint: string;
  rawJson: string;
  fetchedAt: string;
}

export interface StoredVerifiedRecord {
  id: string;
  date: string;
  session: MarketSession;
  time: string;
  setRaw: string;
  valueRaw: string;
  setNumeric: number;
  valueNumeric: number;
  twod: string;
  historyId: string;
  source: string;
  fetchedAt: string;
  verifiedStatus: string;
  isSettlement: number;
}

const DB_NAME = 'MM2D_MarketDatabase';
const DB_VERSION = 1;
const STORE_RAW = 'raw_market_feeds';
const STORE_VERIFIED = 'verified_market_records';
const DB_SOURCE = 'thaistock2d';

// Memory fallback for Node.js / environments without IndexedDB
const memoryRawStore = new Map<string, RawFeedRecord>();
const memoryVerifiedStore = new Map<string, StoredVerifiedRecord>();

class PersistentLocalStorageManager {
  private db: IDBDatabase | null = null;
  private isIndexedDBAvailable = false;
  private initPromise: Promise<void> | null = null;
  public restoredFromDisk = false;

  public async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<void>((resolve) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        this.isIndexedDBAvailable = false;
        this.restoredFromDisk = false;
        resolve();
        return;
      }

      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          console.warn('IndexedDB failed to open, falling back to memory/local store:', request.error);
          this.isIndexedDBAvailable = false;
          this.restoredFromDisk = false;
          resolve();
        };

        request.onsuccess = () => {
          this.db = request.result;
          this.isIndexedDBAvailable = true;
          this.restoredFromDisk = true;
          resolve();
        };

        request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
          const db = (event.target as IDBOpenDBRequest).result;

          // 1. RAW Market Feeds Store
          if (!db.objectStoreNames.contains(STORE_RAW)) {
            const rawStore = db.createObjectStore(STORE_RAW, { keyPath: 'id' });
            rawStore.createIndex('date', 'date', { unique: false });
          }

          // 2. VERIFIED Market Records Store
          if (!db.objectStoreNames.contains(STORE_VERIFIED)) {
            const verifiedStore = db.createObjectStore(STORE_VERIFIED, { keyPath: 'id' });
            verifiedStore.createIndex('date', 'date', { unique: false });
            verifiedStore.createIndex('session', 'session', { unique: false });
            verifiedStore.createIndex('date_session', ['date', 'session'], { unique: false });
          }
        };
      } catch (err) {
        console.warn('IndexedDB initialization exception, using fallback:', err);
        this.isIndexedDBAvailable = false;
        this.restoredFromDisk = false;
        resolve();
      }
    });

    return this.initPromise;
  }

  public isStoragePersistent(): boolean {
    return this.isIndexedDBAvailable;
  }

  /**
   * Save RAW API payload to preserve raw provenance
   */
  public async saveRawFeed(date: string, endpoint: string, rawPayload: RawThaiStockResultDateGroup[]): Promise<void> {
    await this.init();

    const id = `raw_${date}_${Date.now()}`;
    const rawRecord: RawFeedRecord = {
      id,
      date,
      source: DB_SOURCE,
      endpoint,
      rawJson: JSON.stringify(rawPayload),
      fetchedAt: new Date().toISOString(),
    };

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db!.transaction(STORE_RAW, 'readwrite');
        const store = tx.objectStore(STORE_RAW);
        const req = store.put(rawRecord);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } else {
      memoryRawStore.set(id, rawRecord);
    }
  }

  /**
   * Store verified records with strict duplicate prevention
   */
  public async storeVerifiedRecords(records: VerifiedMarketRecord[]): Promise<InsertStats> {
    await this.init();

    let inserted = 0;
    let duplicatesSkipped = 0;

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise<InsertStats>((resolve, reject) => {
        const tx = this.db!.transaction(STORE_VERIFIED, 'readwrite');
        const store = tx.objectStore(STORE_VERIFIED);

        let pendingCount = records.length;
        if (pendingCount === 0) {
          resolve({ attempted: 0, inserted: 0, duplicatesSkipped: 0 });
          return;
        }

        records.forEach((rec) => {
          const getReq = store.get(rec.id);

          getReq.onsuccess = () => {
            if (getReq.result) {
              duplicatesSkipped++;
              pendingCount--;
              if (pendingCount === 0) {
                resolve({ attempted: records.length, inserted, duplicatesSkipped });
              }
            } else {
              const row: StoredVerifiedRecord = {
                id: rec.id,
                date: rec.date,
                session: rec.session,
                time: rec.time,
                setRaw: rec.setRaw,
                valueRaw: rec.valueRaw,
                setNumeric: rec.setNumeric,
                valueNumeric: rec.valueNumeric,
                twod: rec.twod,
                historyId: rec.historyId,
                source: DB_SOURCE,
                fetchedAt: rec.verifiedAt,
                verifiedStatus: 'VERIFIED',
                isSettlement: rec.isSettlement ? 1 : 0,
              };

              const putReq = store.put(row);
              putReq.onsuccess = () => {
                inserted++;
                pendingCount--;
                if (pendingCount === 0) {
                  resolve({ attempted: records.length, inserted, duplicatesSkipped });
                }
              };
              putReq.onerror = () => reject(putReq.error);
            }
          };

          getReq.onerror = () => reject(getReq.error);
        });

        tx.onerror = () => reject(tx.error);
      });
    } else {
      // Memory fallback
      for (const rec of records) {
        if (memoryVerifiedStore.has(rec.id)) {
          duplicatesSkipped++;
        } else {
          memoryVerifiedStore.set(rec.id, {
            id: rec.id,
            date: rec.date,
            session: rec.session,
            time: rec.time,
            setRaw: rec.setRaw,
            valueRaw: rec.valueRaw,
            setNumeric: rec.setNumeric,
            valueNumeric: rec.valueNumeric,
            twod: rec.twod,
            historyId: rec.historyId,
            source: DB_SOURCE,
            fetchedAt: rec.verifiedAt,
            verifiedStatus: 'VERIFIED',
            isSettlement: rec.isSettlement ? 1 : 0,
          });
          inserted++;
        }
      }

      return {
        attempted: records.length,
        inserted,
        duplicatesSkipped,
      };
    }
  }

  /**
   * Query verified records by single date
   */
  public async queryByDate(date: string): Promise<VerifiedMarketRecord[]> {
    await this.init();

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db!.transaction(STORE_VERIFIED, 'readonly');
        const store = tx.objectStore(STORE_VERIFIED);
        const index = store.index('date');
        const req = index.getAll(IDBKeyRange.only(date));

        req.onsuccess = () => {
          const rows: StoredVerifiedRecord[] = req.result || [];
          rows.sort((a, b) => a.time.localeCompare(b.time));
          resolve(rows.map(this.mapStoredToVerifiedRecord));
        };
        req.onerror = () => reject(req.error);
      });
    } else {
      const rows = Array.from(memoryVerifiedStore.values())
        .filter((r) => r.date === date)
        .sort((a, b) => a.time.localeCompare(b.time));
      return rows.map(this.mapStoredToVerifiedRecord);
    }
  }

  /**
   * Query records by session ('AM' or 'PM')
   */
  public async queryBySession(session: MarketSession, limit = 50): Promise<VerifiedMarketRecord[]> {
    await this.init();

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db!.transaction(STORE_VERIFIED, 'readonly');
        const store = tx.objectStore(STORE_VERIFIED);
        const index = store.index('session');
        const req = index.getAll(IDBKeyRange.only(session));

        req.onsuccess = () => {
          const rows: StoredVerifiedRecord[] = req.result || [];
          rows.sort((a, b) => {
            const dateComp = b.date.localeCompare(a.date);
            if (dateComp !== 0) return dateComp;
            return b.time.localeCompare(a.time);
          });
          resolve(rows.slice(0, limit).map(this.mapStoredToVerifiedRecord));
        };
        req.onerror = () => reject(req.error);
      });
    } else {
      const rows = Array.from(memoryVerifiedStore.values())
        .filter((r) => r.session === session)
        .sort((a, b) => {
          const dateComp = b.date.localeCompare(a.date);
          if (dateComp !== 0) return dateComp;
          return b.time.localeCompare(a.time);
        });
      return rows.slice(0, limit).map(this.mapStoredToVerifiedRecord);
    }
  }

  /**
   * Query records by date range (startDate to endDate)
   */
  public async queryByDateRange(startDate: string, endDate: string): Promise<VerifiedMarketRecord[]> {
    await this.init();

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db!.transaction(STORE_VERIFIED, 'readonly');
        const store = tx.objectStore(STORE_VERIFIED);
        const index = store.index('date');
        const range = IDBKeyRange.bound(startDate, endDate);
        const req = index.getAll(range);

        req.onsuccess = () => {
          const rows: StoredVerifiedRecord[] = req.result || [];
          rows.sort((a, b) => {
            const dateComp = a.date.localeCompare(b.date);
            if (dateComp !== 0) return dateComp;
            return a.time.localeCompare(b.time);
          });
          resolve(rows.map(this.mapStoredToVerifiedRecord));
        };
        req.onerror = () => reject(req.error);
      });
    } else {
      const rows = Array.from(memoryVerifiedStore.values())
        .filter((r) => r.date >= startDate && r.date <= endDate)
        .sort((a, b) => {
          const dateComp = a.date.localeCompare(b.date);
          if (dateComp !== 0) return dateComp;
          return a.time.localeCompare(b.time);
        });
      return rows.map(this.mapStoredToVerifiedRecord);
    }
  }

  /**
   * Get database statistics
   */
  public async getStats(): Promise<StorageStats> {
    await this.init();

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db!.transaction([STORE_VERIFIED, STORE_RAW], 'readonly');
        const verifiedStore = tx.objectStore(STORE_VERIFIED);
        const rawStore = tx.objectStore(STORE_RAW);

        const verifiedReq = verifiedStore.getAll();
        const rawCountReq = rawStore.count();

        tx.oncomplete = () => {
          const verifiedRows: StoredVerifiedRecord[] = verifiedReq.result || [];
          const totalVerifiedCount = verifiedRows.length;
          const totalRawPayloadCount = rawCountReq.result || 0;

          let latestStoredDate: string | null = null;
          let amCount = 0;
          let pmCount = 0;

          for (const row of verifiedRows) {
            if (!latestStoredDate || row.date > latestStoredDate) {
              latestStoredDate = row.date;
            }
            if (row.session === 'AM') {
              amCount++;
            } else if (row.session === 'PM') {
              pmCount++;
            }
          }

          resolve({
            totalVerifiedCount,
            latestStoredDate,
            amCount,
            pmCount,
            totalRawPayloadCount,
          });
        };

        tx.onerror = () => reject(tx.error);
      });
    } else {
      const verifiedRows = Array.from(memoryVerifiedStore.values());
      const totalVerifiedCount = verifiedRows.length;
      const totalRawPayloadCount = memoryRawStore.size;

      let latestStoredDate: string | null = null;
      let amCount = 0;
      let pmCount = 0;

      for (const row of verifiedRows) {
        if (!latestStoredDate || row.date > latestStoredDate) {
          latestStoredDate = row.date;
        }
        if (row.session === 'AM') amCount++;
        if (row.session === 'PM') pmCount++;
      }

      return {
        totalVerifiedCount,
        latestStoredDate,
        amCount,
        pmCount,
        totalRawPayloadCount,
      };
    }
  }

  /**
   * Query all verified records without limits (read-only for audit)
   */
  public async queryAllVerifiedRecords(): Promise<VerifiedMarketRecord[]> {
    await this.init();

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db!.transaction(STORE_VERIFIED, 'readonly');
        const store = tx.objectStore(STORE_VERIFIED);
        const req = store.getAll();

        req.onsuccess = () => {
          const rows: StoredVerifiedRecord[] = req.result || [];
          rows.sort((a, b) => {
            const dateComp = a.date.localeCompare(b.date);
            if (dateComp !== 0) return dateComp;
            return a.time.localeCompare(b.time);
          });
          resolve(rows.map(this.mapStoredToVerifiedRecord));
        };
        req.onerror = () => reject(req.error);
      });
    } else {
      const rows = Array.from(memoryVerifiedStore.values()).sort((a, b) => {
        const dateComp = a.date.localeCompare(b.date);
        if (dateComp !== 0) return dateComp;
        return a.time.localeCompare(b.time);
      });
      return rows.map(this.mapStoredToVerifiedRecord);
    }
  }

  /**
   * Query all RAW feed payloads (read-only for audit and provenance inspection)
   */
  public async queryAllRawFeeds(): Promise<RawFeedRecord[]> {
    await this.init();

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db!.transaction(STORE_RAW, 'readonly');
        const store = tx.objectStore(STORE_RAW);
        const req = store.getAll();

        req.onsuccess = () => {
          const rows: RawFeedRecord[] = req.result || [];
          rows.sort((a, b) => a.date.localeCompare(b.date));
          resolve(rows);
        };
        req.onerror = () => reject(req.error);
      });
    } else {
      return Array.from(memoryRawStore.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  /**
   * Query RAW feeds for a specific date
   */
  public async queryRawFeedsByDate(date: string): Promise<RawFeedRecord[]> {
    await this.init();

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db!.transaction(STORE_RAW, 'readonly');
        const store = tx.objectStore(STORE_RAW);
        const index = store.index('date');
        const req = index.getAll(IDBKeyRange.only(date));

        req.onsuccess = () => {
          const rows: RawFeedRecord[] = req.result || [];
          resolve(rows);
        };
        req.onerror = () => reject(req.error);
      });
    } else {
      return Array.from(memoryRawStore.values()).filter((r) => r.date === date);
    }
  }

  /**
   * Clear all records
   */
  public async clearAll(): Promise<void> {
    await this.init();

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db!.transaction([STORE_VERIFIED, STORE_RAW], 'readwrite');
        tx.objectStore(STORE_VERIFIED).clear();
        tx.objectStore(STORE_RAW).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } else {
      memoryVerifiedStore.clear();
      memoryRawStore.clear();
    }
  }

  private mapStoredToVerifiedRecord(row: StoredVerifiedRecord): VerifiedMarketRecord {
    const setLastDigit = String(row.setRaw || '').replace(/[^\d]/g, '').slice(-1);
    const valInteger = String(row.valueRaw || '').split('.')[0].replace(/[^\d]/g, '');
    const valLastDigit = valInteger.length > 0 ? valInteger.slice(-1) : '';

    return {
      id: row.id,
      date: row.date,
      time: row.time,
      session: row.session,
      isSettlement: row.isSettlement === 1,
      setRaw: row.setRaw,
      valueRaw: row.valueRaw,
      setNumeric: row.setNumeric,
      valueNumeric: row.valueNumeric,
      twod: row.twod,
      historyId: row.historyId,
      verifiedAt: row.fetchedAt,
      mathematicalCheck: {
        setLastDigit,
        valueLastDigitBeforeDecimal: valLastDigit,
        derived2D: `${setLastDigit}${valLastDigit}`,
        isMathematicallyConsistent: `${setLastDigit}${valLastDigit}` === row.twod,
      },
    };
  }
}

export const sqliteStorage = new PersistentLocalStorageManager();
export const localDatabase = sqliteStorage;
