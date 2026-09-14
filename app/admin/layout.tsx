import { headers } from 'next/headers';
import { requireAdmin } from '@/lib/auth/protect';
import { adminReturnPath, REQUEST_PATHNAME_HEADER } from '@/lib/auth/admin-return-path';
import AdminSidebar from './_components/AdminSidebar';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // P10 platform-routing-db #6: middleware forwards the requested pathname
  // (always overwritten there) so a signed-out visitor on /admin/users is
  // sent to /login?next=%2Fadmin%2Fusers instead of a bare /login.
  // adminReturnPath() only accepts /admin paths; anything else falls back
  // to /admin.
  const requestHeaders = await headers();
  const returnTo = adminReturnPath(requestHeaders.get(REQUEST_PATHNAME_HEADER));

  // Redirects to /login?next=<returnTo> if not authenticated,
  // and to /unauthorized if not admin.
  await requireAdmin(returnTo);

  return <AdminSidebar>{children}</AdminSidebar>;
}
