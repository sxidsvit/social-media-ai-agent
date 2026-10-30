import { redirect } from "next/navigation";
import { listPosts, listUnscheduledDrafts } from "@/lib/posts/store";
import { getRequestScope } from "@/lib/request-scope";
import { PostsBoard } from "@/components/posts/posts-board";

export const metadata = { title: "Posts" };

// Shell (sidebar, header, auth + campaign guards) lives in ../layout.tsx
export default async function PostsPage() {
  const scope = await getRequestScope();
  if (!scope) redirect("/sign-in");

  const [posts, drafts] = await Promise.all([listPosts(scope), listUnscheduledDrafts(scope)]);
  return <PostsBoard posts={posts} drafts={drafts} />;
}
