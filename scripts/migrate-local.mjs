import {spawnSync} from 'node:child_process';
function d1(args){const r=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--json',...args],{cwd:new URL('../',import.meta.url),encoding:'utf8'});if(r.status!==0)throw Error('Local database migration failed:\nSTDOUT: '+r.stdout+'\nSTDERR: '+r.stderr);try{return JSON.parse(r.stdout)}catch{throw Error('Unexpected migration-tool output:\nSTDOUT: '+r.stdout)}}
const result=d1(['--command',"SELECT name FROM sqlite_master WHERE type='table'"]);let tables=result.flatMap(r=>r.results||[]).map(r=>r.name);
if(!tables.includes('profiles')){d1(['--file','drizzle/0000_empty_darkhawk.sql']);tables.push('profiles')}
const columns=d1(['--command','PRAGMA table_info(profiles)']).flatMap(r=>r.results||[]).map(r=>r.name);
if(!columns.includes('summary'))d1(['--file','drizzle/0001_many_machine_man.sql']);
if(!tables.includes('profile_jobs'))d1(['--file','drizzle/0002_calm_tusk.sql']);
if(!tables.includes('profile_batch_cache'))d1(['--file','drizzle/0003_young_viper.sql']);
console.log('All local migrations are applied. Existing chat data was preserved.');
