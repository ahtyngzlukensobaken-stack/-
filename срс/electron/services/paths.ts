import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertSafeId, isSafeName } from './guards.js';


export const CONFIG_ROOT = app.getPath('userData');



let dataRoot = CONFIG_ROOT;

export function setDataRoot(path: string): void {
  dataRoot = path.trim() || CONFIG_ROOT;
}

export const dataDir = () => dataRoot;
export const sharedDir = () => join(dataRoot, 'shared');
const instancesDir = () => join(dataRoot, 'instances');



export const cacheDir = () => join(dataRoot, 'content-cache');
export const javaDir = () => join(dataRoot, 'java');


export const instanceDir = (id: string) => join(instancesDir(), assertSafeId(id));
export const instanceMods = (id: string) => join(instanceDir(id), 'mods');
export const instanceResourcePacks = (id: string) => join(instanceDir(id), 'resourcepacks');
export const instanceShaderPacks = (id: string) => join(instanceDir(id), 'shaderpacks');
export const instanceSaves = (id: string) => join(instanceDir(id), 'saves');


export const worldDatapacks = (id: string, world: string) => {
  if (!isSafeName(world)) throw new Error('Странное имя мира.');
  return join(instanceSaves(id), world, 'datapacks');
};


export const MOVABLE = ['shared', 'instances', 'content-cache', 'java'] as const;

export function ensureDirs(): void {
  for (const dir of [CONFIG_ROOT, dataRoot, sharedDir(), instancesDir(), cacheDir(), javaDir()]) {
    mkdirSync(dir, { recursive: true });
  }
}
