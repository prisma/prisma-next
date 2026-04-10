import { type NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const userId = request.cookies.get('userId')?.value;
  if (!userId) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)'],
};
