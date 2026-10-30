"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import {
  signIn,
  signUp,
  signInWithGoogle,
  verifyEmail,
  resendVerificationCode,
  type AuthState,
} from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Spinner } from "@/components/ui/spinner";

type Mode = "sign-in" | "sign-up";

const copy = {
  "sign-in": {
    title: "Welcome back",
    description: "Sign in to your account to continue",
    submit: "Sign in",
    footer: "Don't have an account?",
    footerLink: { href: "/sign-up", label: "Sign up" },
  },
  "sign-up": {
    title: "Create an account",
    description: "Get started with your social media AI agent",
    submit: "Create account",
    footer: "Already have an account?",
    footerLink: { href: "/sign-in", label: "Sign in" },
  },
} as const;

export function AuthForm({ mode, initialError }: { mode: Mode; initialError?: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    mode === "sign-in" ? signIn : signUp,
    { error: initialError }
  );

  if (state.verifyEmail) {
    return <VerifyEmailForm email={state.verifyEmail} name={state.name} />;
  }

  const text = copy[mode];

  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{text.title}</h1>
        <p className="text-sm text-muted-foreground">{text.description}</p>
      </div>
      <div>
        <FieldGroup>
          <GoogleButton />
          <FieldSeparator>or continue with email</FieldSeparator>
          <form action={formAction}>
            <FieldGroup>
              {mode === "sign-up" && (
                <Field>
                  <FieldLabel htmlFor="name">Name</FieldLabel>
                  <Input id="name" name="name" autoComplete="name" placeholder="Jane Doe" required className="h-11" />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required className="h-11" />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  minLength={6}
                  placeholder="••••••••"
                  required
                  className="h-11"
                />
              </Field>
              {state.error && <FieldError>{state.error}</FieldError>}
              <Button type="submit" size="lg" disabled={pending} className="h-11 shadow-md shadow-primary/20">
                {pending && <Spinner />}
                {text.submit}
              </Button>
            </FieldGroup>
          </form>
        </FieldGroup>
      </div>
      <p className="text-center text-sm text-muted-foreground">
        {text.footer}&nbsp;
        <Link href={text.footerLink.href} className="font-semibold text-primary underline-offset-4 hover:underline">
          {text.footerLink.label}
        </Link>
      </p>
    </div>
  );
}

function GoogleButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="h-11"
      disabled={pending}
      onClick={() => startTransition(() => signInWithGoogle())}
    >
      {pending ? <Spinner /> : <GoogleIcon />}
      Continue with Google
    </Button>
  );
}

function VerifyEmailForm({ email, name }: { email: string; name?: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(verifyEmail, {});
  const [otp, setOtp] = useState("");
  const [resendMessage, setResendMessage] = useState<string>();
  const [resending, startResend] = useTransition();

  const resend = () =>
    startResend(async () => {
      const { error } = await resendVerificationCode(email);
      setResendMessage(error ?? "A new code has been sent.");
    });

  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-2">
        <span className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <MailCheck className="size-6" />
        </span>
        <h1 className="text-3xl font-semibold tracking-tight">Check your email</h1>
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit code we sent to <span className="font-medium text-foreground">{email}</span>
        </p>
      </div>
      <div>
        <form action={formAction}>
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="name" value={name ?? ""} />
          <input type="hidden" name="otp" value={otp} />
          <FieldGroup>
            <Field>
              <InputOTP maxLength={6} value={otp} onChange={setOtp} autoFocus>
                <InputOTPGroup>
                  {Array.from({ length: 6 }, (_, i) => (
                    <InputOTPSlot key={i} index={i} className="size-12 text-lg" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </Field>
            {state.error && <FieldError>{state.error}</FieldError>}
            <Button type="submit" size="lg" disabled={pending || otp.length !== 6} className="h-11 shadow-md shadow-primary/20">
              {pending && <Spinner />}
              Verify and continue
            </Button>
          </FieldGroup>
        </form>
      </div>
      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        <span>
          Didn&apos;t get a code?{" "}
          <Button variant="link" className="h-auto p-0 font-semibold" onClick={resend} disabled={resending}>
            Resend
          </Button>
        </span>
        {resendMessage && <span>{resendMessage}</span>}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
