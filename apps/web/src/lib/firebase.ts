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
  GithubAuthProvider,
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

/**
 * Sign in with GitHub.
 *
 * No scopes are requested. The default grant is the public profile and a verified email
 * address, which is everything this site needs to know who someone is - asking for
 * `repo` or `read:user` would put a consent screen listing someone's private
 * repositories in front of a button whose only job is to say hello.
 */
export async function signInGithub(): Promise<void> {
  await signInWithPopup(auth(), new GithubAuthProvider());
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
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.";
    // Someone who signed up with Google and then pressed GitHub. Firebase refuses the
    // second provider rather than merging silently, and the message has to say which
    // button to press instead - "account exists" on its own sends people to support.
    case "auth/account-exists-with-different-credential":
      return "You already have an account with that email, created with a different sign-in method. Use the one you signed up with.";
    // The three below are configuration, not anything the person at the screen did wrong.
    // They say so, because the generic message sent whoever hit this hunting in the wrong
    // place - the host is missing from Firebase's Authorized domains, or the provider was
    // never switched on. Both are one checkbox in a console nobody thinks to look at.
    case "auth/unauthorized-domain":
      return "This site's address isn't allowed to sign people in yet. Add it to Firebase → Authentication → Settings → Authorized domains.";
    case "auth/operation-not-allowed":
      return "That sign-in method is switched off. Enable it in Firebase → Authentication → Sign-in method.";
    case "auth/configuration-not-found":
      return "Sign-in is not configured for this Firebase project yet.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "Couldn't reach the sign-in service. Check your connection.";
    default:
      return "Couldn't sign in. Try again.";
  }
}
