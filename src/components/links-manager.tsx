"use client";

import { useActionState, useState, useTransition } from "react";
import { Pencil, Plus, Trash2, X, Link2, Sparkles, Check, CheckSquare, Square } from "lucide-react";
import type { LinkFormState, BulkAddResult, BulkDeleteResult } from "@/app/actions/links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/components/i18n-provider";
import { MAX_LINKS_PER_USER } from "@/lib/types";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader } from "@/components/page-header";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { toast } from "sonner";
import { useEffect } from "react";

export type LinkItem = { id: string; url: string; likesCount: number };

const NOOP: (s: LinkFormState, fd: FormData) => Promise<LinkFormState> = async () => undefined;

export function LinksManager({
  links,
  userId,
  canAdd,
  addActionHandler,
  updateActionHandler,
  deleteActionHandler,
  bulkAddActionHandler,
  bulkDeleteActionHandler,
}: {
  links: LinkItem[];
  userId: string;
  canAdd: boolean;
  addActionHandler: (state: LinkFormState, formData: FormData) => Promise<LinkFormState>;
  updateActionHandler: (id: string, state: LinkFormState, formData: FormData) => Promise<LinkFormState>;
  deleteActionHandler: (id: string) => Promise<void>;
  bulkAddActionHandler: (urls: string[]) => Promise<BulkAddResult>;
  bulkDeleteActionHandler: (ids: string[]) => Promise<BulkDeleteResult>;
}) {
  const { t, locale } = useI18n();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Selection mode (bulk delete)
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Bulk add (in-modal toggle)
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const [localLinks, setLocalLinks] = useState(links);

  useEffect(() => {
    setLocalLinks(links);
  }, [links]);

  useEffect(() => {
    const es = new EventSource("/api/realtime");
    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { t?: string };
        if (payload.t !== "links") return;
      } catch {
        return;
      }
      // One of this user's links gained a like elsewhere — refresh the
      // id → likesCount map in place (never clobber the whole list).
      void import("@/app/actions/links").then(({ getMyLinkCounts }) =>
        getMyLinkCounts().then((counts) => {
          setLocalLinks((prev) =>
            prev.map((link) => {
              const found = counts.find((c) => c.id === link.id);
              return found ? { ...link, likesCount: found.likesCount } : link;
            })
          );
        }),
      );
    };

    return () => {
      es.close();
    };
  }, [userId]);

  const handleCopy = (id: string, url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const [addState, addAction, addPending] = useActionState<LinkFormState, FormData>(
    addActionHandler,
    undefined,
  );
  const [editState, editAction, editPending] = useActionState<LinkFormState, FormData>(
    editingId ? updateActionHandler.bind(null, editingId) : NOOP,
    undefined,
  );

  useEffect(() => {
    if (addState?.error) {
      toast.error(addState.error);
    } else if (addState?.ok) {
      toast.success(t("links.addSuccess") || "Link added successfully!");
    }
  }, [addState, t]);

  useEffect(() => {
    if (editState?.error) {
      toast.error(editState.error);
    } else if (editState?.ok) {
      toast.success(t("links.updateSuccess") || "Link updated successfully!");
    }
  }, [editState, t]);

  const handleDelete = (id: string) => {
    startTransition(async () => {
      await deleteActionHandler(id);
      setDeleteConfirmId(null);
      toast.success(t("links.deleteSuccess"));
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (prev.size === localLinks.length) return new Set();
      return new Set(localLinks.map((l) => l.id));
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    startTransition(async () => {
      const res = await bulkDeleteActionHandler(ids);
      setBulkDeleteOpen(false);
      exitSelectMode();
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success(t("links.bulkDeleteSuccess").replace("{n}", toBengaliNumber(res.deleted)));
      }
    });
  };

  const handleBulkAdd = async () => {
    const urls = bulkText
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await bulkAddActionHandler(urls);
      if (res.error && res.added === 0) {
        toast.error(res.error);
      } else {
        const msg = t("links.bulkAdded")
          .replace("{added}", toBengaliNumber(res.added))
          .replace("{skipped}", toBengaliNumber(res.skipped));
        toast.success(msg);
        setAdding(false);
        setBulkMode(false);
        setBulkText("");
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const toBengaliNumber = (num: number | string): string => {
    const str = String(num);
    if (locale !== "bn") return str;
    const bnDigits = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
    return str.replace(/[0-9]/g, (digit) => bnDigits[parseInt(digit)]);
  };

  return (
    <div className="flex flex-col gap-8 w-full py-2">
      {/* Header */}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <PageHeader
              badge={t("nav.links")}
              title={t("nav.links")}
              description={t("links.description")}
            />

          <div className="flex flex-col sm:flex-row-reverse items-center gap-3 w-full sm:w-auto self-center sm:self-end">
            <div className="flex flex-col items-center sm:items-end gap-1 shrink-0 bg-surface/90 px-4 py-2.5 rounded-2xl border border-border/30 w-full sm:w-auto text-center sm:text-right">
              <span className="text-[10px] font-bold uppercase text-muted-foreground/70">{t("links.usedQuota")}</span>
              <span className="text-xl font-black text-foreground">
                {toBengaliNumber(localLinks.length)}
                <span className="text-xs font-bold text-muted-foreground/60">/{toBengaliNumber(MAX_LINKS_PER_USER)}</span>
              </span>
            </div>

            <div className="flex gap-2">
              {localLinks.length > 0 && (
                <Button
                  onClick={selectMode ? exitSelectMode : () => setSelectMode(true)}
                  variant={selectMode ? "outline" : "ghost"}
                  className="rounded-2xl font-bold px-4 h-[50px] flex items-center justify-center gap-2 cursor-pointer"
                >
                  {selectMode ? (
                    <>
                      <X className="h-4 w-4" />
                      {t("links.cancelSelection")}
                    </>
                  ) : (
                    <>
                      <CheckSquare className="h-4 w-4" />
                      {t("links.selectMode")}
                    </>
                  )}
                </Button>
              )}

              {canAdd && !selectMode && (
                <Button
                  onClick={() => setAdding(true)}
                  className="w-full sm:w-auto rounded-2xl bg-accent hover:bg-accent/90 text-white font-bold px-5 h-[50px] flex items-center justify-center gap-2 shadow-lg shadow-accent/20 cursor-pointer"
                >
                  <Plus className="h-4.5 w-4.5" />
                  {t("links.addLink")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Animated Progress Bar */}
        <div className="relative w-full h-3 bg-background/40 dark:bg-zinc-800/80 rounded-full overflow-hidden border border-border/30 shadow-inner">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${(localLinks.length / MAX_LINKS_PER_USER) * 100}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="h-full bg-gradient-to-r from-accent to-purple-600 rounded-full shadow-[0_0_12px_rgba(99,102,241,0.3)]"
          />
        </div>
      </div>

      {/* Select-all row (only in select mode) */}
      {selectMode && localLinks.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/40 bg-surface/90 px-4 py-3">
          <button
            type="button"
            onClick={toggleSelectAll}
            className="flex items-center gap-2 text-sm font-bold text-foreground cursor-pointer"
          >
            {selectedIds.size === localLinks.length ? (
              <CheckSquare className="h-5 w-5 text-accent" />
            ) : (
              <Square className="h-5 w-5 text-muted-foreground" />
            )}
            {selectedIds.size === localLinks.length ? t("links.cancelSelection") : t("links.selectAll")}
          </button>
          <span className="text-xs font-bold text-muted-foreground/70">
            {t("links.selected").replace("{n}", toBengaliNumber(selectedIds.size))}
          </span>
        </div>
      )}

      {/* Links List */}
      <div className="flex flex-col gap-4">
        {localLinks.map((link) => {
          const isEditing = editingId === link.id && !selectMode;
          const isSelected = selectedIds.has(link.id);
          return (
            <motion.div
              layout
              key={link.id}
              className={`group relative flex items-center justify-between gap-4 overflow-hidden rounded-3xl border bg-surface/90 p-5 shadow-lg  transition-all hover:shadow-xl ${
                selectMode && isSelected
                  ? "border-accent ring-2 ring-accent/30"
                  : "border-border/40 hover:border-accent/40"
              }`}
            >
              {/* Glow overlay */}
              <div className="absolute inset-0 bg-gradient-to-r from-accent/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <div className="absolute -right-8 -top-8 h-20 w-20 rounded-full bg-accent/5 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

              {isEditing ? (
                <form
                  action={async (fd) => {
                    await editAction(fd);
                    setEditingId(null);
                  }}
                  className="relative z-10 flex flex-1 flex-col gap-3 sm:flex-row sm:items-center w-full"
                >
                  <div className="flex-1">
                    <Input
                      name="url"
                      type="url"
                      defaultValue={link.url}
                      autoFocus
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button type="submit" size="sm" className="rounded-xl px-4 py-2" disabled={editPending}>
                      {editPending ? t("common.loading") : t("common.save")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="rounded-xl px-3"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="relative z-10 flex items-center gap-3.5 min-w-0 flex-1">
                    {selectMode ? (
                      <button
                        type="button"
                        onClick={() => toggleSelect(link.id)}
                        className="flex h-10 w-10 shrink-0 items-center justify-center cursor-pointer"
                        aria-label="Select"
                      >
                        {isSelected ? (
                          <CheckSquare className="h-7 w-7 text-accent" />
                        ) : (
                          <Square className="h-7 w-7 text-muted-foreground/60" />
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleCopy(link.id, link.url)}
                        title={t("links.copyLink")}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background shadow-sm border border-border/40 hover:border-accent/50 group-hover:border-accent/30 transition-all hover:bg-accent/5 cursor-pointer"
                      >
                        {copiedId === link.id ? (
                          <Check className="h-5 w-5 text-green-500" />
                        ) : (
                          <Link2 className="h-5 w-5 text-accent" />
                        )}
                      </button>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold text-foreground group-hover:text-accent transition-colors">
                        {link.url}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground/80 font-bold flex items-center gap-1">
                        <Sparkles className="h-3 w-3 text-purple-500" />
                        {toBengaliNumber(link.likesCount)} {link.likesCount === 1 ? t("common.like") : t("common.likes")}
                      </p>
                    </div>
                  </div>

                  {!selectMode && (
                    <div className="relative z-10 flex items-center gap-2">
                      <button
                        type="button"
                        aria-label="Edit"
                        onClick={() => setEditingId(link.id)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-background/50 text-muted-foreground hover:border-accent/30 hover:text-accent transition-all shadow-sm cursor-pointer"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete"
                        onClick={() => setDeleteConfirmId(link.id)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-danger/20 bg-background/50 text-danger/80 hover:bg-danger/10 hover:border-danger transition-all shadow-sm cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          );
        })}

        {localLinks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center rounded-3xl border border-dashed border-border/60 bg-surface/10">
            <Link2 className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-bold text-muted-foreground/80">
              {t("home.feedEmpty")}
            </p>
          </div>
        )}
      </div>

      {/* Sticky bulk-delete bar */}
      <AnimatePresence>
        {selectMode && selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl border border-border/50 bg-surface/95 shadow-2xl px-5 py-3 max-w-[calc(100vw-2rem)]"
          >
            <span className="text-sm font-extrabold text-foreground whitespace-nowrap">
              {t("links.selected").replace("{n}", toBengaliNumber(selectedIds.size))}
            </span>
            <div className="h-6 w-px bg-border/50" />
            <Button
              type="button"
              onClick={() => setBulkDeleteOpen(true)}
              className="rounded-xl bg-danger text-white border-0 hover:bg-danger/90 px-4 py-2 font-bold cursor-pointer"
            >
              <Trash2 className="h-4 w-4 mr-1.5 inline" />
              {t("links.deleteSelected")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={exitSelectMode}
              className="rounded-xl px-3 py-2 font-bold cursor-pointer"
            >
              {t("common.cancel")}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Link Modal Popup */}
      <AnimatePresence>
        {adding && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setAdding(false);
                setBulkMode(false);
                setBulkText("");
              }}
              className="absolute inset-0 bg-black/60"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-2xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-black text-foreground">
                  {bulkMode ? t("links.addMultiple") : t("links.addTitle")}
                </h2>
                <button
                  onClick={() => {
                    setAdding(false);
                    setBulkMode(false);
                    setBulkText("");
                  }}
                  className="rounded-full p-1.5 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-foreground transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {bulkMode ? (
                <div className="flex flex-col gap-4">
                  <textarea
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={t("links.bulkPlaceholder")}
                    autoFocus
                    rows={6}
                    className="w-full rounded-2xl border border-border/50 bg-background/60 px-4 py-3 text-sm font-medium text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-accent/40 resize-y"
                  />
                  <p className="text-xs text-muted-foreground/70">
                    {t("links.bulkHint").replace("{n}", toBengaliNumber(MAX_LINKS_PER_USER))}
                  </p>
                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 rounded-xl py-5 font-bold"
                      onClick={() => {
                        setAdding(false);
                        setBulkMode(false);
                        setBulkText("");
                      }}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button
                      type="button"
                      onClick={handleBulkAdd}
                      disabled={bulkBusy || bulkText.trim().length === 0}
                      className="flex-1 rounded-xl bg-accent text-white border-0 hover:bg-accent/90 py-5 font-bold transition-colors"
                    >
                      {bulkBusy ? t("common.loading") : t("common.save")}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <form
                    action={async (fd) => {
                      await addAction(fd);
                      setAdding(false);
                    }}
                    className="flex flex-col gap-4"
                  >
                    <div className="space-y-1.5">
                      <Input name="url" type="url" placeholder={t("links.placeholder")} autoFocus className="h-11 rounded-2xl" required />
                    </div>

                    <div className="flex gap-3">
                      <Button type="button" variant="outline" className="flex-1 rounded-xl py-5 font-bold" onClick={() => setAdding(false)}>
                        {t("common.cancel")}
                      </Button>
                      <Button type="submit" disabled={addPending} className="flex-1 rounded-xl bg-accent text-white border-0 hover:bg-accent/90 py-5 font-bold transition-colors">
                        {addPending ? t("common.loading") : t("common.save")}
                      </Button>
                    </div>
                  </form>
                  <button
                    type="button"
                    onClick={() => setBulkMode(true)}
                    className="mt-3 w-full text-center text-xs font-bold text-accent hover:text-accent/80 transition-colors cursor-pointer"
                  >
                    {t("links.addMultiple")}
                  </button>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <DeleteConfirmModal
        isOpen={Boolean(deleteConfirmId)}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => handleDelete(deleteConfirmId!)}
        title={t("links.deleteTitle")}
        description={t("links.deleteConfirm")}
        isPending={isPending}
        cancelText={t("common.cancel")}
        confirmText={t("common.confirm")}
        loadingText={t("common.loading")}
      />

      <DeleteConfirmModal
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        title={t("links.deleteTitle")}
        description={t("links.bulkDeleteConfirm").replace("{n}", toBengaliNumber(selectedIds.size))}
        isPending={isPending}
        cancelText={t("common.cancel")}
        confirmText={t("common.confirm")}
        loadingText={t("common.loading")}
      />
    </div>
  );
}
