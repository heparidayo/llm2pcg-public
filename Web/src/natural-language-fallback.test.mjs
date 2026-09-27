import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultRequest,validatePcgRequest} from '../../Shared/pcg-request.mjs';
import {repairNaturalDraft} from './natural-language-fallback.mjs';
import {resolveNaturalDraft,createWebServer} from './server.mjs';

test('malformed Dungeon and City drafts preserve explicit intent while reporting substitutions',()=>{
  for(const world of ['Dungeon','City']) {
    const candidate=defaultRequest(world,999,96,96);
    if(world==='Dungeon') {candidate.generatorSettings.dungeon.maxDepth=999;candidate.specialRooms.boss={enabled:true,count:1,placement:'FarthestFromStart'};}
    else candidate.generatorSettings.city.buildingMinHeight=999;
    const prompt=world==='Dungeon'?'64x64 던전, 보스방 하나, 시드 234':'64x64 중앙에 큰 산이 있는 도시, 시드 234';
    const result=resolveNaturalDraft(prompt,candidate);
    assert.equal(validatePcgRequest(result.request),null);
    assert.equal(result.request.worldType,world);
    assert.equal(result.request.seed,234);
    assert.equal(result.request.mapWidth,64);
    assert.equal(result.interpretation.fallback.used,true);
    assert.ok(result.interpretation.warnings.some(w=>w.code==='DEFAULTS_APPLIED'));
    if(world==='Dungeon') assert.equal(result.request.specialRooms.boss.enabled,true);
    else {
      assert.equal(result.request.layoutSettings.landform.kind,'None');
      assert.ok(result.interpretation.warnings.some(w=>w.code==='UNSUPPORTED_LANDFORM_WORLD'));
    }
  }
});

test('valid drafts stay unchanged by repair and are not marked as fallback',()=>{
  for(const world of ['Dungeon','Cave','Forest','City','Swamp','Snowfield','Desert']) {
    const candidate=defaultRequest(world,345,64,96),before=structuredClone(candidate);
    const result=repairNaturalDraft('',candidate);
    assert.deepEqual(result.request,candidate,world);
    assert.deepEqual(candidate,before);
    assert.deepEqual(result.replacements,[]);
  }
});

test('one broken field does not erase valid model choices or explicit supported intent',()=>{
  const candidate=defaultRequest('Forest',999,64,80);
  candidate.generatorSettings.forest.noiseOctaves=999;
  candidate.generatorSettings.forest.elevationScale=12;
  candidate.visualSettings.trees.allowedTypes=['cherry_blossom','dragon'];
  const before=structuredClone(candidate);
  const result=resolveNaturalDraft('중앙 큰 산 숲. 시드 -17, 나무는 벚꽃만 최대 12그루, 바위 없이',candidate);
  assert.equal(validatePcgRequest(result.request),null);
  assert.equal(result.request.generatorSettings.forest.noiseOctaves,4);
  assert.equal(result.request.generatorSettings.forest.elevationScale,12);
  assert.equal(result.request.mapHeight,80);
  assert.equal(result.request.seed,-17);
  assert.equal(result.request.layoutSettings.landform.kind,'Mountain');
  assert.deepEqual(result.request.visualSettings.trees.allowedTypes,['cherry_blossom']);
  assert.equal(result.request.visualSettings.trees.maxCount,12);
  assert.equal(result.request.visualSettings.rocks.density,0);
  assert.deepEqual(candidate,before);
});

test('unreadable drafts and unsupported world types use deterministic defaults',()=>{
  for(const candidate of [null,undefined,[],42,'broken',{}, {worldType:'Space'}]) {
    const a=resolveNaturalDraft('???',candidate),b=resolveNaturalDraft('???',candidate);
    assert.equal(validatePcgRequest(a.request),null);
    assert.equal(a.request.worldType,'Forest');
    assert.equal(a.request.seed,234);
    assert.equal(a.request.mapWidth,128);
    assert.deepEqual(a,b);
  }
  assert.equal(resolveNaturalDraft('설원 만들어줘',null).request.worldType,'Snowfield');
  assert.equal(resolveNaturalDraft('숲 같은 도시',null).request.worldType,'City');
});

test('out-of-range explicit numbers use bounded defaults while valid dimensions and exclusions survive',()=>{
  const {request,interpretation}=resolveNaturalDraft('시드 2147483648, 1000000x64 숲, 나무 밀도 120%, 바위 없이, waterThreshold 2',null);
  assert.equal(validatePcgRequest(request),null);
  assert.equal(request.seed,234);assert.equal(request.mapWidth,128);assert.equal(request.mapHeight,64);
  assert.equal(request.visualSettings.trees.density,1);assert.equal(request.visualSettings.rocks.density,0);
  assert.equal(request.generatorSettings.forest.waterThreshold,.2);
  for(const path of ['seed','mapWidth','visualSettings.trees.density','generatorSettings.forest.waterThreshold'])
    assert.ok(interpretation.fallback.replacements.some(r=>r.path===path),path);
});

