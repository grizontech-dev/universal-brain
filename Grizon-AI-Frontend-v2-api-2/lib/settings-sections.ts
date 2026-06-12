/** Valid first segment under `/settings/:section` */
export const SETTINGS_SECTION_IDS = [
  'general',
  'account',
  'sessions',
  'usage',
  'billing',
  'wallet',
  'privacy',
  'models',
  'connections',
  'theme-studio',
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export function isSettingsSectionId(s: string): s is SettingsSectionId {
  return (SETTINGS_SECTION_IDS as readonly string[]).includes(s);
}
