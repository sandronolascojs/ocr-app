// Route-level auth enforcement for App Router server components
import { redirect } from 'next/navigation'
import { getServerUser } from './getServerUser'

export const enforcePrivateUser = async (): Promise<{ id: string; isEnabled: boolean }> => {
  const user = await getServerUser()
  if (!user) redirect('/login')
  return user
}

export const enforcePublicAccess = async (): Promise<void> => {
  const user = await getServerUser()
  if (user) redirect('/')
}


