"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { MAX_LINKS_PER_USER } from "@/lib/types";
import { addLinksAtomic } from "@/lib/repos/rpc";
import {
  softDeleteLink,
  softDeleteLinks,
  updateLink as repoUpdateLink,
} from "@/lib/repos/links";
import { publishLinksUpdate } from "@/lib/realtime-publish";
import { getUserLinks as repoGetUserLinks } from "@/lib/repos/links";

const UrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((v) => v.startsWith("http://") || v.startsWith("https://"), {
    message: "URL must start with http:// or https://",
  });

export type LinkFormState = { error?: string; ok?: boolean } | undefined;

/** Lightweight refetch for the links-manager SSE handler — returns just the
 *  id → likes_count map so live likes from other users update in place
 *  without clobbering the user's own in-progress edits. */
export async function getMyLinkCounts(): Promise<{ id: string; likesCount: number }[]> {
  const user = await getCurrentUser();
  if (!user || user.status !== "approved") return [];
  const rows = await repoGetUserLinks(user.id);
  return rows.map((r) => ({ id: r.id, likesCount: r.likes_count }));
}

export type BulkAddResult = { added: number; skipped: number; error?: string };
export type BulkDeleteResult = { deleted: number; error?: string };

export async function addLink(_state: LinkFormState, formData: FormData) {
  const user = await getCurrentUser();
  if (!user || user.status !== "approved") return { error: "Not authenticated." };
  if (user.role !== "user") return { error: "Only regular users can perform this action." };

  const parsed = UrlSchema.safeParse(String(formData.get("url") ?? "").trim());
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const id = globalThis.crypto.randomUUID();

  // Atomic count-check-and-insert (one CALL = one stored procedure,
  // serialized per-user via a named lock) — closes the quota race.
  try {
    const inserted = await addLinksAtomic(user.id, [{ id, url: parsed.data }], MAX_LINKS_PER_USER);
    if (!inserted) {
      return { error: `You can only add up to ${MAX_LINKS_PER_USER} links.` };
    }
  } catch (err) {
    console.error("addLink error:", err);
    return { error: `You can only add up to ${MAX_LINKS_PER_USER} links.` };
  }

  await publishLinksUpdate(user.id);
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

  try {
    await repoUpdateLink(linkId, user.id, parsed.data);
  } catch (err) {
    console.error("updateLink error:", err);
    return { error: "Failed to update link" };
  }

  await publishLinksUpdate(user.id);
  revalidatePath("/links");
  return { ok: true };
}

export async function deleteLink(linkId: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "user" || user.status !== "approved") return;

  try {
    await softDeleteLink(linkId, user.id);
  } catch (err) {
    console.error("deleteLink error:", err);
  }

  await publishLinksUpdate(user.id);
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

  // Atomic count-check-and-insert — pass every valid URL and let the DB-side
  // named lock + count decide how many actually fit.
  const rows = valid.map((url) => ({ id: globalThis.crypto.randomUUID(), url }));

  let added: number;
  try {
    added = await addLinksAtomic(user.id, rows, MAX_LINKS_PER_USER);
  } catch (err) {
    console.error("addLinks error:", err);
    return { added: 0, skipped: valid.length + invalid, error: "Failed to add links." };
  }

  const skippedByQuota = valid.length - added;
  if (added > 0) {
    await publishLinksUpdate(user.id);
    revalidatePath("/links");
  }
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

  let deleted: number;
  try {
    deleted = await softDeleteLinks(linkIds, user.id);
  } catch (err) {
    console.error("deleteLinks error:", err);
    return { deleted: 0, error: "Failed to delete links." };
  }

  await publishLinksUpdate(user.id);
  revalidatePath("/links");
  return { deleted };
}
