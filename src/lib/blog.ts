import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { supabase, Blog } from "@/lib/supabase";

export { type Blog } from "@/lib/supabase";

// unstable_cache (not just React's cache() below) because both /blog and
// /blog/[slug] live under (main)/layout.tsx, which calls requireUser() --
// reading the session cookie forces the whole route to render dynamically
// on every request, so a plain `export const revalidate` on the page has no
// effect (Next.js bypasses route-level ISR once any dynamic API is used in
// the tree). unstable_cache instead caches the data fetch itself, which
// works regardless of how the route renders. Blog posts change rarely, so
// a 5-minute cache trades a small publish-to-visible delay for cutting
// Supabase reads on every single blog page visit.
const BLOG_CACHE_REVALIDATE_SECONDS = 300;

/** Public published blogs, newest first. */
export const getBlogs = cache(
  unstable_cache(
    async (): Promise<Blog[]> => {
      const { data, error } = await supabase
        .from("blogs")
        .select("id, title, slug, excerpt, hero_image, published_at")
        .not("published_at", "is", null)
        .lte("published_at", new Date().toISOString())
        .order("published_at", { ascending: false });

      if (error || !data) return [];
      return data as Blog[];
    },
    ["blogs-list"],
    { revalidate: BLOG_CACHE_REVALIDATE_SECONDS, tags: ["blogs"] },
  ),
);

export const getBlogBySlug = cache(
  unstable_cache(
    async (slug: string): Promise<Blog | null> => {
      const { data, error } = await supabase
        .from("blogs")
        .select("*")
        .eq("slug", slug)
        .single();

      if (error || !data) return null;
      const row = data as Blog;
      // Matches getBlogs' `.lte("published_at", now)` filter -- without this,
      // a post with a future published_at (not reachable via the current
      // admin CMS form, which always writes "now" on publish, but possible via
      // a direct DB edit or a future scheduled-publish feature) would stay
      // correctly hidden from the /blog list yet still be readable by anyone
      // who knows/guesses its slug.
      if (!row.published_at || new Date(row.published_at) > new Date()) return null;
      return row;
    },
    ["blog-by-slug"],
    { revalidate: BLOG_CACHE_REVALIDATE_SECONDS, tags: ["blogs"] },
  ),
);

/** All blogs (published + draft), for admin management. */
export const getAdminBlogs = cache(async (): Promise<Blog[]> => {
  const { data, error } = await supabase
    .from("blogs")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data as Blog[];
});

export const getBlogById = cache(
  async (id: string): Promise<Blog | null> => {
    const { data, error } = await supabase
      .from("blogs")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return null;
    return data as Blog;
  },
);
