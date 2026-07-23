import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth";
import { getUserForAdmin, getReferralStats } from "@/lib/admin";
import { Card } from "@/components/ui/card";
import { SuperUserActions } from "@/components/super-admin/super-user-actions";
import { getI18n } from "@/lib/i18n";
import Link from "next/link";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const user = await getUserForAdmin(id);
  return { title: user ? `${user.firstName} ${user.lastName} | Super Admin` : "Super Admin" };
}

export default async function SuperUserDetailPage({ params }: Props) {
  await requireSuperAdmin();
  const { t } = await getI18n();
  const { id } = await params;
  const user = await getUserForAdmin(id);
  if (!user) notFound();

  const referralStats = await getReferralStats(user.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">
          {user.firstName} {user.lastName}
        </h1>
        <p className="text-xs text-muted">
          {user.email} · {user.phone || t("superAdmin.noPhone")} · {t("superAdmin.role")} {user.role === "admin" ? t("nav.admin") : user.role === "super_admin" ? t("nav.superAdmin") : t("nav.users")}
          {user.isElite ? ` · ${t("nav.elite").toLowerCase()}` : ""}
        </p>
        <p className="text-xs text-muted">{t("admin.publicId")}: {user.publicId}</p>
      </div>

      <SuperUserActions user={user} />

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("superAdmin.accountInfo")}</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-muted">{t("admin.status")}</span>
          <span>{user.status === "approved" ? t("admin.statusApproved") : user.status === "rejected" ? t("admin.statusRejected") : t("admin.statusPending")}</span>
          <span className="text-muted">{t("nav.elite")}</span>
          <span>{user.isElite ? t("superAdmin.yes") : t("superAdmin.no")}</span>
          <span className="text-muted">{t("superAdmin.joined")}</span>
          <span>{new Date(user.createdAt).toLocaleDateString()}</span>
          {referralStats.referredByProfile && (
            <>
              <span className="text-muted">{t("admin.referredBy") || "Referred by"}</span>
              <span>
                <Link href={`/super-admin/users/${referralStats.referredByProfile.id}`} className="text-blue-500 hover:underline">
                  {referralStats.referredByProfile.firstName} {referralStats.referredByProfile.lastName}
                </Link>
              </span>
            </>
          )}
          {referralStats.approvedByProfile && (
            <>
              <span className="text-muted">{t("superAdmin.approvedBy")}</span>
              <span>
                <Link href={`/super-admin/users/${referralStats.approvedByProfile.id}`} className="text-blue-500 hover:underline">
                  {referralStats.approvedByProfile.firstName} {referralStats.approvedByProfile.lastName}
                </Link>
              </span>
            </>
          )}
          <span className="text-muted">{t("admin.totalReferred") || "Users Referred"}</span>
          <span>{referralStats.totalReferred}</span>
        </div>
      </Card>
    </div>
  );
}
