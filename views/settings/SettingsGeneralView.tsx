import { headers } from "next/headers"
import { auth } from "@/lib/auth/auth"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"

interface SettingsGeneralViewProps {}

export const SettingsGeneralView = async ({}: SettingsGeneralViewProps) => {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  const user = session?.user
    ? {
        name: session.user.name ?? "User",
        email: session.user.email ?? "",
        avatar: session.user.image ?? "/avatars/user.jpg",
      }
    : {
        name: "User",
        email: "user@example.com",
        avatar: "/avatars/user.jpg",
      }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account and storage settings
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account Information</CardTitle>
          <CardDescription>
            Your account details and settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={user.avatar} alt={user.name} />
              <AvatarFallback className="text-lg">
                {user.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-sm text-muted-foreground">
                {user.email}
              </p>
            </div>
          </div>
          <Separator />
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Account Status:</span>
              <span className="font-medium">Active</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Plan:</span>
              <span className="font-medium">Free</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

