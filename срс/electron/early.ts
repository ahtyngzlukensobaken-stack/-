import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';


try {
  if (JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')).pvDevBuild === true) {
    app.setPath('userData', join(app.getPath('appData'), 'power-visual-launcher'));
  }
} catch {  }
