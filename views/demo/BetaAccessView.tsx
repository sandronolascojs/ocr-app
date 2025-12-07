"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Lock, Mail, AlertCircle, Sparkles, LogOut } from "lucide-react"
import { useRouter } from "next/navigation"
import { signOut } from "@/lib/auth/client"

interface BetaAccessViewProps {}

export const BetaAccessView = ({}: BetaAccessViewProps) => {
  const router = useRouter()

  const handleLogout = async () => {
      await signOut({ router })
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              Beta Access Required
            </h1>
            <p className="text-lg text-muted-foreground">
              This product is currently in beta testing
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Access Request Required</CardTitle>
            </div>
            <CardDescription>
              Your account is pending approval from an administrator
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              We're currently in beta and access is limited. To use this
              application, you need to request access from an administrator.
            </p>
            <div className="rounded-lg border bg-muted/50 p-4">
              <div className="flex items-start gap-3">
                <Mail className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    How to request access:
                  </p>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    <li>Contact your administrator or support team</li>
                    <li>Provide your email address for account activation</li>
                    <li>Wait for approval confirmation</li>
                  </ul>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-muted-foreground" />
              <CardTitle>What's Next?</CardTitle>
            </div>
            <CardDescription>
              Once your account is enabled, you'll have full access
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              After your administrator enables your account, you'll be able to
              access all features of the application, including creating OCR
              jobs, viewing documents, and managing your storage.
            </p>
          </CardContent>
        </Card>

        <div className="flex justify-center pt-4">
          <Button variant="outline" onClick={handleLogout} className="gap-2">
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </div>
    </div>
  )
}

