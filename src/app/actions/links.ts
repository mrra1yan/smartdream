"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { MAX_LINKS_PER_USER } from "@/lib/types";

const UrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((v) => v.startsWith("http://") || v.startsWith("https://"), {
    message: "URL must start with http:// or https://",
  });

export type LinkFormState = { error?: string; ok?: boolean } | undefined;

export type BulkAddResult = { added: number; skipped: number; error?: string };
export type BulkDeleteResult = { deleted: number; error?: string };

// Soft-delete marker: negative seconds since epoch. Stays within PostgreSQL
// `integer` range and is bigint-safe after migration.
function deletedSortOrder(): number {
  return -Math.floor(Date.now() / 1000);
}

export async function addLink(_state: LinkFormState, formData: FormData) {
  const user = await getCurrentUser();
  if (!user || user.status !== "approved") return { error: "Not authenticated." };
  if (user.role !== "user") return { error: "Only regular users can perform this action." };

  const parsed = UrlSchema.safeParse(String(formData.get("url") ?? "").trim());
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const id = globalThis.crypto.randomUUID();

  // Atomic count-check-and-insert (one RPC call = one transaction, serialized
  // per-user via an advisory lock) instead of a separate SELECT count then
  // INSERT — the old two-step version let two concurrent addLink calls both
  // pass the quota check before either insert committed.
  const { data: inserted, error } = await supabase.rpc("add_links_atomic", {
    p_user_id: user.id,
    p_rows: [{ id, url: parsed.data }],
    p_max_links: MAX_LINKS_PER_USER,
  });

  if (error || !inserted) {
    return { error: `You can only add up to ${MAX_LINKS_PER_USER} links.` };
  }

  revalidatePath("/links");
  return { ok: true };
}

export async function updateLink(
  linkId: string,
  _state: LinkFormState,
  formData: FormData,
) {
  const user = await getCurrentUser();
  if (!user || user.status !== "approved") return { error: "Not authenticated." };
  if (user.role !== "user") return { error: "Only regular users can perform this action." };

  const parsed = UrlSchema.safeParse(String(formData.get("url") ?? "").trim());
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { error } = await supabase
    .from("links")
    .update({ url: parsed.data })
    .eq("id", linkId)
    .eq("user_id", user.id);

  if (error) {
    return { error: "Failed to update link" };
  }

  revalidatePath("/links");
  return { ok: true };
}

export async function deleteLink(linkId: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "user" || user.status !== "approved") return;

  // Soft-delete: mark with a negative sort_order so it's excluded by `>= 0`
  // filters. Use seconds (not ms) so the value stays within PostgreSQL's
  // `integer` range (max ~2.1B). bigint-safe too once migrated.
  const { error } = await supabase
    .from("links")
    .update({ url: "https://deleted.local", sort_order: deletedSortOrder() })
    .eq("id", linkId)
    .eq("user_id", user.id);

  if (error) {
    console.error("deleteLink error:", error);
  }

  revalidatePath("/links");
}

// Bulk add multiple links. Partial-add semantics: respects MAX_LINKS_PER_USER
// and adds as many as the remaining quota allows, skipping the rest.
export async function addLinks(urls: string[]): Promise<BulkAddResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "approved") return { added: 0, skipped: 0, error: "Not authenticated." };
  if (user.role !== "user") return { added: 0, skipped: 0, error: "Only regular users can perform this action." };

  // Normalize: trim, drop empties, dedupe (preserve order), validate each.
  const seen = new Set<string>();
  const valid: string[] = [];
  let invalid = 0;
  for (const raw of urls) {
    const parsed = UrlSchema.safeParse(String(raw ?? "").trim());
    if (!parsed.success) {
      invalid++;
      continue;
    }
    if (seen.has(parsed.data)) continue;
    seen.add(parsed.data);
    valid.push(parsed.data);
  }
  if (valid.length === 0) {
    return { added: 0, skipped: invalid, error: invalid > 0 ? "No valid URLs provided." : undefined };
  }

  // Atomic count-check-and-insert, same RPC as addLink — pass every valid
  // URL and let the DB-side advisory lock + count decide how many actually
  // fit, instead of pre-slicing here against a racy outer SELECT count.
  const rows = valid.map((url) => ({ id: globalThis.crypto.randomUUID(), url }));

  const { data: insertedCount, error } = await supabase.rpc("add_links_atomic", {
    p_user_id: user.id,
    p_rows: rows,
    p_max_links: MAX_LINKS_PER_USER,
  });

  if (error) {
    return { added: 0, skipped: valid.length + invalid, error: "Failed to add links." };
  }

  const added = insertedCount ?? 0;
  const skippedByQuota = valid.length - added;
  if (added > 0) revalidatePath("/links");
  return {
    added,
    skipped: skippedByQuota + invalid,
    error: added === 0 && valid.length > 0 ? `You can only add up to ${MAX_LINKS_PER_USER} links.` : undefined,
  };
}

// Bulk delete multiple links by id. Soft-deletes each; counts how many rows
// were actually updated.
export async function deleteLinks(linkIds: string[]): Promise<BulkDeleteResult> {
  const user = await getCurrentUser();
  if (!user || user.role !== "user" || user.status !== "approved") {
    return { deleted: 0, error: "Not authenticated." };
  }
  if (!linkIds || linkIds.length === 0) {
    return { deleted: 0 };
  }

  const { data, error } = await supabase
    .from("links")
    .update({ url: "https://deleted.local", sort_order: deletedSortOrder() })
    .in("id", linkIds)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    console.error("deleteLinks error:", error);
    return { deleted: 0, error: "Failed to delete links." };
  }

  revalidatePath("/links");
  return { deleted: data ? data.length : 0 };
}
