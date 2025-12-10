import { headers } from "next/headers"
import { auth } from "@/lib/auth/auth"
import { NavUserClient } from "./nav-user-client"

export const NavUser = async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return null
  }

  const user = {
    name: session.user.name,
    email: session.user.email,
    avatar: session.user.image ?? null,
  }

  return <NavUserClient user={user} />
}
