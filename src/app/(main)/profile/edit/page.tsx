import { requireUser } from "@/lib/auth";
import { EditProfileForm } from "@/components/edit-profile-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Edit Profile | Smart Dream",
};

import { updateProfile } from "@/app/actions/profile";

export default async function EditProfilePage() {
  const user = await requireUser();
  return <EditProfileForm initialUser={user} action={updateProfile} />;
}
