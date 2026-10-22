import { load } from './store.js';


export const UA = { 'user-agent': 'PowerVisualLauncher' };


export function apiBase(): string {
  return load().settings.contentUrl.replace(/\/+$/, '');
}
