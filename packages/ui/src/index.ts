export const UI_TABS = ['skills', 'rules', 'personas', 'audit', 'settings'] as const;

export type UiTab = (typeof UI_TABS)[number];

export * from './audit.ts';
export * from './catalog.ts';
export * from './port.ts';
export * from './render.ts';
export * from './server.ts';
export * from './state.ts';
export * from './transitions.ts';
