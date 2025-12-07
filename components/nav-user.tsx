import { headers } from "next/headers"
import { auth } from "@/lib/auth/auth"
import { NavUserClient } from "./nav-user-client"

export const NavUser = async () => {
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

  return <NavUserClient user={user} />
}
