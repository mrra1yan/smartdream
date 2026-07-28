"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { requireStaff } from "@/lib/auth";

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
    const { data: existing } = await supabase
      .from("blogs")
      .select("*")
      .eq("id", id)
      .single();

    if (!existing) return { error: "Not found" };

    let pubAt = (existing as any).published_at;
    if (isPublished && !pubAt) pubAt = new Date().toISOString();
    else if (!isPublished) pubAt = null;

    const { error } = await supabase
      .from("blogs")
      .update({
        title: parsed.data.title,
        slug: parsed.data.slug,
        excerpt: parsed.data.excerpt ?? null,
        content: parsed.data.content ?? null,
        hero_image: parsed.data.heroImage || null,
        published_at: pubAt,
      })
      .eq("id", id);

    if (error) {
      return { error: "Failed to update blog" };
    }
  } else {
    const { error } = await supabase.from("blogs").insert({
      id: globalThis.crypto.randomUUID(),
      title: parsed.data.title,
      slug: parsed.data.slug,
      excerpt: parsed.data.excerpt ?? null,
      content: parsed.data.content ?? null,
      hero_image: parsed.data.heroImage || null,
      published_at: isPublished ? new Date().toISOString() : null,
      created_by: staff.id,
      created_at: new Date().toISOString(),
    });

    if (error) {
      return { error: "Failed to create blog" };
    }
  }

  // revalidatePath only clears Next.js's route-level render cache; the
  // underlying getBlogs()/getBlogBySlug() data is cached separately via
  // unstable_cache (see src/lib/blog.ts) and needs its own invalidation so
  // a just-published/edited post doesn't wait out the 5-minute data-cache
  // TTL on top of this.
  revalidateTag("blogs");
  revalidatePath("/blog");
  revalidatePath("/admin/blog");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteBlog(id: string) {
  await requireStaff();
  const { error } = await supabase.from("blogs").delete().eq("id", id);

  if (error) {
    console.error("deleteBlog error:", error);
  }

  revalidateTag("blogs");
  revalidatePath("/blog");
  revalidatePath("/admin/blog");
  revalidatePath("/");
}
