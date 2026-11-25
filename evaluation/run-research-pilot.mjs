// Run only against an isolated local database. Results are checkpointed after every request.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

if(process.env.EVALUATION_ISOLATED_DATABASE!=='1')throw Error('An isolated database is required.');
const root=path.dirname(fileURLToPath(import.meta.url));
const base=process.env.API_BASE_URL||'http://127.0.0.1:5198';
const provider=process.env.EVALUATION_PROVIDER||'poe';
const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
const suite=JSON.parse(await readFile(path.join(root,'research-cases.json'),'utf8'));
const names=[...new Set(suite.cases.flatMap(c=>c.people))];
const histories=names.map(name=>{const matches=manifest.histories.filter(h=>h.name===name&&h.split==='test');if(matches.length!==1)throw Error(`Expected one test history for ${name}`);return matches[0]});
const post=async(endpoint,body)=>{const started=Date.now();const r=await fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json','Cookie':'__sites_local_auth=1'},body:JSON.stringify(body)});const data=await r.json();return {http_status:r.status,elapsed_ms:Date.now()-started,data}};
const outputDir=path.join(root,'research-runs');await mkdir(outputDir,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');const output=path.join(outputDir,`research-${stamp}.json`);
const record={metadata:{timestamp:new Date().toISOString(),provider,independent:true,case_file_sha256:createHash('sha256').update(JSON.stringify(suite)).digest('hex'),histories:[]},cases:suite.cases,results:[]};
const save=()=>writeFile(output,JSON.stringify(record,null,2));
for(const h of histories){const corpus=await readFile(path.join(root,'corpus',h.file),'utf8');record.metadata.histories.push({id:h.id,name:h.name,file:h.file,sha256:createHash('sha256').update(corpus).digest('hex')});const setup=await post('/api/eval-setup',{action:'setup',historyId:h.id,historyName:h.name,relationship:h.relationship,corpusText:corpus});if(setup.http_status!==200)throw Error(`Setup failed for ${h.name}: ${JSON.stringify(setup.data)}`);console.log(`Indexed ${h.name}`)}
await save();
for(const [i,c] of suite.cases.entries()){
 for(const variant of i%2===0?['B','C']:['C','B']){
  console.log(`${c.id} ${variant}`);const result=await post('/api/ask',{question:c.question,profileIds:c.people.map(n=>'eval-'+histories.find(h=>h.name===n).id),variant,kind:c.kind,independent:true,provider});
  let answer=result.data?.answer;if(typeof answer==='string'){try{answer=JSON.parse(answer)}catch{}}
  record.results.push({case_id:c.id,variant,http_status:result.http_status,elapsed_ms:result.elapsed_ms,answer,error:result.http_status===200?undefined:result.data});await save();
 }
}
console.log(`Results saved to ${output}`);
