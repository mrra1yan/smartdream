"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { deleteBlog as repoDeleteBlog, getBlogById, insertBlog, updateBlog } from "@/lib/repos/blogs";

const BlogSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/),
  excerpt: z.string().max(500).optional(),
  content: z.string().max(50000).optional(),
  heroImage: z.string().optional(),
  published: z.union([z.literal("on"), z.literal("true"), z.literal("1")]).optional(),
});

export type BlogFormState = { error?: string; ok?: boolean } | undefined;

export async function saveBlog(
  id: string | null,
  _state: BlogFormState,
  formData: FormData,
) {
  const staff = await requireStaff();
  const actionType = formData.get("action");
  const isPublished = actionType === "publish" || formData.get("published") === "on";

  const parsed = BlogSchema.safeParse({
    title: formData.get("title"),
    slug: formData.get("slug"),
    excerpt: formData.get("excerpt"),
    content: formData.get("content"),
    heroImage: formData.get("heroImage"),
    published: isPublished ? "true" : undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  if (id) {
    const existing = await getBlogById(id);
    if (!existing) return { error: "Not found" };

    let pubAt = existing.published_at;
    if (isPublished && !pubAt) pubAt = new Date().toISOString();
    else if (!isPublished) pubAt = null;

    try {
      await updateBlog(id, {
        title: parsed.data.title,
        slug: parsed.data.slug,
        excerpt: parsed.data.excerpt ?? null,
        content: parsed.data.content ?? null,
        hero_image: parsed.data.heroImage || null,
        published_at: pubAt,
      });
    } catch (err) {
      console.error("saveBlog update error:", err);
      return { error: "Failed to update blog" };
    }
  } else {
    try {
      await insertBlog({
        id: globalThis.crypto.randomUUID(),
        title: parsed.data.title,
        slug: parsed.data.slug,
        excerpt: parsed.data.excerpt ?? null,
        content: parsed.data.content ?? null,
        hero_image: parsed.data.heroImage || null,
        published_at: isPublished ? new Date().toISOString() : null,
        created_by: staff.id,
      });
    } catch (err) {
      console.error("saveBlog insert error:", err);
      return { error: "Failed to create blog" };
    }
  }

  // Invalidate the unstable_cache data cache (getBlogs/getBlogBySlug) so a
  // just-published/edited post doesn't wait out the 5-minute TTL.
  revalidateTag("blogs");
  revalidatePath("/blog");
  revalidatePath("/admin/blog");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteBlog(id: string) {
  await requireStaff();
  try {
    await repoDeleteBlog(id);
  } catch (err) {
    console.error("deleteBlog error:", err);
  }

  revalidateTag("blogs");
  revalidatePath("/blog");
  revalidatePath("/admin/blog");
  revalidatePath("/");
}
