import { EmailOtpView } from '@/views/auth/EmailOtpView'
import { enforcePublicAccess } from '@/server/auth/enforceRouteAuth'
import { auth } from '@/lib/auth/auth'
import { headers } from 'next/headers'

export default async function EmailOtpPage() {
  await enforcePublicAccess()
  const session = await auth.api.getSession({ headers: await headers() })
  const serverEmail = session?.user?.email ?? undefined
  return <EmailOtpView serverEmail={serverEmail} />
}


