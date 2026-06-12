export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
      {children}
    </div>
  );
}
