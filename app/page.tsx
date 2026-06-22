import { auth } from '@/lib/auth';
import { CommunityHome } from './_components/CommunityHome';
import { Landing } from './_components/Landing';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await auth();

  if (session?.user) {
    return <CommunityHome displayName={session.user.displayName} />;
  }
  return <Landing />;
}
