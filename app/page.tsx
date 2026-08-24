import { auth } from '@/lib/auth';
import { CommunityHome } from './_components/CommunityHome';
import { Landing } from './_components/Landing';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await auth();

  if (session?.user) {
    return (
      <CommunityHome
        user={{
          id: session.user.id,
          displayName: session.user.displayName,
          roleKey: session.user.roleKey,
          permissions: session.user.permissions,
        }}
      />
    );
  }
  return <Landing />;
}
