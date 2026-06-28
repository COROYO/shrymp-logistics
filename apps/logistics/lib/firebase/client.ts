"use client";
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

/**
 * Firebase client SDK initialization (browser only).
 *
 * All NEXT_PUBLIC_FIREBASE_* env vars are required. Restart `pnpm dev` after
 * changing apps/logistics/.env.local — Next inlines them at server start.
 */

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function assertFirebaseClientConfig(): void {
  const missing = (
    [
      ["NEXT_PUBLIC_FIREBASE_API_KEY", firebaseConfig.apiKey],
      ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", firebaseConfig.authDomain],
      ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", firebaseConfig.projectId],
      ["NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", firebaseConfig.storageBucket],
      ["NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", firebaseConfig.messagingSenderId],
      ["NEXT_PUBLIC_FIREBASE_APP_ID", firebaseConfig.appId],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Firebase client config fehlt (${missing.join(", ")}). ` +
        "Kopiere apps/logistics/.env.local.example nach .env.local und starte den Dev-Server neu.",
    );
  }
}

let cachedApp: FirebaseApp | undefined;

export function clientApp(): FirebaseApp {
  if (cachedApp) return cachedApp;
  assertFirebaseClientConfig();
  cachedApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return cachedApp;
}

export function clientAuth(): Auth {
  return getAuth(clientApp());
}
