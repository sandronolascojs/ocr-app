import { LoginView } from '@/views/auth/LoginView'
import { enforcePublicAccess } from '@/server/auth/enforceRouteAuth'

export default async function LoginPage() {
  await enforcePublicAccess()
  return <LoginView />
}