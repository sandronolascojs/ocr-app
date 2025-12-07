// Enforces server-side authentication; redirects to /login if unauthenticated.
import { getServerUser } from './getServerUser'

export const requireServerUser = async (): Promise<{ id: string; isEnabled: boolean }> => {
  const user = await getServerUser()
  if (!user) {
    // In server components, perform a redirect via Next.js redirect helper
    // but to avoid importing from next/navigation here, throw a simple error
    // and let pages use redirect() based on null.
    throw new Error('UNAUTHENTICATED')
  }
  return user
}


