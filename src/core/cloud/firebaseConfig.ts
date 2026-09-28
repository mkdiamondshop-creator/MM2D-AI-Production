import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';

export interface FirebaseClientConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  firestoreDatabaseId?: string;
}

let cachedApp: FirebaseApp | null = null;
let cachedFirestore: Firestore | null = null;
let cachedConfig: FirebaseClientConfig | null = null;

// Safe accessor for environment variables in Vite and Node
function getEnvVar(name: string): string | undefined {
  try {
    const metaEnv = (import.meta as unknown as { env?: Record<string, string> }).env;
    if (metaEnv && metaEnv[name]) {
      return metaEnv[name];
    }
  } catch {
    // ignore
  }

  try {
    if (typeof process !== 'undefined' && process.env && process.env[name]) {
      return process.env[name];
    }
  } catch {
    // ignore
  }

  return undefined;
}

/**
 * Attempts to load Firebase Client Configuration from environment.
 */
export function getFirebaseConfig(): FirebaseClientConfig | null {
  if (cachedConfig) return cachedConfig;

  const envConfig: FirebaseClientConfig = {
    apiKey: getEnvVar('VITE_FIREBASE_API_KEY'),
    authDomain: getEnvVar('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: getEnvVar('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: getEnvVar('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: getEnvVar('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: getEnvVar('VITE_FIREBASE_APP_ID'),
    firestoreDatabaseId: getEnvVar('VITE_FIREBASE_DATABASE_ID'),
  };

  if (envConfig.projectId && (envConfig.apiKey || envConfig.appId)) {
    cachedConfig = envConfig;
    return cachedConfig;
  }

  return null;
}

/**
 * Initializes and returns the Firebase App instance safely without throwing unhandled exceptions.
 */
export function getFirebaseApp(): { app: FirebaseApp | null; isConfigured: boolean; error: string | null } {
  if (cachedApp) {
    return { app: cachedApp, isConfigured: true, error: null };
  }

  const config = getFirebaseConfig();
  if (!config || !config.projectId) {
    return {
      app: null,
      isConfigured: false,
      error: 'Firebase credentials/config not provided in environment',
    };
  }

  try {
    const existingApps = getApps();
    if (existingApps.length > 0) {
      cachedApp = getApp();
    } else {
      cachedApp = initializeApp(config);
    }
    return { app: cachedApp, isConfigured: true, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[Firebase] App initialization warning:', msg);
    return { app: null, isConfigured: false, error: msg };
  }
}

/**
 * Returns the Firestore client instance if configured, or null.
 */
export function getFirestoreDb(): { firestore: Firestore | null; isConfigured: boolean; error: string | null } {
  if (cachedFirestore) {
    return { firestore: cachedFirestore, isConfigured: true, error: null };
  }

  const { app, isConfigured, error } = getFirebaseApp();
  if (!isConfigured || !app) {
    return { firestore: null, isConfigured: false, error };
  }

  try {
    cachedFirestore = getFirestore(app);
    return { firestore: cachedFirestore, isConfigured: true, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[Firebase] Firestore initialization warning:', msg);
    return { firestore: null, isConfigured: false, error: msg };
  }
}

export const getFirebaseFirestore = getFirestoreDb;

