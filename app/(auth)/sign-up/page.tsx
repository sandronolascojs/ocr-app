import { SignUpView } from '@/views/auth/SignUpView'
import { enforcePublicAccess } from '@/server/auth/enforceRouteAuth'

export default async function SignUpPage() {
  await enforcePublicAccess()
  return <SignUpView />
}