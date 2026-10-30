import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@insforge/sdk/ssr/middleware";

const PROTECTED_ROUTES = ["/dashboard", "/create-campaign"];
const AUTH_ROUTES = ["/sign-in", "/sign-up"];

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  const { accessToken } = await updateSession({
    requestCookies: request.cookies,
    responseCookies: response.cookies,
  });

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_ROUTES.some((route) => pathname.startsWith(route));
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route));

  if (isProtected && !accessToken) {
    return redirectWithCookies(request, response, "/sign-in");
  }
  if (isAuthRoute && accessToken) {
    return redirectWithCookies(request, response, "/dashboard");
  }

  return response;
}

// Keep any refreshed/cleared auth cookies when redirecting.
function redirectWithCookies(request: NextRequest, response: NextResponse, path: string) {
  const redirect = NextResponse.redirect(new URL(path, request.url));
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
