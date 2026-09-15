import { readFile, writeFile } from 'node:fs/promises';
const path = new URL('../../pocket-kpi-deploy/Code.gs', import.meta.url);
const marker = '/* BEGIN GENERATED CONTRACT SYNC CORE */';
const code = (await readFile(path, 'utf8')).split(marker)[0].trimEnd();
const core = (await readFile(new URL('./contract-sheet-sync-core.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');
await writeFile(path, code + '\n\n' + marker + '\n' + core + '\n/* END GENERATED CONTRACT SYNC CORE */\n');
console.log('Contract sync core bundled into Code.gs');
