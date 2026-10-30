"use server";

import { revalidatePath } from "next/cache";
import { reschedulePostForScope, savePostForScope, unschedulePostForScope } from "@/lib/posts/save";
import type { PostInput } from "@/lib/posts/shared";
import { getRequestScope } from "@/lib/request-scope";

export type SavePostResult = { error?: string; postId?: number };

// Saves a post from the editor: "schedule" schedules it in the user's Blotato calendar, "draft" keeps
// it to finish another time. With postId it edits (and reschedules) that post. See lib/posts/save.ts.
export async function savePost(input: PostInput, intent: "schedule" | "draft"): Promise<SavePostResult> {
  const scope = await getRequestScope();
  if (!scope) return { error: "Please sign in again." };
  const result = await savePostForScope(scope, input, intent);
  // A failed reschedule can turn the post back into a draft, so the pages are refreshed either way
  revalidatePath("/dashboard", "layout");
  return result.post ? { postId: result.post.id } : { error: result.error };
}

// Takes a scheduled post off the schedule, here and in the user's Blotato calendar (it stays on the
// Posts page as a draft)
export async function unschedulePost(postId: number): Promise<SavePostResult> {
  const scope = await getRequestScope();
  if (!scope) return { error: "Please sign in again." };
  const result = await unschedulePostForScope(scope, postId);
  if (result.error) return { error: result.error };
  revalidatePath("/dashboard", "layout");
  return { postId };
}

// Moves a post to another moment (ISO time), from the calendar's drag and drop or its quick
// reschedule. A scheduled post is rescheduled in Blotato too.
export async function reschedulePost(postId: number, at: string): Promise<SavePostResult> {
  const scope = await getRequestScope();
  if (!scope) return { error: "Please sign in again." };
  const result = await reschedulePostForScope(scope, postId, new Date(at));
  revalidatePath("/dashboard", "layout");
  return result.post ? { postId: result.post.id } : { error: result.error };
}
