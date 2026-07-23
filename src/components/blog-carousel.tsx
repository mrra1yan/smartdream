"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type CarouselBlog = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  heroImage: string | null;
};

export function BlogCarousel({ blogs }: { blogs: CarouselBlog[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  if (blogs.length === 0) return null;

  function scrollTo(i: number) {
    const el = scroller.current;
    if (!el) return;
    const next = Math.max(0, Math.min(blogs.length - 1, i));
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    setActive(next);
  }

  return (
    <div className="relative">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          setActive(Math.round(el.scrollLeft / el.clientWidth));
        }}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto scroll-smooth"
      >
        {blogs.map((blog) => (
          <Link
            key={blog.id}
            href={`/blog/${blog.slug}`}
            className="relative block w-full shrink-0 snap-center"
          >
            <div className="relative h-44 w-full overflow-hidden rounded-2xl bg-zinc-200 dark:bg-zinc-800 sm:h-56">
              {blog.heroImage ? (
                <Image
                  src={blog.heroImage}
                  alt={blog.title}
                  fill
                  className="object-cover"
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                <h2 className="text-lg font-bold leading-tight line-clamp-2">
                  {blog.title}
                </h2>
                {blog.excerpt ? (
                  <p className="mt-1 text-xs text-white/80 line-clamp-2">
                    {blog.excerpt}
                  </p>
                ) : null}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {blogs.length > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous"
            onClick={() => scrollTo(active - 1)}
            className="absolute left-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next"
            onClick={() => scrollTo(active + 1)}
            className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="mt-2 flex justify-center gap-1.5">
            {blogs.map((b, i) => (
              <button
                key={b.id}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                onClick={() => scrollTo(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === active ? "w-6 bg-foreground" : "w-1.5 bg-muted/50",
                )}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
