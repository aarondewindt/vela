export const settingsSections = [
  {
    label: 'Devices',
    href: '/settings/devices',
    group: 'Integrations',
    description: 'Pair companions and revoke scoped device access.',
  },
  {
    label: 'Profile',
    href: '/settings/profile',
    group: 'Account',
    description: 'Your display name.',
  },
  {
    label: 'Appearance',
    href: '/settings/appearance',
    group: 'Account',
    description: 'Light, dark or system color scheme.',
  },
  {
    label: 'AI & models',
    href: '/settings/ai-models',
    group: 'Account',
    description: 'Default models, profiles and feature overrides.',
  },
  {
    label: 'Planner',
    href: '/settings/planner',
    group: 'Apps',
    description: 'Time zone, planning defaults and shared task-search configuration.',
  },
  {
    label: 'Nutrition',
    href: '/settings/nutrition',
    group: 'Apps',
    description: 'Daily nutrition goals and related-food search setup.',
  },
  {
    label: 'Health',
    href: '/settings/health',
    group: 'Apps',
    description: 'Calorie balance, weight, body-fat and sleep goals; sensor setup links.',
  },
  {
    label: 'Home Assistant',
    href: '/settings/home-assistant',
    group: 'Integrations',
    description: 'Private connection, synchronization and health sensor mappings.',
  },
] as const;
