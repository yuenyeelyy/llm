// Actual ask-route control flow with isolated synthetic identity/DB/provider
// boundaries. No network requests, credentials, paid inference or real writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const mock=`
export const records={calls:[],profiles:[{id:'qa',version:1,name:'Synthetic QA',relationship:'Friend',context:''}],messages:[{id:'a',profile_id:'qa',source_id:'file-a',timestamp:'2026-11-01T10:00:00',speaker:'QA',body:'Synthetic A',start:0,end:11},{id:'b',profile_id:'qa',source_id:'file-b',timestamp:'2026-11-02T10:00:00',speaker:'QA',body:'Synthetic B',start:0,end:11}]};
export class HttpError extends Error{constructor(status,message){super(message);this.status=status}}
export class AgentError extends Error{}
export async function identity(){return 'qa-owner'}
export function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})}
export function error(e){return json({error:e.message},e.status||500)}
export function input(r){return r.json()}
export const providerReady=()=>true,resolveProvider=async()=> 'poe-sonnet';
export async function authorisedMessages(){return records.messages}
export function questionRoom(ids,from='',to='',sources=[]){return [ids,from,to,sources].join(':')}
export function packRoomContext(){return []}
export function db(){return {prepare(sql){return {args:[],bind(...args){this.args=args;return this},async all(){if(sql.includes('FROM profiles'))return {results:records.profiles.filter(p=>this.args.slice(1).includes(p.id))};if(sql.includes('SELECT id FROM sources'))return {results:[{id:'file-a'},{id:'file-b'}]};return {results:[]}},async first(){return null},async run(){return {meta:{changes:1}}}}}}}
export async function runConversation(o){records.calls.push(o);return {status:'answered',findings:[],trace:[],metrics:{model_calls:0}}}
export const runMessageDraft=runConversation,runAgent=runConversation;export const runPeopleQuestion=o=>runConversation({...o,test_engine:"people"});
export function hybridRetrieve(){throw Error('Unexpected legacy path')}
export const retrieveNetwork=async(owner,profiles,messages)=>({messages,revision:"synthetic-network",scope:{selected_people:profiles.length}}),evidenceTool=hybridRetrieve;
export function networkEvidence(){throw Error('Unexpected network path')}
`;
const entry=`import {POST} from './app/api/ask/route.ts';import {records} from '@/lib/service';export {POST,records};`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'qa-api-entry.ts'},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'qa-mocks',setup(b){b.onResolve({filter:/^@\/lib\//},()=>({path:'qa-mock',namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:mock}));}}]});
const {POST,records}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const base={profileIds:['qa'],question:'Synthetic question',variant:'C',kind:'chat',provider:'poe-sonnet'};
const call=patch=>POST(new Request('http://localhost/api/ask',{method:'POST',body:JSON.stringify({...base,...patch})}));

for(const [name,patch,status] of [
 ['empty question',{question:''},400],
 ['reversed date range',{from:'2026-11-03',to:'2026-11-01'},400],
 ['foreign profile',{profileIds:['foreign']},403],
 ['foreign imported file',{sourceIds:['foreign-file']},403],
 ['invalid imported-file type',{sourceIds:'file-a'},400],
])test(`Ask route rejects ${name} before invoking analysis`,async()=>{
 const before=records.calls.length;
 assert.equal((await call(patch)).status,status);
 assert.equal(records.calls.length,before);
});

test('Ask route supplies only the authorised selected file to analysis',async()=>{
 assert.equal((await call({sourceIds:['file-a']})).status,200);
 assert.deepEqual(records.calls.at(-1).messages.map(m=>m.id),['a']);
});
test('Ask route supplies only messages within the selected date range',async()=>{
 assert.equal((await call({from:'2026-11-02',to:'2026-11-02'})).status,200);
 assert.deepEqual(records.calls.at(-1).messages.map(m=>m.id),['b']);
});

test("Network question reaches independently reviewed people engine",async()=>{records.calls=[];const r=await call({kind:"network"});assert.equal(r.status,200);assert.equal(records.calls.length,1);assert.equal(records.calls[0].test_engine,"people");});

test('Standalone farewells bypass both fixed and adaptive analysis',async()=>{for(const variant of ['A','C']){const before=records.calls.length;const res=await call({variant,question:'bye'});assert.equal(res.status,200);const turn=await res.json();const answer=JSON.parse(turn.answer);assert.equal(answer.metrics.model_calls,0);assert.equal(answer.analysis_notice,'Goodbye! Talk to you next time.');assert.equal(records.calls.length,before)}});
