"use client"

import { useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod/v3'
import { zodResolver } from '@hookform/resolvers/zod'
import { authClient } from '@/lib/auth/client'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Link from 'next/link'
import { BackgroundGradient } from '@/components/ui/background-gradient'

const NAME_MAX = 60
const NAME_REGEX = /^[A-Za-z']+$/

const cleanName = (value: unknown) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''

const signUpSchema = z.object({
  firstName: z
    .string()
    .min(1, { message: 'First name is required' })
    .max(NAME_MAX, `Max ${NAME_MAX} characters`)
    .transform(cleanName)
    .refine((v) => NAME_REGEX.test(v), {
      message: "Only letters and apostrophes are allowed",
    }),
  lastName: z
    .string()
    .min(1, 'Last name is required')
    .max(NAME_MAX, `Max ${NAME_MAX} characters`)
    .transform(cleanName)
    .refine((v) => NAME_REGEX.test(v), {
      message: "Only letters and apostrophes are allowed",
    }),
  email: z.string().email({ message: 'Invalid email address' }),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

type SignUpFormValues = z.infer<typeof signUpSchema>

export const SignUpView = () => {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpFormValues>({ resolver: zodResolver(signUpSchema), mode: 'onSubmit' })

  async function onSubmit(values: SignUpFormValues) {
      const displayName = `${values.firstName} ${values.lastName}`
      await authClient.signUp.email({
        email: values.email,
        password: values.password,
        name: displayName,
        callbackURL: `${window.location.origin}/email-otp?email=${encodeURIComponent(values.email)}`,
      }, {
        onSuccess: () => {
          toast.success('Verification code sent')
          router.replace(`/email-otp?email=${encodeURIComponent(values.email)}`)
        },
        onError: (error) => {
          if (error.error.message.includes('Email already in use')) {
            toast.error('Email already in use')
          } else {
            toast.error('Sign up failed')
          }
        }
      })
  }

  async function signUpWithGoogle() {
    startTransition(async () => {
      await authClient.signIn.social(
        { provider: 'google', callbackURL: `${window.location.origin}/` },
        {
          onError: () => {
            toast.error('Sign in failed')
          },
        },
      )
    })
  }

  function signUpWithGithub() {
    startTransition(async () => {
      await authClient.signIn.social(
        { provider: 'github', callbackURL: `${window.location.origin}/` },
        {
          onError: () => {
            toast.error('Sign in failed')
          },
        },
      )
    })
  }

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <div className="text-xl font-semibold">OCR Studio</div>
            <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
            <p className="text-sm text-muted-foreground">Welcome. Please fill in the details to get started.</p>
          </div>

          <div className="space-y-2">
            <Button type="button" variant="outline" className="w-full" onClick={signUpWithGithub} disabled={isPending}>GitHub</Button>
            <Button type="button" variant="outline" className="w-full" onClick={signUpWithGoogle} disabled={isPending}>Google</Button>
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm font-medium" htmlFor="firstName">First name</Label>
                <Input id="firstName" type="text" placeholder="John" aria-invalid={!!errors.firstName} {...register('firstName')} />
                {errors.firstName?.message && (<p className="text-xs text-destructive">{errors.firstName.message}</p>)}
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium" htmlFor="lastName">Last name</Label>
                <Input id="lastName" type="text" placeholder="O'Connor" aria-invalid={!!errors.lastName} {...register('lastName')} />
                {errors.lastName?.message && (<p className="text-xs text-destructive">{errors.lastName.message}</p>)}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium" htmlFor="email">Email address</Label>
              <Input id="email" type="email" placeholder="you@example.com" aria-invalid={!!errors.email} {...register('email')} />
              {errors.email?.message && (<p className="text-xs text-destructive">{errors.email.message}</p>)}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium" htmlFor="password">Password</Label>
              <Input id="password" type="password" placeholder="••••••••" aria-invalid={!!errors.password} {...register('password')} />
              {errors.password?.message && (<p className="text-xs text-destructive">{errors.password.message}</p>)}
            </div>
            <Button type="submit" disabled={isSubmitting} className="w-full">Continue</Button>
          </form>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <Link href="/login" className="hover:underline">Already have an account? Sign in</Link>
            <Link href="/reset-password" className="hover:underline">Forgot password?</Link>
          </div>
        </div>
      </div>
      <div className="relative hidden md:block overflow-hidden">
        <BackgroundGradient asOverlay variant="redCorners" noise="medium" />
      </div>
    </div>
  )
}


