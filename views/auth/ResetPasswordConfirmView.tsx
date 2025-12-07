"use client"

import { useSearchParams, useRouter } from 'next/navigation'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod/v3'
import { zodResolver } from '@hookform/resolvers/zod'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { authClient } from '@/lib/auth/client'
import { toast } from 'sonner'
import Link from 'next/link'
import { useCallback } from 'react'
import { useCountdown } from '@/hooks/ui/useCountdown'
import { useEffect } from 'react'

const schema = z.object({
  code: z
    .string()
    .length(6, 'Enter the 6-digit code')
    .regex(/^\d+$/, 'Code must contain only digits'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
})

type FormValues = z.infer<typeof schema>

export const ResetPasswordConfirmView = () => {
  const params = useSearchParams()
  const router = useRouter()
  const email = params.get('email') || ''

  const {
    register,
    handleSubmit,
    control,
    getValues,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
  })

  const codeValue = watch('code') || ''

  const {
    canResend,
    label: resendLabel,
    start: startCountdown,
  } = useCountdown(120, true)

  useEffect(() => {
    startCountdown()
  }, [startCountdown])

  const sendCode = useCallback(
    async (emailValue: string) => {
      if (!emailValue) {
        toast.error('Email is required')
        return
      }
      try {
        await authClient.forgetPassword.emailOtp({
          email: emailValue,
        })
        startCountdown()
        toast.success('Reset code sent')
      } catch {
        toast.error('Failed to send reset code')
      }
    },
    [startCountdown]
  )

  const onSubmit = useCallback(
    async (values: FormValues) => {
      if (!email) {
        toast.error('Email is missing')
        return
      }

      try {
        await authClient.emailOtp.resetPassword({
          email: email,
          otp: values.code,
          password: values.password,
        })
        toast.success('Password updated')
        router.replace('/login')
      } catch (error: unknown) {
        console.error('Password reset error:', error)

        // Check for structured error properties first
        let isInvalidOrExpired = false
        if (error && typeof error === 'object') {
          if ('code' in error) {
            const code = String(error.code)
            isInvalidOrExpired =
              code === 'INVALID_TOKEN' ||
              code === 'EXPIRED_TOKEN' ||
              code === 'TOKEN_EXPIRED' ||
              code === 'INVALID_OTP' ||
              code === 'EXPIRED_OTP'
          }
          if (!isInvalidOrExpired && 'status' in error) {
            const status = Number(error.status)
            isInvalidOrExpired = status === 400 || status === 401 || status === 403
          }
        }

        // Fall back to message substring checks if structured checks didn't match
        if (!isInvalidOrExpired) {
          const errorMessage =
            error instanceof Error ? error.message : String(error ?? '')
          const normalizedMessage = errorMessage.toLowerCase()
          isInvalidOrExpired =
            normalizedMessage.includes('invalid') ||
            normalizedMessage.includes('expired')
        }

        if (isInvalidOrExpired) {
          toast.error('The reset code is invalid or has expired')
        } else {
          toast.error('Failed to update password')
        }
      }
    },
    [email, router]
  )

  if (!email) {
    return (
      <div className="grid min-h-screen grid-cols-1 md:grid-cols-2">
        <div className="flex items-center justify-center p-8">
          <div className="w-full max-w-sm space-y-6">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                Reset password
              </h1>
              <p className="text-sm text-muted-foreground">
                Email parameter is missing
              </p>
            </div>
            <div className="text-sm text-muted-foreground text-center">
              <Link href="/reset-password" className="hover:underline">
                Back to reset password
              </Link>
            </div>
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
            <h1 className="text-2xl font-semibold tracking-tight">
              Set new password
            </h1>
            <p className="text-sm text-muted-foreground">
              Enter the code sent to {email} and your new password
            </p>
          </div>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-2">
              <Label htmlFor="code">Reset code</Label>
              <Controller
                control={control}
                name="code"
                render={({ field }) => (
                  <div className="flex justify-center">
                    <InputOTP
                      maxLength={6}
                      value={field.value ?? ''}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      onChange={(v: string) => {
                        const digits = (v || '').replace(/\D/g, '').slice(0, 6)
                        field.onChange(digits)
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
                <p className="text-xs text-destructive">{errors.code.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                aria-invalid={!!errors.password}
                {...register('password')}
              />
              {errors.password?.message && (
                <p className="text-xs text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                disabled={isSubmitting || codeValue.length !== 6}
                className="w-full"
              >
                Change password
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!canResend || isSubmitting}
                onClick={() => sendCode(email)}
                className="w-full"
              >
                {resendLabel}
              </Button>
              <div className="text-sm text-muted-foreground text-center">
                <Link href="/login" className="hover:underline">
                  Back to sign in
                </Link>
              </div>
            </div>
          </form>
        </div>
      </div>
      <div className="hidden md:block bg-muted" />
    </div>
  )
}
