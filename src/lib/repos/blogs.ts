import "server-only";
import { pool, toIso } from "@/lib/db";

/** blogs table repository. */

export type BlogRow = {
  id: string;
  title: string | null;
  slug: string | null;
  excerpt: string | null;
  content: string | null;
  hero_image: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
};

/** Public-facing Blog type (mirrors BlogRow with non-null title/slug). */
export type Blog = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string | null;
  hero_image: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
};

export function mapBlogRow(row: Record<string, unknown>): BlogRow {
  return {
    id: String(row.id),
    title: (row.title as string | null) ?? null,
    slug: (row.slug as string | null) ?? null,
    excerpt: (row.excerpt as string | null) ?? null,
    content: (row.content as string | null) ?? null,
    hero_image: (row.hero_image as string | null) ?? null,
    published_at: toIso(row.published_at),
    created_by: (row.created_by as string | null) ?? null,
    created_at: toIso(row.created_at) ?? "",
  };
}

/** Public published blogs, newest first (blog.ts getBlogs). */
export async function listPublishedBlogs(): Promise<BlogRow[]> {
  const [rows] = await pool.query(
    `SELECT id, title, slug, excerpt, hero_image, published_at
     FROM blogs
     WHERE published_at IS NOT NULL AND published_at <= NOW(6)
     ORDER BY published_at DESC`,
  );
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    title: (r.title as string | null) ?? null,
    slug: (r.slug as string | null) ?? null,
    excerpt: (r.excerpt as string | null) ?? null,
    hero_image: (r.hero_image as string | null) ?? null,
    published_at: toIso(r.published_at),
    created_by: null,
    created_at: "",
    content: null,
  }));
}

export async function getBlogBySlug(slug: string): Promise<BlogRow | null> {
  const [rows] = await pool.query(
    "SELECT * FROM blogs WHERE slug = ? LIMIT 1",
    [slug],
  );
  const row = (rows as Record<string, unknown>[])[0];
  return row ? mapBlogRow(row) : null;
}

export async function getBlogById(id: string): Promise<BlogRow | null> {
  const [rows] = await pool.query(
    "SELECT * FROM blogs WHERE id = ? LIMIT 1",
    [id],
  );
  const row = (rows as Record<string, unknown>[])[0];
  return row ? mapBlogRow(row) : null;
}

/** All blogs (published + draft), admin management. */
export async function listAllBlogs(): Promise<BlogRow[]> {
  const [rows] = await pool.query("SELECT * FROM blogs ORDER BY created_at DESC");
  return (rows as Record<string, unknown>[]).map(mapBlogRow);
}

export async function insertBlog(data: {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string | null;
  hero_image: string | null;
  published_at: string | null;
  created_by: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO blogs (id, title, slug, excerpt, content, hero_image, published_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      data.title,
      data.slug,
      data.excerpt ?? null,
      data.content ?? null,
      data.hero_image ?? null,
      data.published_at ?? null,
      data.created_by ?? null,
    ],
  );
}

export type BlogPatch = {
  title?: string;
  slug?: string;
  excerpt?: string | null;
  content?: string | null;
  hero_image?: string | null;
  published_at?: string | null;
};

export async function updateBlog(id: string, patch: BlogPatch): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    sets.push(`${key} = ?`);
    params.push(value ?? null);
  }
  if (sets.length === 0) return;
  await pool.query(`UPDATE blogs SET ${sets.join(", ")} WHERE id = ?`, [
    ...params,
    id,
  ]);
}

export async function deleteBlog(id: string): Promise<void> {
  await pool.query("DELETE FROM blogs WHERE id = ?", [id]);
}

/** Nulls out created_by for all blogs written by a deleted user (admin.ts). */
export async function nullOutBlogCreator(userId: string): Promise<void> {
  await pool.query("UPDATE blogs SET created_by = NULL WHERE created_by = ?", [userId]);
}
