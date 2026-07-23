"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home,
  Link as LinkIcon,
  LogOut,
  Shield,
  User,
  Zap,
  Menu,
  X,
  Settings,
  Users,
  FileText,
  Rocket,
  Sparkles,
  UserCog,
  BookOpen,
  HelpCircle,
  Newspaper,
  LogIn
} from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageToggle } from "@/components/language-toggle";
import { cn } from "@/lib/utils";
import { logout } from "@/app/actions/auth";
import type { Role } from "@/lib/types";

// User navigation
const USER_NAV = [
  { href: "/", icon: Home, key: "nav.home" },
  { href: "/blog", icon: Newspaper, key: "nav.blog" },

  { href: "/links", icon: LinkIcon, key: "nav.links" },
  { href: "/premium", icon: Sparkles, key: "nav.premium" },
  { href: "/profile", icon: User, key: "nav.profile" },
  { href: "/how-it-works", icon: BookOpen, key: "nav.howItWorks" },
  { href: "/faq", icon: HelpCircle, key: "nav.faq" },
  { href: "/terms", icon: FileText, key: "nav.terms" },
] as const;

// Admin navigation
const ADMIN_NAV = [
  { href: "/admin", icon: Home, key: "nav.dashboard" },
  { href: "/admin/users", icon: Users, key: "nav.users" },
  { href: "/admin/blog", icon: FileText, key: "nav.blog" },
  { href: "/admin/settings", icon: Settings, key: "nav.settings" },
] as const;

// Super Admin navigation
const SUPER_ADMIN_NAV = [
  { href: "/super-admin", icon: Home, key: "nav.overview" },
  { href: "/super-admin/users", icon: Users, key: "nav.users" },
  { href: "/super-admin/elite", icon: Shield, key: "nav.elite" },
  { href: "/super-admin/admins", icon: UserCog, key: "nav.admins" },
  { href: "/super-admin/settings", icon: Settings, key: "nav.systemSettings" },
  { href: "/profile", icon: User, key: "nav.profile" },
] as const;

// Public navigation
const PUBLIC_NAV = [
  { href: "/login", icon: LogIn, key: "auth.login" },
  { href: "/how-it-works", icon: BookOpen, key: "nav.howItWorks" },
  { href: "/faq", icon: HelpCircle, key: "nav.faq" },
  { href: "/terms", icon: FileText, key: "nav.terms" },
] as const;


export function AppSidebar({ role = "user", children, contentClassName }: { role?: Role | "public", children?: React.ReactNode, contentClassName?: string }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [isOpen, setIsOpen] = React.useState(false);

  let navItems: ReadonlyArray<{ href: string; icon: React.ComponentType<{ className?: string }>; key: string }> = PUBLIC_NAV;
  if (role === "user") navItems = USER_NAV;
  if (role === "admin") navItems = ADMIN_NAV;
  if (role === "super_admin") navItems = SUPER_ADMIN_NAV;

  const toggleSidebar = () => setIsOpen(!isOpen);
  const closeSidebar = () => setIsOpen(false);

  // Close sidebar on route change on mobile
  React.useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  const dashLabel = role === "super_admin" ? t("nav.superAdmin") : t("nav.admin");

  return (
    <div className="flex h-dvh w-full bg-background relative overflow-hidden">
      {/* Global Background Glow Effects */}
      <div className="pointer-events-none absolute -left-1/4 -top-1/4 h-[800px] w-[800px] rounded-full bg-accent/20 blur-[120px] opacity-50 dark:bg-accent/10" />
      <div className="pointer-events-none absolute -right-1/4 top-1/3 h-[600px] w-[600px] rounded-full bg-purple-500/10 blur-[100px] opacity-40 dark:bg-purple-600/10" />
      
      {/* Mobile Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeSidebar}
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-dvh w-[280px] flex-col border-r border-border bg-surface shadow-2xl transition-transform duration-300 ease-in-out lg:sticky lg:top-0 lg:translate-x-0 lg:shadow-none",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 shrink-0 items-center px-6 border-b border-border">
          <Link href="/" className="flex items-center gap-2 text-xl font-extrabold hover:opacity-90 transition-opacity">
            <Zap className="h-5 w-5 text-accent animate-pulse" strokeWidth={2.5} />
            <span className="bg-gradient-to-br from-accent to-purple-600 bg-clip-text text-transparent drop-shadow-sm">
              {t("common.appName") || "Smart Dream"}
            </span>
          </Link>
          <button onClick={closeSidebar} className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 lg:hidden text-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 py-6 space-y-2 no-scrollbar">
          {navItems.map((item) => {
            const active = item.href === "/" && role !== "user" && role !== "public" ? false : 
                           item.href === "/" || item.href === "/admin" || item.href === "/super-admin"
                              ? pathname === item.href
                              : pathname.startsWith(item.href);
            const Icon = item.icon;
            const label = t(item.key);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-300",
                  active
                    ? "text-accent"
                    : "text-muted hover:text-foreground"
                )}
              >
                {active && (
                  <motion.div
                    layoutId="active-nav"
                    className="absolute inset-0 rounded-xl bg-accent/10 shadow-[inset_0_0_12px_rgba(99,102,241,0.1)]"
                    initial={false}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <Icon className={cn("relative z-10 h-5 w-5 transition-transform duration-300", active ? "scale-110" : "group- group-hover:text-foreground")} />
                <span className="relative z-10">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border space-y-4">
          {(role === "admin" || role === "super_admin") && (
            <div
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-4 text-sm font-semibold text-accent shadow-sm"
            >
              <Shield className="h-4 w-4" />
              <span>{dashLabel}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
             <LanguageToggle />
             <ThemeToggle />
          </div>

          {role !== "public" && (
            <form action={logout}>
              <button
                type="submit"
                className="group flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-100 dark:bg-zinc-900 px-3 py-2.5 text-sm font-medium text-zinc-700 transition-all hover:bg-danger hover:text-white hover:border-danger dark:border-zinc-800 dark:text-zinc-300"
              >
                <LogOut className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
                <span>{t("common.logout") || "Log out"}</span>
              </button>
            </form>
          )}

          <div className="!mt-1 text-center">
            <span className="text-[10px] text-muted-foreground/60 tracking-[2%]">
              Developer:{" "}
              <a 
                href="https://t.me/nurulhudda247" 
                target="_blank" 
                rel="noreferrer" 
                className="hover:text-accent font-medium transition-colors"
              >
                Nurul Hudda
              </a>
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden min-w-0">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-border bg-background px-4 transition-all duration-300 lg:hidden shadow-sm">
          {/* Left Section: Brand Logo */}
          <Link href="/" className="flex items-center gap-1.5 active:opacity-80 transition-opacity min-w-0">
            <Zap className="h-4 w-4 text-accent animate-pulse shrink-0" strokeWidth={2.5} />
            <span className="text-lg font-black whitespace-nowrap bg-gradient-to-br from-accent via-purple-500 to-indigo-600 bg-clip-text text-transparent drop-shadow-sm truncate">
              {t("common.appName") || "Smart Dream"}
            </span>
          </Link>

          {/* Right Section: Hamburger Menu Button */}
          <button
            onClick={toggleSidebar}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-foreground shadow-sm transition-all duration-200 hover:scale-105 active:scale-95 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Toggle Navigation Sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto no-scrollbar relative">
          <div className={cn("w-full px-4 py-6 sm:px-6 md:px-8 md:py-10", contentClassName)}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
