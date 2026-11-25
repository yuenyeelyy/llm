import {socialTurn,unclearTurn} from './social-turn';
import {callProvider,validate} from './agent';
import {withRequestWindow} from './model-runtime';
import {modelConfig,type Provider} from './model-config';
import {conversationPlan,aliasEvidence,originalCitation,searchConversationOriginals} from './conversation-context';
import {checkedEpisode,restoreEpisode,episodeView,applyItemReviews,type Episode} from './conversation-items';
import {CONVERSATION_REVISION,CONVERSATION_EXTRACT} from './conversation-contract';
import {responseLanguage,searchTerms} from './language';
import {tokenCount} from './tokens';
import {hongKongToday} from './time';
import type {Message,Answer} from './types';
type Cache={get:(key:string)=>Promise<any|null>;put:(key:string,value:any)=>Promise<void>};
export type ConversationOptions={question:string;messages:Message[];profiles:any[];context:unknown[];provider:Provider;owner?:string;variant:string;cache?:Cache};
async function cacheKey(owner:string,model:string,batch:Message[],profiles:any[]){const input=JSON.stringify({owner,model,profiles:profiles.map(p=>[p.id,p.version,p.name,p.context]),revision:CONVERSATION_REVISION,prompt:CONVERSATION_EXTRACT,messages:batch.map(m=>[m.id,m.source_version,m.timestamp,m.speaker,m.body])});return 'conversation-'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
function rankMemories(values:Episode[],question:string){
 const terms=searchTerms(question),ranked=values.map((e,i)=>({e,i,score:terms.reduce((n,t)=>n+((e.situation+' '+e.interpretation+' '+e.clues).toLowerCase().includes(t)?1:0),0)})).sort((a,b)=>b.score-a.score||a.i-b.i);
 const chosen:Episode[]=[];const add=(e:Episode)=>{if(chosen.length<32&&!chosen.includes(e))chosen.push(e)};
 // Cover dates and valence as well as relevance; no ranking by citation count.
 const queues=['positive','negative','mixed','ambiguous'].map(section=>ranked.filter(x=>x.e.section===section));
 for(let i=0;i<8;i++)for(const q of queues)if(q.length){const x=q[Math.floor(i*(q.length-1)/7)];add(x.e)}
 for(const x of ranked)add(x.e);return chosen;
}
export async function runConversation(options:ConversationOptions,providerCall=callProvider):Promise<any>{
 const social=socialTurn(options.question);if(social)return social;
 const unclear=unclearTurn(options.question);if(unclear)return unclear;
 const {question,messages,profiles,context,cache}=options,plan=conversationPlan(messages),cfg=modelConfig(options.provider,options.owner,'conversation');
 const trace:any[]=[],metrics:any={engine:CONVERSATION_REVISION,model:cfg.model,provider:cfg.provider,model_calls:0,tool_calls:0,input_tokens:0,output_tokens:0,cache_hits:0,whole_history_read:plan.full,available_messages:messages.length};const start=Date.now();
 const ask=async(stage:string,data:any)=>{if(metrics.model_calls>=6)throw Error('Conversation request call ceiling reached. Reading checkpoints are saved.');metrics.model_calls++;trace.push({stage,evidence_messages:data.evidence?.length||0});try{const r=await withRequestWindow(()=>providerCall(cfg,stage,data,180000),seconds=>{metrics.cooldown_seconds=(metrics.cooldown_seconds||0)+seconds;trace.push({stage:'provider_cooldown',waiting_for:stage,retry_after:seconds,reason:'Waiting for a local request slot; no provider request was made.'})});metrics.input_tokens+=r.input_tokens;metrics.output_tokens+=r.output_tokens;return r.value}catch(err){const details=(err as any)?.details;if(Number.isFinite(details?.input_tokens)&&Number.isFinite(details?.output_tokens)){metrics.input_tokens+=details.input_tokens;metrics.output_tokens+=details.output_tokens}else metrics.provider_usage_unknown=true;throw err}};
 const literalLookup=/\b(find|quote|verbatim|exact wording|which message|what did .{1,50} say|when did)\b|原文|邊句|邊則|搵.*訊息|幾時講/i.test(question)&&context.length===0;
 const base={answer_mode:literalLookup?'literal_lookup':'interpretation',question,profiles:profiles.map(p=>({id:p.id,name:p.name,relationship:p.relationship,context:p.context})),prior_room_context:context,response_language:responseLanguage(question),today:hongKongToday(),timezone:'Asia/Hong_Kong'};
 let evidence=plan.messages,memories:Episode[]=[],readingComplete=plan.full;let originalSearch:ReturnType<typeof searchConversationOriginals>|undefined;let usedOriginalSearch=false,usingOriginalEvidence=false;
 try{
 if(!plan.full){
  const keys=await Promise.all(plan.batches.map(batch=>cacheKey(options.owner||'test',cfg.model,batch,profiles)));const records=await Promise.all(keys.map(key=>cache?.get(key)||Promise.resolve(null)));let processed=records.filter(Boolean).length;metrics.cache_hits=processed;
  const missing=records.findIndex(v=>!v);
  if(missing>=0){const batch=plan.batches[missing],{packet,refs}=aliasEvidence(batch);const raw=await ask('conversation_extract',{...base,question:undefined,prior_room_context:[],evidence:packet,exchange_scope:'Chronological exchanges; large exchanges may span overlapping parts. No recurrence counts from overlapping parts.'});if(!Array.isArray(raw.episodes)||raw.episodes.length>16)throw Error('Invalid memory extraction schema.');const episodes:Episode[]=[],invalid:any[]=[];for(const [i,e] of raw.episodes.entries()){try{episodes.push(restoreEpisode(checkedEpisode(e,refs),refs))}catch{invalid.push({index:i,reason:'Source, date or quotation validation failed.'})}}records[missing]={episodes,invalid,read_messages:batch.length,model_calls:1,input_tokens:metrics.input_tokens,output_tokens:metrics.output_tokens,elapsed_seconds:(Date.now()-start)/1000};if(!cache)throw Error('Durable conversation cache is unavailable.');await cache.put(keys[missing],records[missing]);processed++;
   if(processed<plan.batches.length)return {preparing:true,progress:{processed_batches:processed,total_batches:plan.batches.length,reused_batches:metrics.cache_hits},trace,metrics};
  }
  readingComplete=true;metrics.whole_history_read=true;metrics.reading={batches:records.length,extraction_omissions:records.reduce((n:number,r:any)=>n+(r.invalid?.length||0),0),model_calls:records.reduce((n:number,r:any)=>n+(r.model_calls||0),0),input_tokens:records.reduce((n:number,r:any)=>n+(r.input_tokens||0),0),output_tokens:records.reduce((n:number,r:any)=>n+(r.output_tokens||0),0),elapsed_processing_seconds:records.reduce((n:number,r:any)=>n+(r.elapsed_seconds||0),0),includes_reused_batches:true};memories=rankMemories(records.flatMap((r:any)=>r.episodes||[]),question);const byId=new Map(plan.batches.flat().map(m=>[m.id,m]));
  const groups=memories.map(e=>[...e.counter_source_ids,...e.source_ids].map(id=>byId.get(id)).filter(Boolean) as Message[]);const selected:Message[]=[];const ids=new Set<string>();
  for(let i=0;i<Math.max(0,...groups.map(g=>g.length));i++)for(const group of groups){const m=group[i];if(m&&!ids.has(m.id)&&tokenCount(aliasEvidence([...selected,m]).packet)<=14000){selected.push(m);ids.add(m.id)}}
  evidence=selected.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||a.start-b.start);
  const terms=searchTerms(question).filter(t=>!['what','when','where','which','does','did','have','they','their','about','tell','know','said','could','would','this','from','ever','how','who','her','she'].includes(t));
  const relevant=terms.length>0&&memories.some(e=>terms.some(t=>(e.situation+' '+e.interpretation+' '+e.clues).toLowerCase().includes(t)));
  const broad=/\b(how often|how many|ever|never|always|change[ds]?|over time|all|every|frequency|pattern)\b|幾多次|有冇試過|一直|變化|有冇變|從來|每次|所有|模式/i.test(question);
  if(!relevant||broad){originalSearch=searchConversationOriginals(plan.messages,question);usedOriginalSearch=true;trace.push({stage:'original_message_search',trigger:broad?'broad_or_change_question':'no_relevant_saved_note',searched_messages:originalSearch.searched_messages,matching_messages:originalSearch.matching_messages,selected_messages:originalSearch.messages.length,method:'lexical'});if(originalSearch.messages.length){evidence=originalSearch.messages;memories=[];usingOriginalEvidence=true;}}
 }
 const answerWithEvidence=async():Promise<any>=>{
 const {packet,refs}=aliasEvidence(evidence);const reverse=new Map(evidence.map((m,i)=>[m.id,'m'+(i+1)]));
 const memoryPacket=memories.map(e=>({...e,quote_source_id:e.quote_source_id?reverse.get(e.quote_source_id)||'':undefined,source_ids:e.source_ids.filter(id=>reverse.has(id)).map(id=>reverse.get(id)),counter_source_ids:e.counter_source_ids.filter(id=>reverse.has(id)).map(id=>reverse.get(id)),unavailable_reference_count:[...e.source_ids,...e.counter_source_ids].filter(id=>!reverse.has(id)).length}));
 const coverage={mode:plan.full?'full_context':usingOriginalEvidence?'original_lexical_search':'cached_exchanges_and_selected_originals',original_search:originalSearch?{method:'lexical',searched_messages:originalSearch.searched_messages,matching_messages:originalSearch.matching_messages,selected_messages:originalSearch.messages.length}:undefined,messages_in_scope:messages.length,all_messages_read:readingComplete,originals_for_answer:evidence.length,selected_memories:memories.length,extraction_omissions:metrics.reading?.extraction_omissions||0};metrics.coverage=coverage;
 const response=await ask('conversation_answer',{...base,evidence:packet,memory_candidates:memoryPacket,coverage});
 if(!response||typeof response!=='object'||Array.isArray(response))throw Error('Invalid conversation answer schema: expected an object.');
 const omitted:any[]=[];const section=(key:string,max:number)=>{const v=response[key];if(!Array.isArray(v)||v.length>max){omitted.push({id:'section_'+key,reason:`Invalid ${key} section; omitted before review.`});return [];}return v;};
 const textField=(key:string,max:number)=>{const v=response[key];if(typeof v!=='string'||v.length>max){omitted.push({id:'section_'+key,reason:`Invalid ${key} field; omitted before review.`});return '';}return v;};
 const draft={overview:textField('overview',1200),episodes:section('episodes',16),findings:section('findings',6),patterns:section('patterns',4),next_question:textField('next_question',2000)};
 if(!draft.overview.trim()&&!draft.episodes.length&&!draft.findings.length&&!draft.patterns.length&&/[?？]$/.test(draft.next_question.trim())){
  metrics.outcome='needs_clarification';metrics.elapsed_seconds=(Date.now()-start)/1000;trace.push({stage:'input_clarification',model_called:true});
  return {response_language:responseLanguage(question),status:'needs clarification',findings:[],episodes:[],patterns:[],candidates:[],next_question:draft.next_question,trace,metrics};
 }
 // Provider-generated limits are intentionally not displayed; scope comes from server facts.
 if(omitted.length)trace.push({stage:'answer_schema_omissions',fields:omitted.map(x=>x.id)});
 const items:any[]=[];const add=(id:string,type:string,value:any,sourceIds:string[],counterIds:string[]=[])=>{for(const ref of [...sourceIds,...counterIds])if(!refs.has(ref))throw Error('Item source is outside the supplied originals.');items.push({id,type,value,source_ids:sourceIds,counter_source_ids:counterIds})};
 const episodeIds=new Set<string>();
 for(const [i,e] of draft.episodes.entries()){try{const checked=checkedEpisode(e,refs);if(episodeIds.has(checked.id))throw Error('Duplicate episode ID.');episodeIds.add(checked.id);add('episode_'+i,'episode',checked,checked.source_ids,checked.counter_source_ids)}catch(err){omitted.push({id:'episode_'+i,reason:err instanceof Error?err.message:'Invalid episode'})}}
 for(const [i,f] of draft.findings.entries()){try{if(typeof f.text!=='string'||f.text.length>900||!Array.isArray(f.citations))throw Error('Invalid finding');const sourceIds=f.citations.map((c:any)=>c.id);const value={...f,citations:sourceIds.map((id:string)=>originalCitation(refs.get(id)!))};add('finding_'+i,'finding',value,sourceIds);validate({status:'answered',findings:[value],next_question:''},evidence)}catch(err){const index=items.findIndex(x=>x.id==='finding_'+i);if(index>=0)items.splice(index,1);omitted.push({id:'finding_'+i,reason:err instanceof Error?err.message:'Finding source or schema check failed.'})}}
 for(const [i,p] of draft.patterns.entries()){try{if(typeof p.text!=='string'||p.text.length>900||!Array.isArray(p.source_ids)||!Array.isArray(p.counter_source_ids)||p.source_ids.some((id:string)=>!refs.has(id))||new Set(p.source_ids.map((id:string)=>refs.get(id)!.timestamp.slice(0,10))).size<2)throw Error('Pattern needs multiple dated exchanges.');add('pattern_'+i,'pattern',p,p.source_ids,p.counter_source_ids)}catch{omitted.push({id:'pattern_'+i,reason:'Pattern lacked dated support or valid references.'})}}
 const allIds=[...new Set(items.flatMap(i=>[...i.source_ids,...i.counter_source_ids]))];
 if(draft.overview.trim())add('overview','overview',{text:draft.overview},allIds);
 if(/[?？]$/.test(draft.next_question.trim()))add('next_question','next_question',{text:draft.next_question},allIds);
 const reviewMessages=[...evidence];if(!plan.full){const chosen=new Set(evidence.map(m=>m.id));const originals=plan.messages;for(const m of evidence){const index=originals.findIndex(x=>x.id===m.id.split('@')[0]);for(const nearby of originals.slice(Math.max(0,index-3),index+4)){if(nearby.source_id===m.source_id&&!chosen.has(nearby.id)&&tokenCount(aliasEvidence([...reviewMessages,nearby]).packet)<=16000){reviewMessages.push(nearby);chosen.add(nearby.id)}}}}const reviewPacket=aliasEvidence(reviewMessages).packet;
 const accepted:any[]=[];
 // Only exact source text can bypass semantic review. Paraphrases and
 // interpretations still receive one combined, item-by-item review.
 const needsReview:any[]=[];
 for(const item of items){
  const literal=literalLookup&&item.type==='finding'&&item.value.kind==='evidence'&&item.value.support==='directly stated'&&item.source_ids.length===1&&refs.get(item.source_ids[0])!.body.includes(item.value.text)&&item.value.text.trim().length>0;
  if(literal)accepted.push({...item,review_status:'source_checked',review_note:'Exact text matched the cited original; no semantic review.'});
  else needsReview.push(item);
 }
 metrics.review_mode=needsReview.length?'single_targeted_review':'source_checks_only';
 metrics.source_checked_items=accepted.length;
 if(options.variant==='A'){omitted.push(...needsReview.map(i=>({id:i.id,reason:'Fixed retrieval (A) does not perform semantic review. Use a verified workflow for interpretive episodes.'})));}
 else if(needsReview.length){try{const verdict=await ask('conversation_check',{...base,prior_room_context:[],items:needsReview,evidence:reviewPacket,coverage:{...coverage,originals_for_review:reviewMessages.length,review_context:plan.full?'complete scoped conversation':'selected originals plus deterministic neighboring turns; long-context selection is not exhaustive'}});const reviewed=applyItemReviews(needsReview,verdict);accepted.push(...reviewed.accepted);omitted.push(...reviewed.omitted)}catch(err){omitted.push(...needsReview.map(i=>({id:i.id,reason:err instanceof Error?err.message:'Review failed.'})));trace.push({stage:'item_review_failure',items:needsReview.map(i=>i.id),reason:err instanceof Error?err.message:'Review failed.'})}}

 const episodes=accepted.filter(i=>i.type==='episode').map(i=>({...episodeView(i.value,refs),review_status:i.review_status,review_note:i.review_note}));
 const findings=accepted.filter(i=>i.type==='finding').map(i=>({...i.value,...(i.review_status==='qualified'?{kind:'inference',support:'tentative'}:{})}));
 const patterns=accepted.filter(i=>i.type==='pattern').map(i=>({text:i.value.text,support:'tentative',citations:i.source_ids.map((id:string)=>originalCitation(refs.get(id)!)),counter_citations:i.counter_source_ids.map((id:string)=>originalCitation(refs.get(id)!)),review_note:i.review_note}));
 const substantive=episodes.length+findings.length+patterns.length;metrics.omitted_items=omitted.length;metrics.elapsed_seconds=(Date.now()-start)/1000;metrics.unique_messages=evidence.length;metrics.outcome=substantive?(needsReview.length?'checked_conversation_answer':'source_checked_answer'):'no_checked_items';trace.push({stage:'item_verdicts',accepted:accepted.map(i=>i.id),omitted});
 return {response_language:responseLanguage(question),status:omitted.length||!substantive?'partial':'answered',overview:substantive?accepted.find(i=>i.type==='overview')?.value.text||'':'',episodes,patterns,findings,candidates:[],next_question:accepted.find(i=>i.type==='next_question')?.value.text||'',analysis_scope:coverage,limits:coverage.mode==='full_context'?(responseLanguage(question)==='yue-Hant'?`已向分析同覆核提供所選範圍全部 ${messages.length} 則訊息。語氣同感受係按對話作出嘅解讀，未能證實內心狀態。`:`All ${messages.length} scoped messages were supplied to generation and contextual review. Tone and feelings are interpretations of the conversation, not verified internal states.`):(responseLanguage(question)==='yue-Hant'?`已處理所選範圍 ${messages.length} 則訊息；回答使用 ${evidence.length} 則原文${usingOriginalEvidence?'，並以關鍵詞搜尋原文':usedOriginalSearch?'及已選摘要；原文關鍵詞搜尋沒有匹配':'及已選摘要'}。抽取時有 ${coverage.extraction_omissions} 項未通過檢查；搜尋未必找齊相關內容，未列出唔代表冇出現。` :`Reading covered ${messages.length} scoped messages; this answer uses ${evidence.length} selected originals${usingOriginalEvidence?', selected by a lexical search across the originals':usedOriginalSearch?' and cached extracts; a lexical search of originals returned no matches':' and cached extracts'}. ${coverage.extraction_omissions} extracted items failed validation. Lexical search can miss relevant evidence; omission does not establish absence.`),trace,metrics,...(!substantive?{analysis_notice:'No items completed source and interpretation checks. Inspect the trace or retry; no unrelated general advice was substituted.'}:{})};
 };
 let result=await answerWithEvidence();
 if(!plan.full&&!usedOriginalSearch&&result.metrics.outcome==='no_checked_items'){
  originalSearch=searchConversationOriginals(plan.messages,question);usedOriginalSearch=true;trace.push({stage:'original_message_search',trigger:'no_checked_answer',searched_messages:originalSearch.searched_messages,matching_messages:originalSearch.matching_messages,selected_messages:originalSearch.messages.length,method:'lexical'});
  if(originalSearch.messages.length){evidence=originalSearch.messages;memories=[];usingOriginalEvidence=true;result=await answerWithEvidence();}
  else{result.analysis_scope={...result.analysis_scope,original_search:{method:'lexical',searched_messages:originalSearch.searched_messages,matching_messages:0,selected_messages:0}};result.metrics.coverage=result.analysis_scope;result.limits+=' A lexical search across original messages found no matching terms; this does not establish absence.';}
 }
 return result;
 }catch(err){metrics.elapsed_seconds=(Date.now()-start)/1000;metrics.outcome='conversation_technical_failure';trace.push({stage:'technical_failure',reason:err instanceof Error?err.message:'Conversation analysis failed.'});return {status:'partial',findings:[],episodes:[],patterns:[],candidates:[],next_question:'',analysis_notice:(err instanceof Error?err.message:'Conversation analysis could not finish.')+(metrics.cache_hits||metrics.reading?' Completed reading batches are saved.':''),trace,metrics};}
}
