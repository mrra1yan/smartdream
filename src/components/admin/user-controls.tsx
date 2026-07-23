"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  activateAutoLike,
  activateBoost,
  deactivateAutoLike,
  deactivateBoost,
  removeUser,
  resetPassword,
} from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FeatureModel, TimePreset } from "@/lib/types";
import { KeyRound, ShieldAlert, CheckCircle2, Activity, ChevronDown, Rocket } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { ConfirmModal } from "@/components/ui/confirm-modal";

const MODELS: FeatureModel[] = ["no_expiry", "time", "usage"];
const PRESETS: TimePreset[] = ["1w", "1m", "3m", "6m", "1y"];

export function UserControls({
  userId,
  role = "user",
  isBoosted = false,
  isAutoLikeEnabled = false,
  currentBoostModel = "none",
  currentAutoLikeModel = "none",
  autoLikePaused = false,
}: {
  userId: string;
  role?: string;
  isBoosted?: boolean;
  isAutoLikeEnabled?: boolean;
  currentBoostModel?: FeatureModel;
  currentAutoLikeModel?: FeatureModel;
  autoLikePaused?: boolean;
}) {
  const { t } = useI18n();

  // failIfElite (src/lib/admin.ts) blocks every one of these actions --
  // password reset and delete included -- when the target is anything other
  // than a plain "user" role, for any caller that isn't a super_admin. A
  // plain admin can reach this component for an admin-role target via the
  // "Admin" tab in users-manager-client.tsx (getAllUsers() doesn't apply the
  // same elite/admin exclusion getUserForAdmin does), so without this guard
  // these buttons were visible but would always fail server-side. Hiding
  // them here (matching the existing role==="user" gate on the feature
  // cards below) avoids presenting controls that can never succeed.
  if (role !== "user") {
    return (
      <div className="w-full rounded-3xl border border-border/50 bg-surface/60 p-6 text-center text-xs font-semibold text-muted-foreground">
        {t("admin.adminManagementRestricted") ||
          "Only a super-admin can reset another admin's password or remove their account."}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
      <FeatureCard
        title={t("admin.boosted") + " " + t("admin.status")}
        userId={userId}
        activate={activateBoost}
        deactivate={deactivateBoost}
        isActive={isBoosted}
        currentModel={currentBoostModel}
      />
      <FeatureCard
        title={t("admin.autoLike") + " " + t("admin.status")}
        userId={userId}
        activate={activateAutoLike}
        deactivate={deactivateAutoLike}
        isActive={isAutoLikeEnabled}
        currentModel={currentAutoLikeModel}
        currentPaused={autoLikePaused}
      />
      <PasswordCard userId={userId} />
      <DangerCard userId={userId} />
    </div>
  );
}

function FeatureCard({
  title,
  userId,
  activate,
  deactivate,
  isActive = false,
  currentModel = "none",
  currentPaused = false,
}: {
  title: string;
  userId: string;
  activate: (args: {
    userId: string;
    model: FeatureModel;
    preset?: TimePreset;
    quota?: number;
  }) => Promise<{ ok?: boolean; error?: string }>;
  deactivate: (userId: string) => Promise<{ ok?: boolean; error?: string }>;
  isActive?: boolean;
  // What's actually saved in the DB right now, so the form can start from
  // reality instead of always defaulting to "no_expiry" -- previously the
  // dropdown always showed "No expiry" pre-selected on every page load
  // regardless of the real stored model, which made it impossible for an
  // admin to visually tell whether an earlier activation had actually been
  // confirmed/saved or not.
  currentModel?: FeatureModel;
  currentPaused?: boolean;
}) {
  const { t } = useI18n();
  const [model, setModel] = useState<FeatureModel>(
    currentModel === "none" ? "no_expiry" : currentModel,
  );
  const [preset, setPreset] = useState<TimePreset>("1m");
  const [quota, setQuota] = useState<number>(50);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [localActive, setLocalActive] = useState(isActive);

  useEffect(() => {
    setLocalActive(isActive);
  }, [isActive]);

  const modelLabel = (m: FeatureModel): string => {
    if (m === "no_expiry") return t("premium.durNoExpiry");
    if (m === "time") return t("admin.timeBound");
    if (m === "usage") return t("admin.usageBound");
    return t("admin.inactive");
  };

  const [showConfirmActivate, setShowConfirmActivate] = useState(false);
  const [showConfirmDeactivate, setShowConfirmDeactivate] = useState(false);

  const router = useRouter();

  function handleActivate() {
    setShowConfirmActivate(false);
    setError(null);
    startTransition(async () => {
      const res = await activate({
        userId,
        model,
        preset: model === "time" ? preset : undefined,
        quota: model === "usage" ? quota : undefined,
      });
      if (res.error) {
        setError(res.error);
      } else {
        setLocalActive(true);
        router.refresh();
      }
    });
  }

  function handleDeactivate() {
    setShowConfirmDeactivate(false);
    setError(null);
    startTransition(async () => {
      const res = await deactivate(userId);
      if (res.error) {
        setError(res.error);
      } else {
        setLocalActive(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="relative overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-xl flex flex-col gap-4">
      <div className="absolute -right-16 -top-16 h-36 w-36 rounded-full bg-accent/5 blur-3xl pointer-events-none" />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/10 pb-3">
        <h3 className="text-base font-bold text-foreground flex items-center gap-2">
          {title.includes("Boost") || title.includes("বুস্ট") ? <Rocket className="h-4 w-4 text-accent" /> : <Activity className="h-4 w-4 text-purple-500" />}
          {title}
        </h3>
        {localActive && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowConfirmDeactivate(true)}
            disabled={pending}
            className="w-full sm:w-auto rounded-xl px-3 h-8 text-[10px] sm:text-[9px] font-semibold hover:bg-danger/10 hover:text-danger hover:border-danger/30 transition-all shrink-0"
          >
            {t("admin.deactivate")}
          </Button>
        )}
      </div>

      <p className="-mt-2 text-[11px] font-medium text-muted-foreground">
        {t("admin.currentlySaved")}: <span className="font-bold">{modelLabel(currentModel)}</span>
        {currentModel !== "none" && currentPaused ? ` · ${t("admin.paused")}` : ""}
      </p>

      <div className="flex flex-col gap-3">
        <div className={`grid grid-cols-1 ${model === "no_expiry" ? "" : "sm:grid-cols-2"} gap-3`}>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted-foreground">{t("admin.model")}</label>
            <div className="relative w-full">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as FeatureModel)}
                className="w-full h-11 rounded-xl border border-border/50 bg-surface/90 pl-3 pr-10 text-sm focus:border-accent/50 focus:ring-1 focus:ring-accent/50 outline-none transition-all cursor-pointer appearance-none"
              >
                {MODELS.map((m) => (
                  <option key={m} value={m} className="bg-surface text-foreground">
                    {m === "no_expiry" ? t("premium.durNoExpiry") : m === "time" ? t("admin.timeBound") : t("admin.usageBound")}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {model === "time" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">{t("admin.duration")}</label>
              <div className="relative w-full">
                <select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as TimePreset)}
                  className="w-full h-11 rounded-xl border border-border/50 bg-surface/90 pl-3 pr-10 text-sm focus:border-accent/50 focus:ring-1 focus:ring-accent/50 outline-none transition-all cursor-pointer appearance-none"
                >
                  {PRESETS.map((p) => (
                    <option key={p} value={p} className="bg-surface text-foreground">
                      {p === "1w" ? t("premium.dur1w") : p === "1m" ? t("premium.dur1m") : p === "3m" ? t("premium.dur3m") : p === "6m" ? t("premium.dur6m") : t("premium.dur1y")}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          ) : null}

          {model === "usage" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">{t("admin.quotaLikes")}</label>
              <Input
                type="number"
                min={1}
                value={quota}
                onChange={(e) => setQuota(Number(e.target.value))}
                className="h-11 rounded-xl border border-border/50 bg-surface/90 px-3 text-sm focus-border-accent/50 focus:ring-1 focus:ring-accent/50 outline-none transition-all"
              />
            </div>
          ) : null}
        </div>

        <Button
          type="button"
          variant="accent"
          onClick={() => setShowConfirmActivate(true)}
          disabled={pending}
          className="w-full mt-2 h-11 rounded-xl font-bold text-[9px] uppercase"
        >
          {pending ? t("admin.applying") : localActive ? (t("admin.update") || "Update") : (t("admin.activate") || "Activate")}
        </Button>
      </div>

      {error ? <p className="text-xs font-semibold text-danger">{error}</p> : null}

      <ConfirmModal
        open={showConfirmActivate}
        onConfirm={handleActivate}
        onCancel={() => setShowConfirmActivate(false)}
        title={t("common.confirm") || "Are you sure?"}
        description={t("admin.confirmActivateDesc", { feature: title })}
        confirmLabel={localActive ? (t("admin.update") || "Update") : (t("admin.activate") || "Activate")}
        cancelLabel={t("common.cancel") || "Cancel"}
        loading={pending}
      />

      <ConfirmModal
        open={showConfirmDeactivate}
        onConfirm={handleDeactivate}
        onCancel={() => setShowConfirmDeactivate(false)}
        title={t("common.confirm") || "Are you sure?"}
        description={t("admin.confirmDeactivateDesc", { feature: title })}
        confirmLabel={t("admin.deactivate") || "Deactivate"}
        cancelLabel={t("common.cancel") || "Cancel"}
        variant="danger"
        loading={pending}
      />
    </div>
  );
}

// PasswordCard
function PasswordCard({ userId }: { userId: string }) {
  const { t } = useI18n();
  const [pw, setPw] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function onReset() {
    setError(null);
    setDone(false);
    startTransition(async () => {
      const res = await resetPassword(userId, pw);
      if (res.error) setError(res.error);
      else {
        setDone(true);
        setPw("");
      }
    });
  }

  return (
    <div className="relative overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-xl flex flex-col justify-between gap-4">
      <div className="absolute -right-16 -top-16 h-36 w-36 rounded-full bg-accent/5 blur-3xl pointer-events-none" />

      <div className="flex items-center justify-between border-b border-border/10 pb-3">
        <h3 className="text-base font-bold text-foreground flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-accent" />
          {t("admin.resetPassword")}
        </h3>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted-foreground">{t("profile.newPasswordLabel")}</label>
          <Input
            type="text"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder={t("admin.passwordPlaceholder")}
            className="h-11 rounded-xl border border-border/50 bg-surface/90 px-3 text-sm focus:border-accent/50 focus:ring-1 focus:ring-accent/50 outline-none transition-all"
          />
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={onReset}
          disabled={pending || pw.length < 8}
          className="w-full mt-2 h-11 rounded-xl font-bold text-[9px] uppercase hover:bg-accent hover:text-white hover:border-accent transition-all"
        >
          {pending ? t("admin.resetting") : t("admin.resetPassword")}
        </Button>
      </div>

      {done ? (
        <p className="text-xs font-semibold text-green-500 flex items-center gap-1">
          <CheckCircle2 className="h-4 w-4 text-green-500" /> {t("profile.passwordSuccess")}
        </p>
      ) : null}
      {error ? <p className="text-xs font-semibold text-danger">{error}</p> : null}
    </div>
  );
}

// DangerCard
function DangerCard({ userId }: { userId: string }) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  function onConfirmRemove() {
    setShowConfirm(false);
    setError(null);
    startTransition(async () => {
      const res = await removeUser(userId);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="relative overflow-hidden rounded-3xl border border-danger/20 bg-danger/5 p-6 shadow-xl flex flex-col justify-between gap-4">
      <div className="absolute -right-16 -top-16 h-36 w-36 rounded-full bg-danger/10 blur-3xl pointer-events-none" />

      <div className="flex items-center justify-between border-b border-danger/10 pb-3">
        <h3 className="text-base font-bold text-danger flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-danger" />
          {t("admin.dangerZone")}
        </h3>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground font-medium">
          {t("admin.deleteUserWarning")}
        </p>
        <Button
          type="button"
          variant="danger"
          onClick={() => setShowConfirm(true)}
          disabled={pending}
          className="w-full mt-2 h-11 rounded-xl font-bold text-[9px] uppercase"
        >
          {pending ? t("admin.deleting") : t("admin.permanentlyDelete")}
        </Button>
      </div>

      {error ? <p className="text-xs font-semibold text-danger">{error}</p> : null}

      <ConfirmModal
        open={showConfirm}
        onConfirm={onConfirmRemove}
        onCancel={() => setShowConfirm(false)}
        title={t("admin.confirmDeleteUser")}
        description={t("admin.deleteUserWarning")}
        confirmLabel={t("common.delete") || "Delete"}
        cancelLabel={t("common.cancel") || "Cancel"}
        variant="danger"
        loading={pending}
      />
    </div>
  );
}
