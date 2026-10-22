import { useStaff } from '../context/StaffContext';
import type { PageKey } from '../types/settings';

interface Props {
  pageKey: PageKey;
  children: React.ReactNode;
}

export function ComponentGuard({ pageKey, children }: Props) {
  const { hasAccess, currentStaff } = useStaff();
  if (!currentStaff || !hasAccess(pageKey)) return null;
  return <>{children}</>;
}