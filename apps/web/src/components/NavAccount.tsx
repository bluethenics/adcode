"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";

/**
 * The account end of the nav.
 *
 * Renders nothing at all until auth resolves, rather than flashing "Sign in" at someone
 * who is already signed in. A nav that changes its mind half a second after paint reads
 * as broken.
 */
export function NavAccount() {
  const { user, loading, configured, isAdmin } = useAuth();

  if (!configured || loading) return null;

  if (user === null) {
    return (
      <Link href="/dashboard" data-optional="true">
        Sign in
      </Link>
    );
  }

  return (
    <>
      {isAdmin && (
        <Link href="/admin" data-optional="true">
          Admin
        </Link>
      )}
      <Link href="/portal" data-optional="true">
        Portal
      </Link>
      <Link href="/dashboard">Earnings</Link>
    </>
  );
}
