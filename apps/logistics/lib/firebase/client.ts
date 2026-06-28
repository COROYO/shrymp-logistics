"use client";
import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseApp,
  type FirebaseOptions,
} from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

/**
 * Firebase client SDK initialization (browser only).
 *
 * Local dev: set NEXT_PUBLIC_FIREBASE_* in apps/logistics/.env.local and
 * restart `pnpm dev` (Next inlines them at server start).
 *
 * App Hosting: the same vars must be in apphosting.yaml with BUILD
 * availability. If they are not inlined at build time, initializeApp()
 * without config uses FIREBASE_WEBAPP_CONFIG from the firebase postinstall.
 */

const FIREBASE_CLIENT_ENV_KEYS = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

function resolveFirebaseClientConfig(): FirebaseOptions | undefined {
  const config: FirebaseOptions = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  const missing = FIREBASE_CLIENT_ENV_KEYS.filter(
    (key) => !process.env[key],
  );

  return missing.length === 0 ? config : undefined;
}

function firebaseClientConfigError(missing: readonly string[]): Error {
  return new Error(
    `Firebase client config fehlt (${missing.join(", ")}). ` +
      "Lokal: apps/logistics/.env.local.example nach .env.local kopieren. " +
      "Production: NEXT_PUBLIC_FIREBASE_* in apphosting.yaml mit availability BUILD setzen.",
  );
}

let cachedApp: FirebaseApp | undefined;

export function clientApp(): FirebaseApp {
  if (cachedApp) return cachedApp;
  if (getApps().length) {
    cachedApp = getApp();
    return cachedApp;
  }

  const config = resolveFirebaseClientConfig();
  try {
    cachedApp = config ? initializeApp(config) : initializeApp();
  } catch {
    const missing = FIREBASE_CLIENT_ENV_KEYS.filter((key) => !process.env[key]);
    throw firebaseClientConfigError(missing);
  }
  return cachedApp;
}

export function clientAuth(): Auth {
  return getAuth(clientApp());
}
