import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import type { Blog } from "@/lib/repos/blogs";
import {
  getBlogById as repoGetBlogById,
  getBlogBySlug as repoGetBlogBySlug,
  listAllBlogs as repoListAllBlogs,
  listPublishedBlogs as repoListPublishedBlogs,
  type BlogRow,
} from "@/lib/repos/blogs";

export type { Blog } from "@/lib/repos/blogs";

// unstable_cache (not just React's cache() below) because both /blog and
// /blog/[slug] live under (main)/layout.tsx, which calls requireUser() —
// reading the session cookie forces the whole route to render dynamically.
// Blog posts change rarely; 5-minute cache trades a small publish delay for
// cutting DB reads on every blog page visit.
const BLOG_CACHE_REVALIDATE_SECONDS = 300;

function toBlog(row: BlogRow): Blog {
  return {
    id: row.id,
    title: row.title ?? "",
    slug: row.slug ?? "",
    excerpt: row.excerpt,
    content: row.content,
    hero_image: row.hero_image,
    published_at: row.published_at,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

/** Public published blogs, newest first. */
export const getBlogs = cache(
  unstable_cache(
    async (): Promise<Blog[]> => {
      const rows = await repoListPublishedBlogs();
      return rows.map(toBlog);
    },
    ["blogs-list"],
    { revalidate: BLOG_CACHE_REVALIDATE_SECONDS, tags: ["blogs"] },
  ),
);

export const getBlogBySlug = cache(
  unstable_cache(
    async (slug: string): Promise<Blog | null> => {
      const row = await repoGetBlogBySlug(slug);
      if (!row) return null;
      // Matches getBlogs' published_at <= now filter — a post with a future
      // published_at stays hidden from the /blog list yet readable by anyone
      // who knows/guesses its slug.
      if (!row.published_at || new Date(row.published_at) > new Date()) return null;
      return toBlog(row);
    },
    ["blog-by-slug"],
    { revalidate: BLOG_CACHE_REVALIDATE_SECONDS, tags: ["blogs"] },
  ),
);

/** All blogs (published + draft), for admin management. */
export const getAdminBlogs = cache(async (): Promise<Blog[]> => {
  const rows = await repoListAllBlogs();
  return rows.map(toBlog);
});

export const getBlogById = cache(
  async (id: string): Promise<Blog | null> => {
    const row = await repoGetBlogById(id);
    return row ? toBlog(row) : null;
  },
);
