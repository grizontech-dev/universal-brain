import { redirect } from 'next/navigation';
import SettingsView from '@/components/chat/SettingsView';
import { isSettingsSectionId } from '@/lib/settings-sections';

export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!isSettingsSectionId(section)) {
    redirect('/settings/general');
  }
  return (
    <div className='flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-sidebar'>
      <SettingsView section={section} />
    </div>
  );
}
