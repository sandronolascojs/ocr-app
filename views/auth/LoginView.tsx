"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v3";
import { zodResolver } from "@hookform/resolvers/zod";
import { authClient } from "@/lib/auth/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { BackgroundGradient } from "@/components/ui/background-gradient";

const loginSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export const LoginView = () => {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: "onSubmit",
  });

  async function onSubmit(values: LoginFormValues) {
      await authClient.signIn.email({
        email: values.email,
        password: values.password,
      }, {
        onSuccess: () => {
          toast.success("Signed in successfully");
          router.replace("/");
        },
        onError: (error) => {
          if (error.error.message.includes("Email not verified")) {
            return router.replace("/email-otp");
          }
          if (error.error.message.includes("Invalid email or password")) {
            toast.error("Invalid email or password");
          } else {
            toast.error("Sign in failed");
          }
        },
      });
  }

  function signInWithGoogle() {
    startTransition(async () => {
      await authClient.signIn.social(
        {
          provider: "google",
          callbackURL: `${window.location.origin}/`,
        },
        {
          onError: () => {
            toast.error("Sign in failed");
          },
        }
      );
    });
  }

  

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <div className="text-xl font-semibold">OCR STUDIO</div>
            <h1 className="text-2xl font-semibold tracking-tight">Sign in to OCR Studio</h1>
            <p className="text-sm text-muted-foreground">Welcome back. Please sign in to continue.</p>
          </div>

          <div className="space-y-2">
            <Button type="button" variant="outline" className="w-full" onClick={signInWithGoogle} disabled={isPending}>
              Google
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-2">
              <Label className="text-sm font-medium" htmlFor="email">Email address</Label>
              <Input id="email" type="email" placeholder="you@example.com" aria-invalid={!!errors.email} {...register("email")} />
              {errors.email?.message && (<p className="text-xs text-destructive">{errors.email.message}</p>)}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium" htmlFor="password">Password</Label>
              <Input id="password" type="password" placeholder="••••••••" aria-invalid={!!errors.password} {...register("password")} />
              {errors.password?.message && (<p className="text-xs text-destructive">{errors.password.message}</p>)}
            </div>

            <Button type="submit" disabled={isSubmitting} className="w-full">Continue</Button>
          </form>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <Link href="/sign-up" className="hover:underline">Don’t have an account? Sign up</Link>
            <Link href="/reset-password" className="hover:underline">Forgot password?</Link>
          </div>
        </div>
      </div>
      <div className="relative hidden md:block overflow-hidden">
        <BackgroundGradient asOverlay variant="redCorners" noise="medium" />
      </div>
    </div>
  );
};
