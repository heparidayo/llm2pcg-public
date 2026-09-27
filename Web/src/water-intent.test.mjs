import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultRequest,validatePcgRequest} from '../../Shared/pcg-request.mjs';
import {createWebServer,finalizePcgInterpretation,resolveNaturalDraft} from './server.mjs';
import {proposeV4Migration} from './migrate-v3-to-v4.mjs';

const prompt='넓은 사막 만들어. 대신 가운데에 강이 남북을 관통하게 흘러야해';
test('the reported Desert request preserves its central north-south river, including provider fallback',()=>{
  for(const candidate of [defaultRequest('Desert'),null]) {
    const result=resolveNaturalDraft(prompt,candidate,{reason:candidate?undefined:'INTERPRETATION_UNAVAILABLE'});
    assert.equal(result.request.worldType,'Desert');assert.equal(validatePcgRequest(result.request),null);
    assert.deepEqual(result.request.layoutSettings.water,{kind:'River',placement:'CenterNorthSouth',size:'Medium',meander:'Low',exclusive:false});
    assert.ok(!result.interpretation.warnings.some(w=>w.code==='UNSUPPORTED_SPATIAL_LAYOUT'));
  }
});
test('direction, water scope and negation do not silently move or invent rivers',()=>{
  for(const [text,placement] of [['중앙을 동서로 가로지르는 강이 있는 사막','CenterEastWest'],['desert with a river from north to south','CenterNorthSouth']])
    assert.equal(finalizePcgInterpretation(text,defaultRequest('Desert')).request.layoutSettings.water.placement,placement);
  assert.equal(resolveNaturalDraft('사막 강 밖의 물은 없게',null).request.layoutSettings.water.exclusive,true);
  assert.equal(resolveNaturalDraft('강 없이 사막',null).request.layoutSettings.water.kind,'Default');
  for(const text of ['동쪽에 강이 있는 사막','여러 강이 있는 사막'])
    assert.equal(resolveNaturalDraft(text,null).request.layoutSettings.water.kind,'Default');
  assert.ok(resolveNaturalDraft('중앙 강이 있는 도시',null).interpretation.warnings.some(w=>w.code==='UNSUPPORTED_WATER_WORLD'));
  assert.throws(()=>proposeV4Migration(resolveNaturalDraft(prompt,null).request),{code:'MIGRATION_REQUIRES_REVIEW'});
});
test('main Unity endpoint forwards the supported river even when AI is unavailable',async t=>{
  let received;
  const server=createWebServer({requestPcg:async()=>{throw Error('AI unavailable');},sendDiagnosticsToUnity:async()=>{},sendRequestToUnity:async request=>{received=request;return {status:202,payload:{ok:true}};}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/unity/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});
  const result=await response.json();assert.equal(response.status,202);assert.equal(result.ok,true);
  assert.deepEqual(result.request,received);assert.equal(received.layoutSettings.water.kind,'River');
  assert.equal(result.aiDelivery.fallbackUsed,true);assert.equal(result.aiDelivery.fallbackReason,'INTERPRETATION_UNAVAILABLE');
});
test('retired Spatial v4 UI redirects to Unity and its default APIs never call the provider',async t=>{
  let calls=0;
  const server=createWebServer({v4Options:{requestIntent:async()=>{calls++;throw Error('must not call');}}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  const page=await fetch(base+'/spatial-v4',{redirect:'manual'});assert.equal(page.status,308);assert.equal(page.headers.get('location'),'/unity');
  assert.equal((await fetch(base+'/spatial-v4.js')).status,404);
  const response=await fetch(base+'/api/v4/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});
  assert.equal(response.status,410);assert.equal((await response.json()).code,'SPATIAL_V4_RETIRED');assert.equal(calls,0);
  assert.equal((await fetch(base+'/unity')).status,200);
});
