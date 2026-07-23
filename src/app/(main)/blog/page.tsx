import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getBlogs } from "@/lib/blog";
import { getI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Blog | Smart Dream" };

export default async function BlogPage() {
  const { t } = await getI18n();
  const blogs = await getBlogs();

  return (
    <div className="flex flex-col gap-8 py-2 w-full">
      {/* Page Header */}
      <PageHeader
        badge={t("blog.badge")}
        title={t("nav.blog")}
        description={t("blog.description")}
      />

      {/* Blogs List */}
      {blogs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-3xl border border-dashed border-border/60 bg-surface/10">
          <p className="text-sm font-bold text-muted-foreground/80">
            {t("blog.noPosts")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {blogs.map((blog) => (
            <Link key={blog.id} href={`/blog/${blog.slug}`} className="group flex">
              <div className="relative overflow-hidden rounded-3xl border border-border/40 bg-surface/90 hover:bg-surface/50 p-5 shadow-lg transition-all duration-300 hover:border-accent/40 hover:shadow-xl w-full flex flex-col justify-between">
                {/* Glow Overlay */}
                <div className="absolute inset-0 bg-gradient-to-b from-accent/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                
                <div className="space-y-4">
                  {(blog as any).hero_image && (
                    <div className="relative w-full h-44 overflow-hidden rounded-2xl border border-border/20">
                      <Image
                        src={(blog as any).hero_image}
                        alt={blog.title}
                        fill
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <span className="block text-[10px] font-bold uppercase text-muted-foreground/60">
                      {(blog as any).published_at
                        ? new Date((blog as any).published_at).toLocaleDateString()
                        : ""}
                    </span>
                    <h2 className="text-lg font-extrabold text-foreground group-hover:text-accent transition-colors leading-snug">
                      {blog.title}
                    </h2>
                    {blog.excerpt && (
                      <p className="text-xs sm:text-sm text-muted-foreground/90 leading-relaxed line-clamp-3">
                        {blog.excerpt}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
