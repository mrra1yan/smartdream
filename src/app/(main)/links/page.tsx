import { getCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { MAX_LINKS_PER_USER } from "@/lib/types";
import { LinksManager, type LinkItem } from "@/components/links-manager";
import { addLink, updateLink, deleteLink, addLinks, deleteLinks } from "@/app/actions/links";

export default async function LinksPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data } = await supabase
    .from("links")
    .select("id, url, likes_count")
    .eq("user_id", user.id)
    .gte("sort_order", 0)
    .order("sort_order", { ascending: true });

  const rows = data ?? [];
  const links: LinkItem[] = rows.map((r: any) => ({
    id: r.id,
    url: r.url,
    likesCount: r.likes_count,
  }));

  return (
    <LinksManager
      links={links}
      userId={user.id}
      canAdd={links.length < MAX_LINKS_PER_USER}
      addActionHandler={addLink}
      updateActionHandler={updateLink}
      deleteActionHandler={deleteLink}
      bulkAddActionHandler={addLinks}
      bulkDeleteActionHandler={deleteLinks}
    />
  );
}
