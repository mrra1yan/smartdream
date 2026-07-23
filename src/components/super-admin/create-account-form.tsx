"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useI18n } from "@/components/i18n-provider";
import { toast } from "sonner";

type CreateArgs = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  password: string;
};

export function CreateAccountForm({
  create,
  cta,
  onSuccess,
}: {
  create: (
    args: CreateArgs,
  ) => Promise<{ ok?: boolean; error?: string }>;
  cta: string;
  onSuccess?: () => void;
}) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    startTransition(async () => {
      const res = await create({
        firstName: String(fd.get("firstName") ?? ""),
        lastName: String(fd.get("lastName") ?? ""),
        phone: String(fd.get("phone") ?? ""),
        email: String(fd.get("email") ?? ""),
        password: String(fd.get("password") ?? ""),
      });
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success(t("superAdmin.created"));
        form.reset();
        if (onSuccess) onSuccess();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-1.5">
          <Label htmlFor="firstName">{t("auth.firstName")}</Label>
          <Input id="firstName" name="firstName" />
        </div>
        <div className="flex-1 flex flex-col gap-1.5">
          <Label htmlFor="lastName">{t("auth.lastName")}</Label>
          <Input id="lastName" name="lastName" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">{t("auth.phone")}</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          onKeyPress={(e) => {
            if (!/[0-9]/.test(e.key)) {
              e.preventDefault();
            }
          }}
          onChange={(e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, "");
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{t("auth.email")}</Label>
        <Input id="email" name="email" type="email" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">{t("auth.password")}</Label>
        <PasswordInput id="password" name="password" />
      </div>
      <Button type="submit" disabled={pending} variant="accent" className="capitalize">
        {pending ? t("superAdmin.creating") : cta}
      </Button>
    </form>
  );
}
