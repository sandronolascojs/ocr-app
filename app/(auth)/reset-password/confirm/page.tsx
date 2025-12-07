import { enforcePublicAccess } from '@/server/auth/enforceRouteAuth'
import { ResetPasswordConfirmView } from '@/views/auth/ResetPasswordConfirmView'

export default async function ResetPasswordConfirmPage() {
  await enforcePublicAccess()
  return <ResetPasswordConfirmView />
}


