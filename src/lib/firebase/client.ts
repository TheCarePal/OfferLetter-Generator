import {
  getApps,
  initializeApp,
  type FirebaseApp,
  type FirebaseOptions,
} from "firebase/app";
import {
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
  type Auth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import {
  connectStorageEmulator,
  getStorage,
  type FirebaseStorage,
} from "firebase/storage";

export const CAREPAL_ORGANIZATION_ID = "carepal";
export const FIREBASE_APP_NAME = "carepal-offer-letter-creator";

// Public Web App identifiers; authorization is enforced by Firebase rules.
export const CAREPAL_FIREBASE_PUBLIC_CONFIG: Readonly<FirebaseOptions> =
  Object.freeze({
    apiKey: "AIzaSyBProfvBrIGr9V6hunnEYag7ovjD4WCfZQ",
    authDomain: "the-carepal.firebaseapp.com",
    projectId: "the-carepal",
    storageBucket: "the-carepal.firebasestorage.app",
    messagingSenderId: "241442103462",
    appId: "1:241442103462:web:943a0e1246540d62811467",
    measurementId: "G-3249HSQL3R",
  });

export type FirebaseClient = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
  persistenceReady: Promise<void>;
  usingEmulators: boolean;
};
let client: FirebaseClient | null = null;

/** Local testing only connects to emulators when explicitly requested. */
export function shouldUseFirebaseEmulators(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === "true"
  );
}

export function getFirebaseClient(): FirebaseClient {
  if (client) return client;
  const app =
    getApps().find((candidate) => candidate.name === FIREBASE_APP_NAME) ??
    initializeApp(CAREPAL_FIREBASE_PUBLIC_CONFIG, FIREBASE_APP_NAME);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);
  storage.maxOperationRetryTime = 15_000;
  storage.maxUploadRetryTime = 30_000;
  const usingEmulators = shouldUseFirebaseEmulators();
  if (usingEmulators) {
    const connected = globalThis as typeof globalThis & {
      __carepalDocumentEmulators?: Set<string>;
    };
    const apps = connected.__carepalDocumentEmulators ?? new Set<string>();
    if (!apps.has(app.name)) {
      const host =
        process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST?.trim() || "127.0.0.1";
      connectAuthEmulator(auth, `http://${host}:9099`, {
        disableWarnings: true,
      });
      connectFirestoreEmulator(db, host, 8080);
      connectStorageEmulator(storage, host, 9199);
      apps.add(app.name);
      connected.__carepalDocumentEmulators = apps;
    }
  }
  const persistenceReady =
    typeof window === "undefined"
      ? Promise.resolve()
      : setPersistence(auth, browserSessionPersistence);
  client = { app, auth, db, storage, persistenceReady, usingEmulators };
  return client;
}
