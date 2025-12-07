"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod/v3";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useRouter, useSearchParams } from "next/navigation";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useCountdown } from "@/hooks/ui/useCountdown";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient, signOut } from "@/lib/auth/client";

const schema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  code: z.string().min(6, "Enter the 6-digit code").optional(),
});

type FormValues = z.infer<typeof schema>;

type Props = { serverEmail?: string }

export const EmailOtpView = ({ serverEmail }: Props) => {
  const router = useRouter();
  const params = useSearchParams();

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    watch,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), mode: "onSubmit" });
  const codeValue = watch("code") || "";
  const [isPending, startTransition] = useTransition();

  const {
    canResend,
    label: resendLabel,
    start: startCountdown,
  } = useCountdown(120, true);
  useEffect(() => {
    startCountdown()
  }, [startCountdown])

  const sendCode = useCallback(
    async (values: { email: string }, opts?: { silentSuccess?: boolean }) => {
      try {
        await authClient.emailOtp.sendVerificationOtp({
          email: values.email,
          type: "sign-in",
        });
        startCountdown();
        if (!opts?.silentSuccess) toast.success("Verification code sent");
      } catch {
        toast.error("Failed to send verification code");
      }
    },
    [startCountdown]
  );

  const sessionRes = authClient.useSession()
  const sessionEmail = sessionRes.data?.user?.email
  const sessionLoading = sessionRes.isPending

  const qEmail = params.get("email") || undefined
  const effectiveEmail = serverEmail || sessionEmail || qEmail

  const [hasPrimed, setHasPrimed] = useState(false)

  useEffect(() => {
    if (!effectiveEmail || hasPrimed) return
    setValue("email", effectiveEmail, { shouldDirty: false, shouldTouch: false })
    void sendCode({ email: effectiveEmail }, { silentSuccess: true })
    setHasPrimed(true)
  }, [effectiveEmail, hasPrimed, setValue, sendCode])

  const verifyCode = useCallback(
    async (values: { email: string; code: string }) => {
      try {
        await authClient.emailOtp.checkVerificationOtp({
          email: values.email,
          otp: values.code,
          type: "sign-in",
        });
        toast.success("Email verified and signed in");
        router.replace("/");
      } catch {
        toast.error("Invalid or expired code");
      }
    },
    [router]
  );

  const onSubmit = useCallback(
    async (values: FormValues) => {
      await verifyCode({ email: values.email, code: values.code || "" });
    },
    [verifyCode]
  );

  const handleSignOut = useCallback(async () => {
    try {
      await signOut({ router })
    } catch (error) {
      // Error handling is done in signOut function
      console.error("Sign out error:", error)
    }
  }, [router])

  const handleSendCode = useCallback(() => {
    startTransition(() => {
      void sendCode({ email: getValues("email") });
    });
  }, [sendCode, getValues]);

  if (sessionLoading && !effectiveEmail) {
    return (
      <div className="grid min-h-screen grid-cols-1 md:grid-cols-2">
        <div className="flex items-center justify-center p-8">
          <div className="w-full max-w-sm space-y-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-5/6" />
            <div className="flex justify-center gap-3">
              <Skeleton className="h-12 w-12" />
              <Skeleton className="h-12 w-12" />
              <Skeleton className="h-12 w-12" />
              <Skeleton className="h-12 w-12" />
              <Skeleton className="h-12 w-12" />
              <Skeleton className="h-12 w-12" />
            </div>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
        <div className="hidden md:block bg-muted" />
      </div>
    )
  }

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Verify your email</h1>
            <p className="text-sm text-muted-foreground">
              {effectiveEmail ? `Enter the code sent to ${effectiveEmail}` : "Enter the 6-digit code"}
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            {false && (
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="you@example.com" aria-invalid={!!errors.email} {...register("email")} />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="code">Code</Label>
              <Controller
                control={control}
                name="code"
                render={({ field }) => (
                  <div className="flex justify-center">
                    <InputOTP
                      maxLength={6}
                      value={field.value ?? ""}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      onChange={(v: string) => {
                        const digits = (v || "").replace(/\D/g, "").slice(0, 6)
                        field.onChange(digits)
                        if (digits.length === 6 && !isSubmitting) {
                          const email = effectiveEmail || getValues('email')
                          
                          // Validate email is present and valid
                          if (!email || !email.trim()) {
                            setError('email', {
                              type: 'manual',
                              message: 'Email is required'
                            })
                            return
                          }
                          
                          // Simple email validation regex
                          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                          if (!emailRegex.test(email.trim())) {
                            setError('email', {
                              type: 'manual',
                              message: 'Invalid email address'
                            })
                            return
                          }
                          
                          void onSubmit({ email: email.trim(), code: digits } as FormValues)
                        }
                      }}
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} autoFocus />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                      </InputOTPGroup>
                      <InputOTPSeparator />
                      <InputOTPGroup>
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                )}
              />
              {errors.code?.message && (
                <p className="text-xs text-destructive">
                  {errors.code.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                disabled={isSubmitting || codeValue.length !== 6}
                className="w-full"
              >
                Verify
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!canResend || isSubmitting || isPending}
                onClick={handleSendCode}
                className="w-full"
              >
                {resendLabel}
              </Button>
              <div className="text-center">
                <button
                  type="button"
                  aria-label="Sign out"
                  onClick={handleSignOut}
                  className="text-sm text-foreground underline underline-offset-4"
                >
                  Sign out
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
      <div className="hidden md:block bg-muted" />
    </div>
  );
};
