import { NextResponse, type NextRequest } from "next/server";
import { createAuthActions } from "@insforge/sdk/ssr";
import { saveUser } from "@/lib/users";
import { getHomePath } from "@/lib/campaigns";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("insforge_code");
  const oauthError = request.nextUrl.searchParams.get("error");
  const codeVerifier = request.cookies.get("insforge_code_verifier")?.value;

  if (oauthError || !code || !codeVerifier) {
    return NextResponse.redirect(new URL("/sign-in?error=oauth_failed", request.url));
  }

  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  const auth = createAuthActions({
    requestCookies: request.cookies,
    responseCookies: response.cookies,
  });

  const { data, error } = await auth.exchangeOAuthCode(code, codeVerifier);
  if (error || !data?.user) {
    console.error("OAuth code exchange failed", error);
    return NextResponse.redirect(new URL("/sign-in?error=oauth_failed", request.url));
  }

  await saveUser(data.user);
  response.headers.set("Location", new URL(await getHomePath(data.user.id), request.url).toString());
  response.cookies.delete("insforge_code_verifier");
  return response;
}
