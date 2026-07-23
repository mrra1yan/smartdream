"use client";

import { useActionState, useState, useRef, useTransition, useOptimistic } from "react";
import { Pencil, Plus, Trash2, X, FileText } from "lucide-react";
import type { BlogFormState } from "@/app/actions/blog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Blog } from "@/lib/blog";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n-provider";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { FormField } from "@/components/form-field";
import { createPortal } from "react-dom";
import Image from "next/image";

const EMPTY = {
  id: "",
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  heroImage: "",
  published: false,
};

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-") // Replace spaces with -
    .replace(/[^a-z0-9\-]+/g, "") // Remove all non-word chars except hyphens
    .replace(/\-\-+/g, "-") // Replace multiple - with single -
    .replace(/^-+/, "") // Trim - from start of text
    .replace(/-+$/, ""); // Trim - from end of text
}

export function BlogManager({
  blogs,
  saveActionHandler,
  deleteActionHandler,
}: {
  blogs: Blog[];
  saveActionHandler: (id: string | null, state: BlogFormState, formData: FormData) => Promise<BlogFormState>;
  deleteActionHandler: (id: string) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<(typeof EMPTY) | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [isSlugEdited, setIsSlugEdited] = useState(false);
  const [heroImage, setHeroImage] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [content, setContent] = useState("");
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"all" | "published" | "draft">("all");

  const handleDelete = (id: string) => {
    startTransition(async () => {
      addOptimisticBlog({ action: "delete", blog: { id } as Blog });
      await deleteActionHandler(id);
      setDeleteConfirmId(null);
    });
  };

  const formRef = useRef<HTMLFormElement>(null);

  const [state, formAction, pending] = useActionState<BlogFormState, FormData>(
    editing ? saveActionHandler.bind(null, editing.id || null) : saveActionHandler.bind(null, null),
    undefined,
  );

  const [optimisticBlogs, addOptimisticBlog] = useOptimistic(
    blogs,
    (state: Blog[], update: { action: "add" | "update" | "delete"; blog: Blog }) => {
      switch (update.action) {
        case "add":
          return [update.blog, ...state];
        case "update":
          return state.map((b) => (b.id === update.blog.id ? update.blog : b));
        case "delete":
          return state.filter((b) => b.id !== update.blog.id);
        default:
          return state;
      }
    }
  );

  const filteredBlogs = optimisticBlogs.filter((blog) => {
    if (filter === "published") return (blog as any).published_at !== null;
    if (filter === "draft") return (blog as any).published_at === null;
    return true;
  });

  const isDirty =
    title !== (editing?.title ?? "") ||
    slug !== (editing?.slug ?? "") ||
    heroImage !== (editing?.heroImage ?? "") ||
    excerpt !== (editing?.excerpt ?? "") ||
    content !== (editing?.content ?? "");

  const handleCloseAttempt = () => {
    if (isDirty) {
      setShowConfirmClose(true);
    } else {
      setEditing(null);
    }
  };

  return (
    <div className="flex flex-col gap-8 w-full py-2">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/20 pb-4">
        <h1 className="text-2xl font-black text-foreground flex items-center gap-2">
          <FileText className="h-6 w-6 text-accent" />
          {t("admin.blog")}
        </h1>
        <Button
          variant="accent"
          onClick={() => {
            setTitle("");
            setSlug("");
            setIsSlugEdited(false);
            setHeroImage("");
            setExcerpt("");
            setContent("");
            setEditing({ ...EMPTY });
          }}
          className="rounded-xl px-4 py-2 font-bold text-xs gap-1"
        >
          <Plus className="h-4 w-4" />
          {t("admin.newPost")}
        </Button>
      </div>

      {editing && typeof window !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            ref={formRef}
            action={async (fd) => {
              const actionType = fd.get("action");
              const isPublish = actionType === "publish";
              const newBlog: any = {
                id: editing.id || `temp-${Date.now()}`,
                title: fd.get("title") as string,
                slug: fd.get("slug") as string,
                excerpt: fd.get("excerpt") as string,
                content: fd.get("content") as string,
                hero_image: fd.get("heroImage") as string,
                published_at: isPublish ? new Date().toISOString() : null,
                created_at: new Date().toISOString(),
              };

              addOptimisticBlog({
                action: editing.id ? "update" : "add",
                blog: newBlog as Blog,
              });

              setEditing(null);
              await formAction(fd);
            }}
            className="relative w-full max-w-2xl h-[90vh] sm:h-auto sm:max-h-[90vh] overflow-hidden rounded-3xl border border-border dark:border-border/50 bg-surface/95 p-6 shadow-2xl flex flex-col gap-5"
          >
          <div className="absolute -right-16 -top-16 h-36 w-36 rounded-full bg-accent/5 blur-3xl pointer-events-none" />

          {/* Form Header */}
          <div className="flex items-center justify-between border-b border-border/10 pb-3">
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              {editing.id ? <Pencil className="h-4 w-4 text-accent" /> : <Plus className="h-4 w-4 text-accent" />}
              {editing.id ? t("admin.editPost") : t("admin.createPost")}
            </h3>
            <button
              type="button"
              onClick={handleCloseAttempt}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-border dark:border-border/40 text-muted-foreground hover:text-foreground hover:bg-surface/80 hover:border-border/80 transition-all cursor-pointer shadow-sm"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Scrollable Form Body */}
          <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-5 no-scrollbar min-h-0">

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
            <FormField
              label={t("admin.title")}
              name="title"
              value={title}
              onChange={(e) => {
                const val = e.target.value;
                setTitle(val);
                if (!isSlugEdited) {
                  setSlug(slugify(val));
                }
              }}
              placeholder={t("admin.title")}
              autoFocus
            />

            <FormField
              label={t("admin.slug")}
              name="slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"));
                setIsSlugEdited(true);
              }}
              placeholder="my-new-post"
            />
          </div>

          <div className="flex flex-col gap-2 w-full">
            <Label className="text-xs font-semibold text-muted-foreground">{t("admin.heroImage")}</Label>
            
            <div className="flex flex-col sm:flex-row gap-4 items-start w-full">
              {/* Image Preview */}
              {heroImage ? (
                <div className="relative group/preview h-28 w-44 rounded-2xl overflow-hidden border border-border/50 bg-background/50 flex-shrink-0 flex items-center justify-center">
                  <Image
                    src={heroImage}
                    alt="Hero preview"
                    fill
                    className="object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setHeroImage("")}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-danger transition-all"
                    title="Remove image"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="h-28 w-44 rounded-2xl border border-dashed border-border/60 bg-surface/10 flex-shrink-0 flex flex-col items-center justify-center text-muted-foreground text-xs gap-1.5 p-2">
                  <FileText className="h-5 w-5 text-muted-foreground/50" />
                  <span>{t("admin.noImage")}</span>
                </div>
              )}

              {/* Input Options */}
              <div className="flex-1 w-full flex flex-col gap-3">
                {/* URL Input */}
                <div className="flex flex-col gap-1 w-full">
                  <Label htmlFor="heroImageUrlInput" className="text-[10px] font-bold text-muted-foreground uppercase">{t("admin.imageUrl")}</Label>
                  <Input
                    id="heroImageUrlInput"
                    type="url"
                    value={heroImage.startsWith("data:") ? "" : heroImage}
                    onChange={(e) => setHeroImage(e.target.value)}
                    placeholder="https://images.unsplash.com/... or paste URL"
                    className="h-10 rounded-xl border border-border/50 bg-surface/90 px-3 text-sm focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:border-accent/50 transition-all placeholder:text-muted-foreground/30"
                  />
                </div>

                {/* File Upload Selector */}
                <div className="flex flex-col gap-1 w-full">
                  <Label className="text-[10px] font-bold text-muted-foreground uppercase">{t("admin.orUpload")}</Label>
                  <label className="flex items-center gap-2 px-4 h-10 rounded-xl border border-border/50 bg-surface/90 hover:bg-surface/50 text-sm font-semibold text-foreground cursor-pointer transition-all w-fit">
                    <span>{t("admin.chooseFile")}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setHeroImage(reader.result as string);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Hidden Input to send the value to action */}
            <input type="hidden" name="heroImage" value={heroImage} />
          </div>

          <FormField label={t("admin.excerpt")} name="excerpt">
            <Textarea
              id="excerpt"
              name="excerpt"
              rows={2}
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              className="rounded-xl border border-border/50 bg-surface/90 px-3 py-2 text-sm focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:border-accent/50 transition-all placeholder:text-muted-foreground/30 resize-none"
              placeholder="Provide a brief summary of the post..."
            />
          </FormField>

          <FormField label={t("admin.content")} name="content">
            <Textarea
              id="content"
              name="content"
              rows={12}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="rounded-xl border border-border/50 bg-surface/90 px-3 py-3 text-sm focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:border-accent/50 transition-all placeholder:text-muted-foreground/30 font-sans"
              placeholder="Write your blog post content here (Markdown supported)..."
            />
          </FormField>

          </div>

          {state?.error ? (
            <p className="text-xs font-semibold text-danger">{state.error}</p>
          ) : null}

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border/10 pt-4 mt-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleCloseAttempt}
              className="w-full sm:w-auto h-11 px-6 rounded-xl font-bold border-danger text-danger bg-transparent hover:bg-danger hover:text-white hover:border-danger transition-all duration-200 active:scale-95 cursor-pointer"
            >
              {t("common.cancel")}
            </Button>
            
            <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
              <button
                type="submit"
                name="action"
                value="draft"
                disabled={pending}
                className="w-full sm:w-auto h-11 px-6 rounded-xl font-semibold border border-border bg-surface text-foreground hover:bg-surface/80 transition-all disabled:opacity-50"
              >
                {t("admin.publishLater")}
              </button>
              
              <button
                type="submit"
                name="action"
                value="publish"
                disabled={pending}
                className="w-full sm:w-auto h-11 px-8 rounded-xl font-bold bg-accent text-white hover:bg-accent/90 transition-all disabled:opacity-50"
              >
                {pending ? t("admin.saving") : t("admin.publishNow")}
              </button>
            </div>
          </div>
          </form>
        </div>,
        document.body
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2 p-1 rounded-xl bg-surface/90 border border-border/50 w-fit">
        {(["all", "published", "draft"] as const).map((tab) => {
          const isActive = filter === tab;
          const count = optimisticBlogs.filter((b) => {
            if (tab === "published") return (b as any).published_at !== null;
            if (tab === "draft") return (b as any).published_at === null;
            return true;
          }).length;
          
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={cn(
                "px-3 py-1.5 text-xs font-bold rounded-lg uppercase transition-all flex items-center gap-1.5",
                isActive
                  ? "bg-accent text-white shadow-md shadow-accent/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface/50"
              )}
            >
              <span>{tab === "all" ? t("admin.all") : tab === "published" ? t("admin.published") : t("admin.drafts")}</span>
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-mono",
                isActive ? "bg-white/20 text-white" : "bg-surface/50 text-muted-foreground"
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Blog Cards Listing */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
        {filteredBlogs.map((blog) => {
          const isPublished = (blog as any).published_at !== null;
          const displayDate = (blog as any).published_at
            ? new Date((blog as any).published_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : t("admin.drafts");

          return (
            <div
              key={blog.id}
              className="group relative flex flex-col gap-3 rounded-3xl border border-border dark:border-border/40 bg-surface/90 p-3 hover:border-accent/30 transition-all hover:bg-surface/50 hover:shadow-xl"
            >
              {/* Thumbnail Image Container */}
              <div className="relative aspect-video w-full rounded-2xl overflow-hidden border border-border dark:border-border/50 bg-background/50 flex items-center justify-center">
                {(blog as any).hero_image ? (
                  <Image
                    src={(blog as any).hero_image}
                    alt={blog.title}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="h-full w-full bg-gradient-to-br from-accent/10 to-purple-600/10 flex items-center justify-center">
                    <FileText className="h-8 w-8 text-accent/40" />
                  </div>
                )}
                
                {/* Status Indicator Badge */}
                <span className={cn(
                  "absolute bottom-2 right-2 rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase border bg-black/60 text-white  z-10",
                  isPublished ? "border-green-500/30 text-green-400" : "border-amber-500/30 text-amber-400"
                )}>
                  {isPublished ? t("admin.published") : t("admin.drafts")}
                </span>

                {/* Actions Overlay (Always visible on mobile, hover-only on desktop) */}
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-20 md:opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <button
                    type="button"
                    aria-label="Edit"
                    onClick={() => {
                      setTitle(blog.title);
                      setSlug(blog.slug);
                      setIsSlugEdited(true);
                      setHeroImage((blog as any).hero_image ?? "");
                      setExcerpt(blog.excerpt ?? "");
                      setContent(blog.content ?? "");
                      setEditing({
                        id: blog.id,
                        title: blog.title,
                        slug: blog.slug,
                        excerpt: blog.excerpt ?? "",
                        content: blog.content ?? "",
                        heroImage: (blog as any).hero_image ?? "",
                        published: Boolean((blog as any).published_at),
                      });
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-white border border-white/10 hover:bg-accent hover:text-white transition-all cursor-pointer active:scale-95 shadow-lg"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  
                  <button
                    type="button"
                    aria-label="Delete"
                    onClick={() => setDeleteConfirmId(blog.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-white border border-white/10 hover:bg-danger hover:text-white transition-all cursor-pointer active:scale-95 shadow-lg"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Text Info */}
              <div className="flex flex-col gap-1.5 p-1 min-w-0 flex-1">
                <h3 className="truncate text-sm font-bold text-foreground group-hover:text-accent transition-colors leading-snug">
                  {blog.title}
                </h3>
                
                {blog.excerpt && (
                  <p className="truncate text-xs text-muted-foreground/85 leading-normal line-clamp-2 h-8 whitespace-normal overflow-hidden text-ellipsis">
                    {blog.excerpt}
                  </p>
                )}

                <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground/60 mt-auto pt-1">
                  <span className="font-semibold">
                    {displayDate}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {filteredBlogs.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground border border-dashed border-border/50 rounded-3xl bg-surface/10 col-span-full">
            {t("admin.noPosts")}
          </p>
        ) : null}
      </div>

      {/* Confirmation Modal */}
      {showConfirmClose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative overflow-hidden rounded-3xl border border-border dark:border-border/50 bg-surface/95 p-6 shadow-2xl max-w-sm w-full flex flex-col gap-4 text-center">
            <div className="absolute -right-16 -top-16 h-36 w-36 rounded-full bg-accent/5 blur-3xl pointer-events-none" />
            
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setShowConfirmClose(false)}
              className="absolute top-4 right-4 rounded-full p-1.5 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-foreground transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>

            <h3 className="text-lg font-black text-foreground">{t("admin.unsavedChanges")}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("admin.unsavedWarning")}
            </p>

            <div className="flex flex-col gap-2 mt-2">
              <button
                type="button"
                onClick={() => {
                  setShowConfirmClose(false);
                  if (formRef.current) {
                    const input = document.createElement("input");
                    input.type = "hidden";
                    input.name = "action";
                    input.value = "draft";
                    formRef.current.appendChild(input);
                    formRef.current.requestSubmit();
                  }
                }}
                className="w-full h-11 rounded-xl bg-accent text-white font-bold text-sm hover:bg-accent/90 transition-all"
              >
                {t("admin.saveDraft")}
              </button>
              
              <button
                type="button"
                onClick={() => {
                  setShowConfirmClose(false);
                  setEditing(null);
                }}
                className="w-full h-11 rounded-xl border border-danger/25 bg-danger/5 text-danger font-semibold text-sm hover:bg-danger hover:text-white transition-all"
              >
                {t("admin.discard")}
              </button>

              <button
                type="button"
                onClick={() => setShowConfirmClose(false)}
                className="w-full h-11 rounded-xl border border-border/50 bg-surface/90 text-foreground font-semibold text-sm hover:bg-surface/80 transition-all"
              >
                {t("admin.keepEditing")}
              </button>
            </div>
          </div>
        </div>
      )}

      <DeleteConfirmModal
        isOpen={Boolean(deleteConfirmId)}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => handleDelete(deleteConfirmId!)}
        title={locale === "bn" ? "ব্লগ পোস্ট মুছে ফেলুন" : "Delete Blog Post"}
        description={t("admin.deleteConfirm")}
        isPending={isPending}
        cancelText={t("common.cancel")}
        confirmText={t("common.confirm")}
        loadingText={t("common.loading")}
      />
    </div>
  );
}
