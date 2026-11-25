import {observationPacket,reductionGroups,expandMerge,mergeLimit,prepareReduction,FINAL_OBSERVATIONS,REDUCTION_VERSION} from './profile-reduction';
import {profileRequestTimeout,isPoeProvider} from './provider-policy';
import {MAX_PROFILE_CALLS} from './limits';
import {hongKongToday} from './time';
import {db,HttpError} from './service';
import {modelConfig,type Provider} from './model-config';
import {callProvider} from './agent';
import {checkAttributes,completeAreas,exchangeMap} from './summary';
import {SUMMARY_CATEGORIES,OBSERVE_PROMPT} from './summary-contract';
import {SYSTEM} from './agent';
import {tokenCount,fitEvidence,splitText} from './tokens';
import {RuntimeLimit} from './model-runtime';
import {IncompleteModelResponse} from './profile-references';
export {IncompleteModelResponse} from './profile-references';
import type {Message,PersonSummary,SummaryAttribute} from './types';
export type JobState={stage:'read'|'reduce'|'synthesise'|'verify'|'done';position:number;batches:string[][];observations:any[];reduced:any[];candidate?:any;includeBehaviour:boolean;calls:number;input_tokens:number;output_tokens:number;covered:string[];error?:string;levels:number;reduction_version?:number;source_warnings?:{stage:string;reason:string;count:number}[];completed_batches?:number[];cache_hits?:number;started?:string;first_preview_seconds?:number;batch_depths?:number[];split_count?:number};
export function profileParts(messages:Message[]){return messages.flatMap(m=>{let offset=0;return (m.body.length?splitText(m.body,400):['']).map(body=>{const start=m.start+offset;offset+=body.length;return {...m,parent_id:m.id,id:`${m.id}@${start}:${m.start+offset}`,start,end:m.start+offset,body}})})}
export function profileBatches(messages:Message[]){const episodes=exchangeMap(messages);const batches:string[][]=[];let batch:any[]=[];for(const m of messages){const compact={id:m.id,speaker:m.speaker,timestamp:m.timestamp,exchange_id:episodes.get(m.id),body:m.body};if(batch.length&&tokenCount([...batch,compact])>4000){batches.push(batch.map(x=>x.id));batch=[]}batch.push(compact)}if(batch.length)batches.push(batch.map(x=>x.id));return batches;}
export function profileObservations(value:any,allowed:Set<string>,behaviour:boolean,parts:Message[]=[],context=''){
 if(!Array.isArray(value?.attributes)||value.attributes.length>32)throw Error('Profile batch schema failed.');
 const warnings:{reason:string;count:number}[]=[];let rejected=0,normalised=0,malformed=0;
 const resolve=(id:unknown)=>{if(typeof id!=='string')return null;if(allowed.has(id)||id==='profile_context'&&!!context.trim())return id;const matches=parts.filter(m=>allowed.has(m.id)&&(m as any).parent_id===id);if(matches.length===1){normalised++;return matches[0].id}return null};
 const attributes=value.attributes.filter((a:any)=>{
  if(!a||!SUMMARY_CATEGORIES.includes(a.category)||typeof a.text!=='string'||a.text.length>350||!['directly stated','tentative','conflicting','insufficient'].includes(a.support)||!['current','historical','stale'].includes(a.lifecycle)||typeof a.time_scope!=='string'||!Array.isArray(a.source_ids)||!Array.isArray(a.counter_source_ids)){rejected++;malformed++;return false;}
  if(a.support==='insufficient'||!a.source_ids.length)return false;
  if(a.category==='Personality and behavioural tendencies'&&!behaviour)return false;
  const sources=a.source_ids.map(resolve),counter=a.counter_source_ids.map(resolve);
  // Discard the entire observation, including its prose, if any reference is unverified.
  // Never drop just a contrary citation or guess a similar-looking message ID.
  if([...sources,...counter].some(id=>id===null)){rejected++;return false}
  a.source_ids=[...new Set(sources)];a.counter_source_ids=[...new Set(counter)];return true;
 });
 if(malformed)warnings.push({reason:'Observations omitted because required fields, English enum values or text lengths were invalid.',count:malformed});
 if(rejected-malformed)warnings.push({reason:'Observations omitted because a source reference was not in the supplied evidence.',count:rejected-malformed});
 if(normalised)warnings.push({reason:'Unambiguous parent references resolved to their single supplied source part.',count:normalised});
 if(rejected&&!attributes.length)throw Error('No profile observations passed source checks in this batch. No unsupported claims were saved. Use Refresh summary to retry.');
 return {attributes,warnings};
}
export const PROFILE_READ_CONCURRENCY=1;
export function pendingProfileBatches(state:JobState){const completed=new Set(state.completed_batches||Array.from({length:state.stage==='read'?state.position:state.batches.length},(_,i)=>i));return state.batches.map((_,i)=>i).filter(i=>!completed.has(i));}
export const MAX_PROFILE_SPLIT_DEPTH=8;
// Keep completed checkpoint indices aligned after replacing one unfinished batch.
export function splitProfileBatch(state:JobState,index:number){
 const batch=state.batches[index];const completed=state.completed_batches||Array.from({length:state.position},(_,i)=>i);
 if(!batch||completed.includes(index))throw Error('Cannot split a completed or missing reading batch.');
 const depths=state.batch_depths?.length===state.batches.length?[...state.batch_depths]:state.batches.map(()=>0);const depth=depths[index]||0;
 if(batch.length<2||depth>=MAX_PROFILE_SPLIT_DEPTH)throw Error('The model output limit was reached for a reading batch that cannot be split further. Completed batches are saved; try another model or a shorter source.');
 const mid=Math.ceil(batch.length/2);state.batches.splice(index,1,batch.slice(0,mid),batch.slice(mid));depths.splice(index,1,depth+1,depth+1);state.batch_depths=depths;
 state.completed_batches=completed.map(i=>i>index?i+1:i);state.position=state.completed_batches.length;state.split_count=(state.split_count||0)+1;
}
export function profileOutputLimit(error:unknown){
 if(!(error instanceof IncompleteModelResponse))return false;
 const d=error.details;if(d.reason==='max_output_tokens'||d.finish_reason==='length')return true;
 // Some providers omit incomplete_details despite consuming almost the whole cap.
 // Treat that narrow case as likely truncation, never an explicit different reason.
 return d.status==='incomplete'&&(d.reason===undefined||d.reason===null||d.reason==='')&&typeof d.output_limit==='number'&&Number.isFinite(d.output_limit)&&d.output_limit>0&&typeof d.output_tokens==='number'&&Number.isFinite(d.output_tokens)&&d.output_tokens>=Math.ceil(d.output_limit*0.995)&&d.output_tokens<=d.output_limit;
}
export function recoverProfileOutputLimit(state:JobState,index:number,error:unknown){
 if(!profileOutputLimit(error))return false;
 const details=(error as IncompleteModelResponse).details;if(Number.isFinite(details.input_tokens))state.input_tokens+=Number(details.input_tokens);if(Number.isFinite(details.output_tokens))state.output_tokens+=Number(details.output_tokens);
 splitProfileBatch(state,index);return true;
}
// Existing failed jobs may have saved usage details before split recovery existed.
export function recoverSavedProfileSplit(state:JobState,jobId:string,record:any){
 if(state.stage!=='read'||!state.error||!record||record.job_id!==jobId||record.stage!=='summary_observe'||record.error!==state.error||!record.incomplete||typeof record.incomplete!=='object')return false;
 const index=pendingProfileBatches(state)[0];if(index===undefined)return false;
 return recoverProfileOutputLimit(state,index,new IncompleteModelResponse(record.incomplete,true));
}
export async function readProfileWave<T>(indices:number[],provider:string,worker:(index:number)=>Promise<T>){const selected=[...indices].sort((a,b)=>a-b).slice(0,1);const results=await Promise.allSettled(selected.map(worker));return results.map((result,i)=>({index:selected[i],result}));}
export async function profileBatchKey(owner:string,profileId:string,config:unknown,packet:unknown){const bytes=new TextEncoder().encode(JSON.stringify({revision:'parallel-profile-v1',owner,profileId,config,packet,prompt:OBSERVE_PROMPT,system:SYSTEM}));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export function preliminaryProfile(state:JobState,person:any,messages:Message[]){
 if(!state.covered.length||state.stage==='done')return null;
 const parts=profileParts(messages),covered=new Set(state.covered),evidence=parts.filter(p=>covered.has(p.id));
 const attributes:SummaryAttribute[]=[];
 for(const observation of state.observations){try{const checked=checkAttributes({attributes:[structuredClone(observation)],limits:''},evidence,person.name,{all:parts,context:person.context,includeBehaviour:state.includeBehaviour});for(const a of checked)if(!attributes.some(p=>p.category===a.category))attributes.push(a);}catch{/* Unusable observations are never exposed in the preview. */}}
 if(!attributes.length)return null;
 const dates=evidence.map(m=>m.timestamp.slice(0,10)).sort();
 return {attributes,reviewed_messages:new Set(evidence.map(m=>m.parent_id)).size,total_messages:messages.length,from:dates[0],to:dates.at(-1),preliminary:true};
}
export function profileProgress(job:any,state:JobState,person:any,messages:Message[]){const preview=preliminaryProfile(state,person,messages);return {id:job.id,status:job.status,stage:state.stage,processed_messages:new Set(state.covered.map(id=>id.split('@')[0])).size,total_messages:messages.length,processed_batches:state.completed_batches?.length??(state.stage==='read'?state.position:state.batches.length),total_batches:state.batches.length,model_calls:state.calls,reused_batches:state.cache_hits||0,parallel_batches:isPoeProvider(job.provider)?PROFILE_READ_CONCURRENCY:1,split_count:state.split_count||0,error:state.error,preview,retry_after:job.provider==='hku'?13:1};}
export async function startProfileJob(owner:string,person:any,messages:Message[],provider:Provider,includeBehaviour:boolean){const parts=profileParts(messages);if(!parts.some(p=>p.body.length))throw new HttpError(400,'Upload a conversation containing readable text first.');const id=crypto.randomUUID(),now=new Date().toISOString();const state:JobState={stage:'read',position:0,batches:profileBatches(parts.filter(p=>p.body.length>0)),observations:[],reduced:[],includeBehaviour,calls:0,input_tokens:0,output_tokens:0,covered:[],levels:0,completed_batches:[],cache_hits:0,started:now};await db().prepare('INSERT INTO profile_jobs(id,owner,profile_id,version,provider,state,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,owner,person.id,person.version,provider,JSON.stringify(state),'pending',now,now).run();return profileProgress({id,status:'pending',provider},state,person,messages);}
export async function stepProfileJob(owner:string,job:any,person:any,messages:Message[]){if(job.version!==person.version)throw new HttpError(409,'Chat changed; start a new profile job.');let state:JobState=JSON.parse(job.state);if(job.status==='complete')return {id:job.id,status:'complete'};if(job.status==='failed')throw new HttpError(422,state.error||'Profile job failed. Start a new run to retry explicitly.');const lease=new Date().toISOString();const locked=await db().prepare("UPDATE profile_jobs SET status='running',updated=? WHERE id=? AND owner=? AND status='pending'").bind(lease,job.id,owner).run();if(!locked.meta.changes)return {...profileProgress(job,state,person,messages),retry_after:5};const parts=profileParts(messages),refs=new Map(parts.map(m=>[m.id,m])),episodes=exchangeMap(parts);state.covered=[...new Set([...state.covered,...parts.filter(p=>!p.body.length).map(p=>p.id)])];const cfg=modelConfig(job.provider,owner,'profile');cfg.jobId=job.id;const packet=(ms:Message[])=>ms.map(m=>({id:m.id,speaker:m.speaker,timestamp:m.timestamp,exchange_id:episodes.get(m.id),body:m.body}));const base={person:person.name,user_context:person.context,include_behaviour:state.includeBehaviour,response_language:'en',today:hongKongToday(),timezone:'Asia/Hong_Kong'};let status='pending',summary:PersonSummary|undefined;
 try{prepareReduction(state);if(state.calls>=MAX_PROFILE_CALLS)throw Error('Profile preprocessing reached its 1,000-call ceiling. Nothing was silently truncated.');const accept=(value:any,allowed:Set<string>)=>{const checked=profileObservations(value,allowed,state.includeBehaviour,parts,person.context||'');state.source_warnings=[...(state.source_warnings||[]),...checked.warnings.map(w=>({...w,stage:state.stage}))];return checked.attributes};const ask=async(stage:string,data:unknown)=>{state.calls++;const r=await callProvider(cfg,stage,data,profileRequestTimeout(job.provider));state.input_tokens+=r.input_tokens;state.output_tokens+=r.output_tokens;return r.value};
 if(state.stage==='read'){
  state.completed_batches=state.completed_batches||Array.from({length:state.position},(_,i)=>i);
  const remaining=pendingProfileBatches(state);
  const wave=await readProfileWave(remaining.slice(0,Math.max(0,MAX_PROFILE_CALLS-state.calls)),job.provider,async index=>{
   const ids=state.batches[index],evidence=packet(ids.map(id=>refs.get(id)!));
   const key=await profileBatchKey(owner,person.id,{...base,provider:job.provider,model:cfg.model},evidence);
   const cached=await db().prepare('SELECT record FROM profile_batch_cache WHERE owner=? AND profile_id=? AND id=? AND created>?').bind(owner,person.id,key,new Date(Date.now()-7*86400000).toISOString()).first<{record:string}>();
   let value:any,reused=false;
   if(cached){value=JSON.parse(cached.record);reused=true;}else value=await ask('summary_observe',{...base,batch_number:index+1,total_batches:state.batches.length,evidence});
   const checked=profileObservations(value,new Set(ids),state.includeBehaviour,parts,person.context||'');
   if(!reused)await db().prepare('INSERT OR REPLACE INTO profile_batch_cache(id,owner,profile_id,record,created) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM profiles WHERE owner=? AND id=? AND version=?)').bind(key,owner,person.id,JSON.stringify(value),new Date().toISOString(),owner,person.id,person.version).run();
   return {ids,attributes:checked.attributes,warnings:checked.warnings,reused};
  });
  let failure:unknown;
  for(const {index,result} of wave){if(result.status==='fulfilled'){const r=result.value;state.observations.push(...r.attributes);state.covered=[...new Set([...state.covered,...r.ids])];state.completed_batches.push(index);state.cache_hits=(state.cache_hits||0)+(r.reused?1:0);state.source_warnings=[...(state.source_warnings||[]),...r.warnings.map(w=>({...w,stage:'read'}))];}else{if(result.reason instanceof RuntimeLimit&&result.reason.retryAfter)state.calls=Math.max(0,state.calls-1);else{try{if(!recoverProfileOutputLimit(state,index,result.reason))failure=result.reason;}catch(e){failure=e;}}}}
  state.position=state.completed_batches.length;
  if(state.covered.length&&state.first_preview_seconds===undefined)state.first_preview_seconds=(Date.now()-Date.parse(state.started||job.created))/1000;
  if(failure)throw failure;
  if(!pendingProfileBatches(state).length){state.stage=state.observations.length>FINAL_OBSERVATIONS?'reduce':'synthesise';state.position=0;state.reduction_version=REDUCTION_VERSION;}
 }

 else if(state.stage==='reduce'){
  const groups=reductionGroups(state.observations),batch=groups[state.position];
  if(!batch)throw Error('Invalid saved consolidation checkpoint.');
  if(batch.length<=FINAL_OBSERVATIONS)state.reduced.push(...batch);
  else{const allowed=new Set<string>(batch.flatMap(o=>[...o.source_ids,...o.counter_source_ids]));const value=expandMerge(await ask('summary_merge',{...base,observations:observationPacket(batch),max_attributes:mergeLimit(batch.length),reference_format:'source_ids and counter_source_ids must cite observation_N handles. Include EVERY input observation in at least one output reference array. The server restores all original supporting and contrary source IDs. has_counterexamples means retain qualified/conflicting wording. Combine related observations; do not repeat each input separately.'}),batch);state.reduced.push(...accept(value,allowed));}
  state.position++;
  if(state.position>=groups.length){if(state.reduced.length>=state.observations.length)throw Error('Consolidation did not shrink; saved reading results retained.');state.observations=state.reduced;state.reduced=[];state.position=0;state.levels++;state.stage=state.observations.length>FINAL_OBSERVATIONS?'reduce':'synthesise';}
 }
 else if(state.stage==='synthesise'){const ids=[...new Set<string>(state.observations.flatMap(o=>[...o.source_ids,...o.counter_source_ids]))];const evidence=fitEvidence(ids.map(id=>refs.get(id)!).filter(Boolean),8000);const value=await ask('summary',{...base,whole_conversation_read:true,processed_parts:state.covered.length,total_parts:parts.length,observations:observationPacket(state.observations),reference_format:'Observation handles are untrusted aggregation lineage, NOT source citations. Cite ONLY exact IDs from the supplied original evidence array. The server checks every citation.',evidence:packet(evidence)});state.candidate={attributes:checkAttributes({...value,attributes:accept(value,new Set(evidence.map(m=>m.id)))},evidence,person.name,{all:parts,context:person.context,includeBehaviour:state.includeBehaviour}),limits:value.limits};state.stage='verify';}
 else if(state.stage==='verify'){const attrs:SummaryAttribute[]=state.candidate.attributes;const ids=[...new Set<string>(attrs.flatMap(a=>[...a.source_ids,...a.counter_source_ids]))];const evidence=fitEvidence(ids.map(id=>refs.get(id)).filter((m):m is typeof parts[number]=>!!m),8000);if(ids.some(id=>id!=='profile_context'&&!evidence.some(m=>m.id===id)))throw Error('Final review evidence exceeds preprocessing budget; no unchecked profile saved.');const candidate={attributes:attrs.map((a,index)=>({...a,attribute_id:'attribute_'+index}))};const verdict=await ask('summary_check',{...base,candidate,evidence:packet(evidence)});const accepted=verdict?.accepted_attribute_ids;if(!Array.isArray(accepted)||accepted.some((id:any)=>!candidate.attributes.some(a=>a.attribute_id===id)))throw Error('Invalid final profile review.');const attributes=attrs.filter((_,i)=>accepted.includes('attribute_'+i));const dates=parts.map(m=>m.timestamp.slice(0,10)).sort(),from=dates[0],to=dates.at(-1)!;if(!attributes.some(a=>a.category==='Basic facts'))attributes.push({category:'Basic facts',text:'User-provided name: '+person.name,support:'directly stated',lifecycle:'current',time_scope:'Profile metadata',provenance:'user-provided',source_ids:['profile_metadata'],counter_source_ids:[]});if(!attributes.some(a=>a.category==='Relationship context'))attributes.push({category:'Relationship context',text:'User-provided relationship: '+person.relationship+(person.context?' · '+person.context:''),support:'directly stated',lifecycle:'current',time_scope:'Profile metadata',provenance:'user-provided',source_ids:['profile_metadata'],counter_source_ids:[]});const processed=new Set(state.covered.map(id=>refs.get(id)?.parent_id));if(processed.size!==messages.length)throw Error('Whole-conversation coverage check failed.');summary={schema_version:4,include_behaviour:state.includeBehaviour,attributes:completeAreas(attributes,state.includeBehaviour,from,to),limits:`Read every message: ${processed.size}/${messages.length}, across ${state.batches.length} batches. Observations were aggregated and checked against cited originals. Interpretations remain provisional; absence of an extracted item is not proof of absence. Personality is optional and excluded from the primary benchmark.${state.source_warnings?.length?' Source checks: '+state.source_warnings.map(w=>w.count+' '+w.reason).join(' '):''}`,reviewed_messages:processed.size,total_messages:messages.length,from,to,generated:new Date().toISOString(),model:cfg.model,model_calls:state.calls,version:person.version,coverage:{complete:true,processed_parts:state.covered.length,total_parts:parts.length,batches:state.batches.length},preprocessing:{input_tokens:state.input_tokens,output_tokens:state.output_tokens,provider:job.provider,cost_usd:null,reused_batches:state.cache_hits||0,parallel_batches:isPoeProvider(job.provider)?PROFILE_READ_CONCURRENCY:1,first_preview_seconds:state.first_preview_seconds,total_elapsed_seconds:(Date.now()-Date.parse(state.started||job.created))/1000}};
 const result=await db().prepare('UPDATE profiles SET summary=?,summary_version=?,summary_error=NULL WHERE owner=? AND id=? AND version=?').bind(JSON.stringify(summary),person.version,owner,person.id,person.version).run();if(!result.meta.changes)throw Error('Snapshot changed during final save.');await storeFindings(owner,person,summary.attributes,cfg.model);await db().prepare('DELETE FROM retrieval_cache WHERE owner=?').bind(owner).run();state.stage='done';status='complete';}
 }catch(e){if(e instanceof RuntimeLimit&&e.retryAfter){state.calls=Math.max(0,state.calls-1);status='pending'}else{status='failed';state.error=e instanceof Error?e.message:'Profile preprocessing failed';}}
 const saved=await db().prepare('UPDATE profile_jobs SET state=?,status=?,updated=? WHERE owner=? AND id=? AND status=? AND updated=?').bind(JSON.stringify(state),status,new Date().toISOString(),owner,job.id,'running',lease).run();if(!saved.meta.changes)throw new HttpError(409,'Analysis checkpoint changed. Reload to continue the saved job.');return {...profileProgress({...job,status},state,person,messages),summary};}
export async function storeFindings(owner:string,person:any,attributes:SummaryAttribute[],model:string){for(const attr of attributes){const previous=await db().prepare("SELECT id,record FROM finding_records WHERE owner=? AND profile_id=? AND kind=? AND lifecycle IN ('active','stale') ORDER BY created DESC LIMIT 1").bind(owner,person.id,attr.category).first<{id:string;record:string}>();const id=crypto.randomUUID();const record={...attr,person_id:person.id,source_version:person.version,parser_version:'whatsapp-v2',prompt_version:'profile-whole-v1',model,created:new Date().toISOString()};await db().prepare('INSERT INTO finding_records(id,owner,profile_id,version,kind,record,lifecycle,predecessor,replacement,created) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,owner,person.id,person.version,attr.category,JSON.stringify(record),'active',previous?.id||null,null,new Date().toISOString()).run();if(previous)await db().prepare("UPDATE finding_records SET lifecycle='superseded',replacement=? WHERE owner=? AND id=?").bind(id,owner,previous.id).run();}}
