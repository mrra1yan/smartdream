import type { Metadata } from "next";
import { UsersManagerClient } from "@/components/admin/users-manager-client";
import { getAllUsers } from "@/lib/admin";

export const metadata: Metadata = { title: "Users | Admin" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const users = await getAllUsers();
  return <UsersManagerClient initialUsers={users} />;
}