test('cross-field repairs cover incompatible branches, profiles, rooms, dimensions and building heights',()=>{
  const dungeon=defaultRequest('Dungeon',234,16,16);
  dungeon.generatorSettings.dungeon.minLeafSize=200;
  dungeon.generatorSettings.city=defaultRequest('City').generatorSettings.city;
  dungeon.specialRooms.boss={enabled:true,count:1,placement:'FarthestFromStart'};
  dungeon.specialRooms.shop=null;
  dungeon.specialRooms.secret.placement='   ';
  dungeon.generationProfile='DuneSea';
  const fixed=repairNaturalDraft('',dungeon).request;
  assert.equal(validatePcgRequest(fixed),null);
  assert.equal(fixed.generatorSettings.dungeon.minLeafSize,10);
  assert.equal(fixed.generatorSettings.city,null);
  assert.equal(fixed.specialRooms.boss.enabled,true);
  assert.equal(fixed.specialRooms.shop.enabled,false);
  assert.equal(fixed.specialRooms.secret.placement,'FarthestFromStart');
  const city=defaultRequest('City');city.generatorSettings.city.buildingMinHeight=120;
  assert.equal(validatePcgRequest(repairNaturalDraft('',city).request),null);
});

test('malformed values in every numeric generator field cannot escape the fallback guard',()=>{
  for(const world of ['Dungeon','Cave','Forest','City','Swamp','Snowfield','Desert']) {
    const base=defaultRequest(world,234,64,64);
    const branch=Object.keys(base.generatorSettings).find(k=>base.generatorSettings[k]);
    for(const key of Object.keys(base.generatorSettings[branch]))
      for(const value of [null,'oops',NaN,Infinity,-999999,99999999999,1e-100]) {
        const draft=structuredClone(base);draft.generatorSettings[branch][key]=value;
        assert.equal(validatePcgRequest(resolveNaturalDraft('',draft).request),null,world+'/'+key);
      }
  }
});

async function withServer(options,action) {
  const server=createWebServer(options);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const post=async(path,body)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {await action(post);} finally {await new Promise(r=>server.close(r));}
}

test('both natural-language endpoints generate after invalid JSON, refusal, timeout, missing key or network failure',async()=>{
  for(const code of ['OPENAI_INVALID_JSON','OPENAI_REFUSAL','OPENAI_INCOMPLETE_RESPONSE','OPENAI_API_KEY_MISSING','OPENAI_REQUEST_FAILED','TimeoutError','TypeError']) {
    let calls=0; const diagnostics=[];
    const accept=request=>{calls++;assert.equal(validatePcgRequest(request),null);assert.equal(request.worldType,'Desert');assert.equal(request.seed,17);};
    await withServer({sendDiagnosticsToUnity:async message=>{diagnostics.push(message);},requestPcg:async()=>{throw Object.assign(new Error('provider detail must not leak'),{code});},
      sendRequestToCore:async request=>{accept(request);return {world:{formatVersion:1}};},
      sendRequestToUnity:async request=>{accept(request);return {status:202,payload:{ok:true}};}},async post=>{
      for(const path of ['/api/generate','/api/unity/generate']) {
        const response=await post(path,{prompt:'시드 17, 선인장이 있는 사막'}),body=await response.json();
        assert.equal(response.status,path==='/api/generate'?200:202);
        assert.equal(body.interpretation,undefined);
        assert.ok(!JSON.stringify(body).includes('provider detail'));
      }
    });
    assert.equal(calls,2);
    assert.equal(diagnostics.length,2);assert.ok(diagnostics.every(m=>m.includes('INTERPRETATION_UNAVAILABLE')));
  }
});

test('empty text skips the provider; malformed transport and direct JSON are still rejected',async()=>{
  let calls=0, diagnostic;
  await withServer({sendDiagnosticsToUnity:async message=>{diagnostic=message;},requestPcg:async()=>{calls++;throw new Error('unexpected');},sendRequestToCore:async request=>({world:{formatVersion:1,worldType:request.worldType}})},async post=>{
    const empty=await post('/api/generate',{prompt:'   '});
    assert.equal(empty.status,200);assert.equal((await empty.json()).interpretation,undefined);assert.match(diagnostic,/EMPTY_PROMPT/);
    for(const body of [{},{prompt:42},{prompt:'x'.repeat(4001)}]) assert.equal((await post('/api/generate',body)).status,400);
    assert.equal((await post('/api/generate-direct',{request:{worldType:'Forest'}})).status,400);
  });
  assert.equal(calls,0);
});

test('generation service failures remain errors rather than pretending a map exists',async()=>{
  await withServer({requestPcg:async()=>null,sendRequestToCore:async()=>{throw Object.assign(new Error('offline'),{code:'CORE_HOST_UNAVAILABLE'});}},async post=>{
    const response=await post('/api/generate',{prompt:'숲'});
    assert.equal(response.status,503);assert.equal((await response.json()).ok,false);
  });
});
