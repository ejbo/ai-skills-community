import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Middleware runs on the edge. We do NOT touch the DB here — we only:
// 1. Guard /manage/* for admins (redirect non-admins to /).
// 2. Forward a page-visit beacon to /api/internal/page-visit on app routes
//    where the user is logged in, so the DB write happens in a Node route.

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/manage')) {
    const token = await getToken({
      req,
      secret: process.env.AUTH_SECRET,
    });
    if (!token) {
      const url = req.nextUrl.clone();
      url.pathname = '/auth/login';
      url.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(url);
    }
    if (!token.isAdmin) {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/manage/:path*'],
};
