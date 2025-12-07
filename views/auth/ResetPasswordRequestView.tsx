"use client"

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod/v3'
import { zodResolver } from '@hookform/resolvers/zod'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth/client'
import { toast } from 'sonner'
import Link from 'next/link'

const schema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
})

type FormValues = z.infer<typeof schema>

export const ResetPasswordRequestView = () => {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema), mode: 'onSubmit' })
  const [sent, setSent] = useState(false)

  async function onSubmit(values: FormValues) {
    try {
      await authClient.forgetPassword.emailOtp({
        email: values.email,
      });
      setSent(true);
      toast.success('If an account exists, a reset code has been sent.');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send reset email';
        if (errorMessage.includes('Email not found')) {
          toast.success('If an account exists, a reset code has been sent.');
      } else {
        toast.error('Failed to send reset email');
      }
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Reset password</h1>
            <p className="text-sm text-muted-foreground">Enter your email to receive a reset code</p>
          </div>

          {sent ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">If an account exists, a reset code has been sent to your email.</p>
              <div className="text-sm text-muted-foreground">
                <Link href="/login" className="hover:underline">Back to sign in</Link>
              </div>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="you@example.com" aria-invalid={!!errors.email} {...register('email')} />
                {errors.email?.message && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>
              <Button type="submit" disabled={isSubmitting} className="w-full">Send reset email</Button>
              <div className="text-sm text-muted-foreground text-center">
                <Link href="/login" className="hover:underline">Back to sign in</Link>
              </div>
            </form>
          )}
        </div>
      </div>
      <div className="hidden md:block bg-muted" />
    </div>
  )
}


