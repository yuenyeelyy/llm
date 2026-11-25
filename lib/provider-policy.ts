export type Provider='hku'|'poe'|'poe-luna'|'poe-sonnet'|'poe-gemini'|'openrouter-nemotron';
export const DEFAULT_PROVIDER:Provider='poe-sonnet';
export function profileRequestTimeout(provider:Provider){return provider==='hku'?90_000:180_000;}
export function profileLeaseTimeout(provider:Provider){return profileRequestTimeout(provider)+30_000;}
export function modelTimeoutMessage(provider:Provider|undefined,stage:string,timeout:number,profileJob=false){
 const name=isPoeProvider(provider)?'Poe':provider==='openrouter-nemotron'?'OpenRouter':provider==='hku'?'HKU':'The model service';
 const action=stage==='summary_observe'?'reading batch':stage==='summary_merge'?'summary consolidation':stage==='summary_check'?'profile check':'model request';
 return `${name} ${action} exceeded ${Math.ceil(timeout/1000)} seconds. ${profileJob?'Any completed batches are saved. Use Continue saved analysis to retry the interrupted work.':'Try your question again.'} No automatic retry was made.`;
}
export function isTimeoutFailure(error:unknown){return error instanceof Error&&(error.name==='TimeoutError'||/timed?\s*out|timeout/i.test(error.message));}

export function isPoeProvider(provider:string|undefined){return provider==='poe'||provider==='poe-luna'||provider==='poe-sonnet'||provider==='poe-gemini';}
