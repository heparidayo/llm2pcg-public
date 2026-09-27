import assert from 'node:assert/strict';
import test from 'node:test';
import {defaultRequest} from '../../Shared/pcg-request.mjs';
import {finalizePcgInterpretation,resolveNaturalDraft,createWebServer} from './server.mjs';

for(const resolve of [finalizePcgInterpretation,resolveNaturalDraft]) {
  test(`${resolve.name}: plain forest restores the previous water cap and preserves forest settings`,()=>{
    const candidate=defaultRequest('Forest',234,128,128);
    candidate.generatorSettings.forest.waterThreshold=.46;
    candidate.generatorSettings.forest.vegetationMaxCount=333;
    candidate.generatorSettings.forest.elevationScale=12;
    candidate.generationProfile='MeadowForest';
    const {request}=resolve('숲 만들어줘',candidate);
    assert.equal(request.generatorSettings.forest.waterThreshold,.20);
    assert.equal(request.generatorSettings.forest.vegetationMaxCount,333);
    assert.equal(request.generatorSettings.forest.elevationScale,12);
    assert.equal(request.generationProfile,'MeadowForest');
    assert.equal(candidate.generatorSettings.forest.waterThreshold,.46);
  });
  for(const [prompt,water,trees] of [
    ['숲',.20,1],['물 없는 숲',0,1],['나무 없는 숲',.20,0],['물과 나무 없는 숲',0,0],
    ['물이 있는 숲',.46,1],['숲에 물 넣어줘',.46,1],['호수가 있는 숲',.46,1],
    ['연못 있는 숲',.46,1],['강이 있는 숲',.46,1],['개울이 있는 숲',.46,1],
    ['forest with water',.46,1],['forest with a lake',.46,1],['forest with a pond',.46,1],
    ['forest with a river',.46,1],['forest with a stream',.46,1],['습한 숲',.46,1],
    ['숲, 물은 적게',.30,1],['숲, 물은 많이',.56,1],['forest without water',0,1],
    ['호수 없는 숲',0,1],['물이 있고 나무 없는 숲',.46,0],['물 없이 나무가 있는 숲',0,1],
    ['숲, waterThreshold 0.24',.24,1],['물이 많은 숲, waterThreshold 0.12',.12,1],
    ['숲, 나무 밀도 25%',.20,.25],['물고기 없는 숲',.20,1],['수초 없는 숲',.20,1],
    ['water plants 없는 숲',.20,1],['강한 햇빛이 드는 숲',.20,1],['식물이 많은 숲',.20,1],
    ['건물이 있는 숲',.20,1],['동물이 많은 숲',.20,1]
  ]) test(`${resolve.name}: ${prompt}`,()=>{
    const {request}=resolve(prompt,defaultRequest('Forest'));
    assert.equal(request.generatorSettings.forest.waterThreshold,water);
    assert.equal(request.visualSettings.trees.density,trees);
  });
}
test('both natural APIs apply explicit water; plain and direct defaults remain .20',async()=>{
  const received=[];
  const server=createWebServer({requestPcg:async()=>defaultRequest('Forest'),
    sendRequestToCore:async r=>{received.push(r);return {world:{}};},
    sendRequestToUnity:async r=>{received.push(r);return {status:202,payload:{ok:true}};}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {
    for(const route of ['generate','unity/generate','generate-direct']) {
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(route==='generate-direct'?{request:defaultRequest('Forest')}:{prompt:'물이 있는 숲'})});
      assert.ok(response.ok);
    }
    assert.deepEqual(received.map(r=>r.generatorSettings.forest.waterThreshold),[.46,.46,.20]);
    assert.equal(resolveNaturalDraft('숲',null).request.generatorSettings.forest.waterThreshold,.20);
    assert.equal(resolveNaturalDraft('물이 있는 숲',null).request.generatorSettings.forest.waterThreshold,.46);
  } finally {await new Promise(r=>server.close(r));}
});
