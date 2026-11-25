import {DEFAULT_PROVIDER,type Provider} from './provider-policy';
import {providerReady} from './model-config';
import {HttpError} from './service';
type Catalogue={ids:Set<string>;known:boolean};
let cached:(Catalogue&{until:number})|undefined;
let pending:Promise<Catalogue>|undefined;
async function catalogue():Promise<Catalogue>{
 if(cached&&cached.until>Date.now())return cached;
 pending||=(async()=>{try{const r=await fetch('https://api.poe.com/v1/models',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Catalogue unavailable');const d:any=await r.json();if(!Array.isArray(d.data))throw Error('Invalid catalogue');return {ids:new Set<string>(d.data.map((m:any)=>String(m.id).toLowerCase())),known:true};}catch{return {ids:new Set<string>(),known:false};}})();
 const result=await pending;pending=undefined;cached={...result,until:Date.now()+(result.known?300000:30000)};return cached;
}
export async function modelServices(){
 const models=providerReady('poe')?await catalogue():{ids:new Set<string>(),known:true};
 const providers={'openrouter-nemotron':providerReady('openrouter-nemotron'),hku:providerReady('hku'),poe:providerReady('poe'),'poe-gemini':providerReady('poe-gemini')&&models.ids.has('gemini-3.1-pro'),'poe-luna':providerReady('poe-luna')&&models.ids.has('gpt-6-luna'),'poe-sonnet':providerReady('poe-sonnet')&&models.ids.has('claude-sonnet-5.5')};
 const active:Provider=providers[DEFAULT_PROVIDER]?DEFAULT_PROVIDER:providers.poe?'poe':DEFAULT_PROVIDER;
 return {providers,default_provider:DEFAULT_PROVIDER,active_default_provider:active,model_notice:providers[DEFAULT_PROVIDER]?'':providers.poe?'Claude Sonnet 5.5 API availability could not be confirmed. GPT-5.4 is the active fallback.':'Configure your saved Poe API key to use Claude Sonnet 5.5.',luna_catalogue_verified:models.known};
}
export async function resolveProvider(value:unknown):Promise<Provider>{
 if(value===undefined||value===null||value==='')return (await modelServices()).active_default_provider;
 if(!['hku','poe','poe-luna','poe-sonnet','poe-gemini','openrouter-nemotron'].includes(String(value)))throw new HttpError(400,'Choose a supported model service.');
 if((value==='poe-luna'||value==='poe-sonnet'||value==='poe-gemini')&&!(await modelServices()).providers[value])throw new HttpError(503,`Poe ${value==='poe-luna'?'GPT-6 Luna':value==='poe-gemini'?'Gemini 3.1 Pro':'Claude Sonnet 5.5'} is not currently available through this API. Select another service; no model request was made.`);
 return value as Provider;
}
