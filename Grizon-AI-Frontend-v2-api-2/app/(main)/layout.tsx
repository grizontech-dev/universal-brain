import MainAppShell from '@/components/layout/MainAppShell';

export default function MainRouteGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MainAppShell>{children}</MainAppShell>;
}
