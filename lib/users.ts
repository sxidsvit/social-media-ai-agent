import { db, users } from "@/db";

type AuthUser = {
  id: string;
  email: string;
  profile?: { name?: string; avatar_url?: string } | null;
};

// Saves the user to our database the first time they authenticate.
// Subsequent sign-ins are no-ops thanks to the unique user_id / email constraints.
export async function saveUser(user: AuthUser, name?: string) {
  await db
    .insert(users)
    .values({
      userId: user.id,
      email: user.email,
      name: name || user.profile?.name || null,
      imageUrl: user.profile?.avatar_url || null,
    })
    .onConflictDoNothing();
}
