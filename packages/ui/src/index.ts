export const UI_TABS = ['skills', 'rules', 'personas', 'audit', 'settings'] as const;

export type UiTab = (typeof UI_TABS)[number];

export * from './port.ts';
export * from './server.ts';
