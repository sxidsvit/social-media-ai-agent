import { AuthForm } from "@/components/auth/auth-form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <AuthForm
      mode="sign-in"
      initialError={error === "oauth_failed" ? "Google sign-in failed. Please try again." : undefined}
    />
  );
}
