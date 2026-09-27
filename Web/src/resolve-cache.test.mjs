import test from 'node:test';import assert from 'node:assert/strict';
import {createResolveCache} from './resolve-cache.mjs';
import {handleV4} from './spatial-v4-api.mjs';
import {emptyIntent,resolveIntent} from './request-resolver.mjs';
test('concurrent and later retries reuse one interpretation and seed; changed input conflicts',async()=>{
 let calls=0,seeds=0;const options={resolveCache:createResolveCache(),requestIntent:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return emptyIntent();},seedFactory:()=>{seeds++;return 72;}};
 const body={prompt:'숲',requestId:'retry-test-00000001'};
 const results=await Promise.all(Array.from({length:4},()=>handleV4('/api/v4/resolve',body,options)));
 assert.equal(calls,1);assert.equal(seeds,1);
 for(const r of results)assert.deepEqual({...r,aiDelivery:undefined},{...results[0],aiDelivery:undefined});
 assert.equal(results[0].aiDelivery.reused,false);assert.ok(results.slice(1).every(r=>r.aiDelivery.reused));
 results[0].request.seed=3;assert.equal((await handleV4('/api/v4/resolve',body,options)).request.seed,72);
 await assert.rejects(()=>handleV4('/api/v4/resolve',{...body,prompt:'사막'},options),{code:'REQUEST_ID_CONFLICT'});
});
test('failed work remains cached and full caches refuse instead of evicting',async()=>{
 const cache=createResolveCache(1);let calls=0;const work=()=>{calls++;throw Error('timeout');};
 await assert.rejects(()=>cache.run('retry-test-00000001','x',work));await assert.rejects(()=>cache.run('retry-test-00000001','x',work));assert.equal(calls,1);
 assert.throws(()=>cache.run('retry-test-00000002','y',work),{code:'RESOLVE_CACHE_FULL'});
 assert.throws(()=>cache.run('short','x',work),{code:'INVALID_REQUEST_ID'});
});
test('seed variation preserves every other field, avoids equal seed, and replays retries',async()=>{
 const request=resolveIntent({...emptyIntent(),seed:2147483647}).request;let calls=0;
 const options={resolveCache:createResolveCache(),seedFactory:()=>{calls++;return 2147483647;},requestIntent:()=>{throw Error('Must not call LLM');}};
 const body={request,requestId:'variation-00000001'};
 const first=await handleV4('/api/v4/new-seed',body,options),again=await handleV4('/api/v4/new-seed',body,options);
 assert.deepEqual(first,again);assert.equal(calls,1);assert.equal(first.request.seed,-2147483648);assert.deepEqual({...first.request,seed:request.seed},request);
 assert.equal(request.seed,2147483647);
});
