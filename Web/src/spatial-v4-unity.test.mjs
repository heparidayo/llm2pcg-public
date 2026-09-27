import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebServer} from './server.mjs';
import {emptyIntent,resolveIntent} from './request-resolver.mjs';
import {sendV4ToUnity} from './spatial-v4-unity.mjs';
import {parseStrictJson} from '../../Shared/strict-json.mjs';
const request=resolveIntent({...emptyIntent(),seed:234}).request;
const receipt={ok:true,target:'unity-editor-preview',worldHash:'a'.repeat(64),semanticHash:'b'.repeat(64),rendering:{completed:true,counts:[]}};
test('strict JSON rejects decoded duplicate keys and preserves Korean/escaped literals',()=>{
  assert.deepEqual(parseStrictJson('{"prompt":"숲 \\"test\\"","nested":[{"seed":1},{"seed":2}]}'),{prompt:'숲 "test"',nested:[{seed:1},{seed:2}]});
  for(const raw of ['{"seed":1,"seed":2}','{"seed":1,"se\\u0065d":2}','{"a":{"x":1,"x":2}}','{"seed":01}', '[]'.repeat(2)])assert.throws(()=>parseStrictJson(raw));
});
test('Unity v4 forwards exact request and requires render completion',async()=>{
  let body,headers;
  assert.deepEqual(await sendV4ToUnity(request,{fetchImplementation:async(_url,options)=>{body=JSON.parse(options.body);headers=options.headers;return Response.json(receipt);}}),receipt);
  assert.deepEqual(body,request);assert.equal(headers['X-PCG-V4'],'1');
  await assert.rejects(()=>sendV4ToUnity(request,{fetchImplementation:async()=>Response.json({ok:true})}),{code:'INVALID_UNITY_V4_RECEIPT'});
  await assert.rejects(()=>sendV4ToUnity({...request,seed:undefined}),{code:'INVALID_V4_REQUEST'});
});
test('Unity v4 preserves busy/size errors and reports unavailable without retries',async()=>{
  for(const status of [400,422,429,504])await assert.rejects(()=>sendV4ToUnity(request,{fetchImplementation:async()=>Response.json({ok:false,code:'EXPECTED'},{status})}),{status,code:'EXPECTED'});
  let calls=0;await assert.rejects(()=>sendV4ToUnity(request,{fetchImplementation:async()=>{calls++;throw Error('offline');}}),{code:'UNITY_V4_UNAVAILABLE'});assert.equal(calls,1);
});
test('explicit developer v4 API rejects cross-origin writes; retired UI stays unavailable',async t=>{
  let received,calls=0;
  const server=createWebServer({enableExperimentalV4:true,v4Options:{sendUnityV4:async r=>{received=r;calls++;return receipt;},readUnityV4:async()=>({ok:true,maximumMapSize:256})}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request})};
  assert.equal((await fetch(base+'/api/v4/generate-unity',options)).status,200);assert.deepEqual(received,request);
  const duplicate='{"request":'+JSON.stringify(request)+',"request":'+JSON.stringify(request)+'}';
  assert.equal((await fetch(base+'/api/v4/generate-unity',{...options,body:duplicate})).status,400);assert.equal(calls,1);
  assert.equal((await fetch(base+'/api/v4/generate-unity',{...options,headers:{...options.headers,Origin:'https://example.org'}})).status,403);assert.equal(calls,1);
  assert.equal((await fetch(base+'/api/v4/unity-status')).status,200);
  const retired=await fetch(base+'/spatial-v4',{redirect:'manual'});
  assert.equal(retired.status,308);assert.equal(retired.headers.get('location'),'/unity');
  assert.equal((await fetch(base+'/spatial-v4.js')).status,404);
});
