"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { watchUser, firebaseConfigured, type User } from "@/lib/firebase";

/**
 * Who is signed in, and a fresh ID token on demand.
 *
 * `token()` is a function rather than a value because Firebase ID tokens expire after an
 * hour. Holding one in state means the first request after a long-open tab fails with a
 * 401 that looks like a bug; asking the SDK each time lets it refresh transparently.
 *
 * Tokens are deliberately never written to localStorage or a cookie by this app. Firebase
 * manages its own refresh-token storage; a second copy would be a second thing to leak.
 */
interface AuthState {
  user: User | null;
  loading: boolean;
  configured: boolean;
  token: () => Promise<string | null>;
  isAdmin: boolean;
}

const Ctx = createContext<AuthState>({
  user: null,
  loading: true,
  configured: false,
  token: async () => null,
  isAdmin: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const userRef = useRef<User | null>(null);

  useEffect(() => {
    return watchUser((next) => {
      userRef.current = next;
      setUser(next);
      setLoading(false);

      if (next === null) {
        setIsAdmin(false);
        return;
      }

      // The admin claim rides inside the verified token. Reading it here only decides
      // what the UI offers - the API checks it again on every admin route, because a
      // client-side check is a convenience, never a control.
      void next
        .getIdTokenResult()
        .then((result) => setIsAdmin(result.claims["admin"] === true))
        .catch(() => setIsAdmin(false));
    });
  }, []);

  const token = useCallback(async () => {
    const current = userRef.current;
    if (current === null) return null;
    try {
      return await current.getIdToken();
    } catch {
      return null;
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, configured: firebaseConfigured, token, isAdmin }),
    [user, loading, token, isAdmin],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = (): AuthState => useContext(Ctx);
