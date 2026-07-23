import { requireStaff } from "@/lib/auth";
import { getAdminBlogs } from "@/lib/blog";
import { BlogManager } from "@/components/blog-manager";

import { saveBlog, deleteBlog } from "@/app/actions/blog";

export default async function AdminBlogPage() {
  await requireStaff();
  const blogs = await getAdminBlogs();
  return <BlogManager blogs={blogs} saveActionHandler={saveBlog} deleteActionHandler={deleteBlog} />;
}
