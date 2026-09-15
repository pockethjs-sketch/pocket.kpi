import { readFile, writeFile } from 'node:fs/promises';
const runtime = await readFile(new URL('./daily-sync-runtime.gs',import.meta.url),'utf8');
const core = (await readFile(new URL('./premeeting-sync-core.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
await writeFile(new URL('../../pocket-kpi-deploy/crm_lead.gs', import.meta.url),runtime+'\n/* BEGIN GENERATED PREMEETING CORE */\n'+core+'\n/* END GENERATED PREMEETING CORE */\n');
