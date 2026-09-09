"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AdminShell, AdminTabs } from "@/components/AdminShell";
import { UsersBody } from "../_sections/People";
import { AdminsBody } from "../_sections/Administrators";

const TABS = [
  { id: "users", label: "Users" },
  { id: "admins", label: "Administrators" },
];

function PeopleBody() {
  const params = useSearchParams();
  const tab = params.get("tab") === "admins" ? "admins" : "users";
  const q = params.get("q") ?? "";

  return (
    <AdminShell
      title={tab === "admins" ? "Administrators" : "Users"}
      subtitle={
        tab === "admins"
          ? "Who can operate this panel."
          : "Accounts, balances, activity, and ledgers."
      }
      tab={tab}
    >
      <AdminTabs base="/admin/people" active={tab} tabs={TABS} />
      {tab === "admins" ? (
        <AdminsBody />
      ) : (
        /* `key` re-reads a fresh jump-box query rather than keeping a stale search. */
        <UsersBody key={q} initialQuery={q} />
      )}
    </AdminShell>
  );
}

export default function PeoplePage() {
  return (
    <Suspense fallback={null}>
      <PeopleBody />
    </Suspense>
  );
}
