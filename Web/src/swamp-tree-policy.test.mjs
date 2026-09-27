import assert from 'node:assert/strict';
import test from 'node:test';
import {defaultRequest} from '../../Shared/pcg-request.mjs';
import {finalizePcgInterpretation,resolveNaturalDraft} from './server.mjs';

for (const resolve of [finalizePcgInterpretation, resolveNaturalDraft]) {
  for (const prompt of ['늪지대 만들어줘','나무가 있는 늪지대','a swamp']) {
    test(`${resolve.name}: ${prompt} restores model-disabled trees`,()=>{
      const candidate=defaultRequest('Swamp',234,128,128);
      candidate.generatorSettings.forest.vegetationMaxCount=0;
      candidate.generatorSettings.forest.vegetationMinDistance=32;
      candidate.visualSettings.trees={density:0,maxCount:1,allowedTypes:['palm']};
      candidate.presentationSettings.propsEnabled=false;
      const {request}=resolve(prompt,candidate);
      assert.deepEqual(request.visualSettings.trees,{density:1,maxCount:0,allowedTypes:[]});
      assert.equal(request.generatorSettings.forest.vegetationMaxCount,500);
      assert.equal(request.generatorSettings.forest.vegetationMinDistance,4.5);
      assert.equal(request.presentationSettings.propsEnabled,true);
      assert.equal(candidate.generatorSettings.forest.vegetationMaxCount,0);
    });
  }
  for (const prompt of ['나무 없는 늪지대','나무를 빼고 늪지대 만들어줘','swamp without trees','늪지대, 나무 밀도 0%','늪지대, 나무 0그루']) {
    test(`${resolve.name}: ${prompt} stays treeless`,()=>{
      assert.equal(resolve(prompt,defaultRequest('Swamp')).request.visualSettings.trees.density,0);
    });
  }
  test(`${resolve.name}: scoped swamp density and cap survive`,()=>{
    const {request}=resolve('늪지대, 나무는 적게 최대 12그루, 바위 없이',defaultRequest('Swamp'));
    assert.equal(request.visualSettings.trees.density,.35);
    assert.equal(request.visualSettings.trees.maxCount,12);
    assert.equal(request.visualSettings.rocks.density,0);
  });
}
test('provider failure also preserves explicit tree omission',()=>{
  assert.equal(resolveNaturalDraft('나무 없는 늪지대',null).request.visualSettings.trees.density,0);
  assert.equal(resolveNaturalDraft('늪지대',null).request.visualSettings.trees.density,1);
});

for (const resolve of [finalizePcgInterpretation,resolveNaturalDraft]) {
  for (const seed of [234,12345]) test(`${resolve.name}: user swamp preset seed ${seed}`,()=>{
    const draft=defaultRequest('Swamp',seed,100,100);
    draft.generationProfile='OpenMarsh';
    draft.visualSettings.rocks.allowedTypes=['rock'];
    draft.visualSettings.waterProps={density:0,maxCount:2,allowedTypes:['reeds']};
    Object.assign(draft.generatorSettings.forest,{waterThreshold:.01,noiseOctaves:2,clearingRadius:25,elevationScale:10,elevationFrequency:.1});
    const {request}=resolve(`시드 ${seed}, 100x100 늪지대 만들어줘`,draft);
    assert.equal(request.generationProfile,'DefaultSwamp');
    assert.deepEqual(request.visualSettings,defaultRequest('Swamp').visualSettings);
    assert.deepEqual(request.generatorSettings.forest,defaultRequest('Swamp').generatorSettings.forest);
    assert.equal(request.seed,seed); assert.equal(request.mapWidth,100); assert.equal(request.mapHeight,100);
  });
  for (const [prompt,water,trees] of [
    ['늪지대',.46,1],['물이 있는 늪지대',.46,1],
    ['물 없이 늪지대',0,1],['물 없이 나무 많은 늪지대',0,1],
    ['나무 없는 늪지대',.46,0],['물과 나무 없이 늪지대',0,0],['나무와 물 없이 늪지대',0,0],
    ['swamp without water',0,1],['swamp without trees',.46,0],
    ['swamp, no water, no trees',0,0],['물이 적은 늪지대',.3,1],
    ['물이 많은 늪지대, 나무 없이',.56,0],['늪지대, waterThreshold 0.4',.4,1],
    ['늪지대, waterThreshold 0',0,1],['수초 없는 늪지대',.46,1],
    ['식물 없는 늪지대',.46,1],['물고기 없는 늪지대',.46,1],['물이 없지 않은 늪지대',.46,1]
  ]) test(`${resolve.name}: independent water/tree intent ${prompt}`,()=>{
    const {request}=resolve(prompt,defaultRequest('Swamp'));
    assert.equal(request.generatorSettings.forest.waterThreshold,water);
    assert.equal(request.visualSettings.trees.density,trees);
  });
}
