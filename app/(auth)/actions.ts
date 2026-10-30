"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAuthActions, createServerClient } from "@insforge/sdk/ssr";
import { saveUser } from "@/lib/users";
import { getHomePath } from "@/lib/campaigns";

export type AuthState = {
  error?: string;
  // Set when the user must enter the 6-digit code sent to this email
  verifyEmail?: string;
  name?: string;
};

async function getAuth() {
  return createAuthActions({ cookies: await cookies() });
}

async function getAppUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${h.get("host")}`;
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Email and password are required." };

  const auth = await getAuth();
  const { data, error } = await auth.signUp({ email, password, name });
  if (error || !data) return { error: error?.message ?? "Sign up failed." };

  if (data.requireEmailVerification) return { verifyEmail: email, name };

  if (!data.user) redirect("/dashboard");
  await saveUser(data.user, name);
  redirect(await getHomePath(data.user.id));
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Email and password are required." };

  const auth = await getAuth();
  const { data, error } = await auth.signInWithPassword({ email, password });

  if (error?.statusCode === 403) {
    // Email not verified yet — send a fresh code and show the verification step
    await resendVerificationCode(email);
    return { verifyEmail: email };
  }
  if (error || !data?.user) return { error: error?.message ?? "Invalid email or password." };

  await saveUser(data.user);
  redirect(await getHomePath(data.user.id));
}

export async function verifyEmail(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const name = String(formData.get("name") ?? "") || undefined;
  const otp = String(formData.get("otp") ?? "");

  if (otp.length !== 6) return { verifyEmail: email, name, error: "Enter the 6-digit code." };

  const auth = await getAuth();
  const { data, error } = await auth.verifyEmail({ email, otp });
  if (error || !data?.user) {
    return { verifyEmail: email, name, error: error?.message ?? "Invalid or expired code." };
  }

  await saveUser(data.user, name);
  redirect(await getHomePath(data.user.id));
}

export async function resendVerificationCode(email: string) {
  const insforge = createServerClient({ cookies: await cookies() });
  const { error } = await insforge.auth.resendVerificationEmail({ email });
  return { error: error?.message };
}

export async function signInWithGoogle() {
  const cookieStore = await cookies();
  const auth = createAuthActions({ cookies: cookieStore });
  const { data, error } = await auth.signInWithOAuth("google", {
    redirectTo: new URL("/api/auth/callback", await getAppUrl()).toString(),
    skipBrowserRedirect: true,
  });

  if (error || !data?.url || !data.codeVerifier) {
    redirect("/sign-in?error=oauth_failed");
  }

  cookieStore.set("insforge_code_verifier", data.codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  redirect(data.url);
}

export async function signOut() {
  const auth = await getAuth();
  await auth.signOut();
  redirect("/sign-in");
}
