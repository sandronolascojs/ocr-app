import { auth } from '@/lib/auth/auth';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const getServerUser = async (): Promise<{ id: string; isEnabled: boolean } | null> => {
  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll();
  const cookieHeader = allCookies
    .map((c: { name: string; value: string }) => `${c.name}=${c.value}`)
    .join('; ');
  const session = await auth.api.getSession({ headers: { cookie: cookieHeader } });
  const userId = session?.user?.id as string | undefined;
  if (!userId) {
    return null;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  })

  if (!user) {
    return null;
  }

  return { id: user.id, isEnabled: user.isEnabled };
};
