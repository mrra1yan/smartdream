import { requireUser } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/change-password-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Change Password | Smart Dream",
};

import { changePassword } from "@/app/actions/profile";

export default async function ChangePasswordPage() {
  await requireUser();
  return <ChangePasswordForm action={changePassword} />;
}
