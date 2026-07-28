import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { getBlogBySlug } from "@/lib/blog";

type Props = { params: Promise<{ slug: string }> };

// Note: this route renders dynamically on every request regardless (the
// parent (main)/layout.tsx calls requireUser(), which reads the session
// cookie), so a route-level `revalidate` export here would be a no-op.
// getBlogBySlug() itself is cached instead -- see src/lib/blog.ts.

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const blog = await getBlogBySlug(slug);
  return { title: blog ? `${blog.title} | Smart Dream` : "Blog | Smart Dream" };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const blog = await getBlogBySlug(slug);
  if (!blog) notFound();

  return (
    <article className="flex flex-col gap-6 py-2 w-full">
      {/* Back button */}
      <div className="flex items-center gap-4">
        <Link
          href="/blog"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/50 bg-surface/60 text-muted-foreground hover:text-foreground transition-all shadow-sm cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="text-lg sm:text-xl font-extrabold text-foreground line-clamp-1">
          {blog.title}
        </span>
      </div>

      {(blog as any).hero_image && (
        <div className="relative w-full h-52 sm:h-72 overflow-hidden rounded-3xl border border-border/20 shadow-lg">
          <Image
            src={(blog as any).hero_image}
            alt={blog.title}
            fill
            className="object-cover"
          />
        </div>
      )}

      {/* Header Info */}
      <div className="space-y-3">
        <span className="block text-[10px] font-bold uppercase text-muted-foreground/60 leading-[2em]">
          {(blog as any).published_at
            ? new Date((blog as any).published_at).toLocaleDateString()
            : ""}
        </span>
        <h1 className="text-2xl font-black text-foreground sm:text-3xl">
          {blog.title}
        </h1>
        {blog.excerpt && (
          <p className="text-sm sm:text-base leading-relaxed text-muted-foreground/80">
            {blog.excerpt}
          </p>
        )}
      </div>

      {/* Body Content */}
      {blog.content && (
        <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap leading-relaxed text-muted-foreground/95 border-t border-border/20 pt-6">
          {blog.content}
        </div>
      )}
    </article>
  );
}
