import { enforcePublicAccess } from '@/server/auth/enforceRouteAuth'
import { ResetPasswordRequestView } from '@/views/auth/ResetPasswordRequestView'

export default async function ResetPasswordPage() {
  await enforcePublicAccess()
  return <ResetPasswordRequestView />
}


