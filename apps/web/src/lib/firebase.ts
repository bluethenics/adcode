"use client";

/**
 * Firebase, in the browser.
 *
 * Everything in `NEXT_PUBLIC_FIREBASE_*` is public by design - these values identify the
 * project, they do not authorise anything. What protects the data is the API's token
 * verification and Firestore rules that refuse every direct client read (see
 * `firestore.rules`, which denies everything: the browser never talks to Firestore, only
 * to `services/api`).
 *
 * Initialised lazily so a missing config is a handled sign-in failure rather than a crash
 * at module load, which would take the whole marketing site down with it.
 */
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  type Auth,
  type User,
} from "firebase/auth";

const CONFIG = {
  apiKey: process.env["NEXT_PUBLIC_FIREBASE_API_KEY"] ?? "",
  authDomain: process.env["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"] ?? "",
  projectId: process.env["NEXT_PUBLIC_FIREBASE_PROJECT_ID"] ?? "",
  appId: process.env["NEXT_PUBLIC_FIREBASE_APP_ID"] ?? "",
} as const;

export const firebaseConfigured = CONFIG.apiKey.length > 0 && CONFIG.projectId.length > 0;

function app(): FirebaseApp {
  return getApps().length === 0 ? initializeApp(CONFIG) : getApp();
}

export function auth(): Auth {
  return getAuth(app());
}

export type { User };

export function watchUser(listener: (user: User | null) => void): () => void {
  if (!firebaseConfigured) {
    // Report "signed out" rather than hanging on a loading spinner forever.
    listener(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth(), listener);
}

export async function signInEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth(), email, password);
}

export async function registerEmail(email: string, password: string): Promise<void> {
  await createUserWithEmailAndPassword(auth(), email, password);
}

export async function signInGoogle(): Promise<void> {
  await signInWithPopup(auth(), new GoogleAuthProvider());
}

export async function signOutNow(): Promise<void> {
  await signOut(auth());
}

/**
 * Firebase's own message text is written for developers ("auth/wrong-password").
 * These are written for whoever is looking at the screen.
 */
export function authMessage(error: unknown): string {
  const code = typeof error === "object" && error !== null ? String((error as { code?: unknown }).code ?? "") : "";

  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email or password is incorrect.";
    case "auth/email-already-in-use":
      return "There's already an account with that email. Sign in instead.";
    case "auth/weak-password":
      return "Use a password of at least six characters.";
    case "auth/popup-closed-by-user":
      return "The sign-in window closed before finishing.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "Couldn't reach the sign-in service. Check your connection.";
    default:
      return "Couldn't sign in. Try again.";
  }
}
