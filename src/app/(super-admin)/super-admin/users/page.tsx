import type { Metadata } from "next";
import { requireSuperAdmin } from "@/lib/auth";
import { getAllUsersForSuper } from "@/lib/super-admin";
import { UsersManager } from "@/components/super-admin/users-manager";

export const metadata: Metadata = { title: "All users | Super Admin" };

type Props = {
  searchParams: Promise<{ q?: string }>;
};

export default async function SuperUsersPage({ searchParams }: Props) {
  await requireSuperAdmin();
  const { q } = await searchParams;
  const all = await getAllUsersForSuper();
  const filtered = all.filter((u) => !u.isElite && u.role !== "admin");

  return <UsersManager users={filtered} initialQ={q} />;
}
