import assert from 'node:assert/strict';
import {resolveNaturalDraft} from '../Web/src/server.mjs';
import {validatePcgRequest} from '../Shared/pcg-request.mjs';

const base=process.argv[2];
assert.ok(base,'Pass the standalone Web base URL.');
const prompt='넓은 사막 만들어. 대신 가운데에 강이 남북을 관통하게 흘러야해';
const {request}=resolveNaturalDraft(prompt,null,{reason:'INTERPRETATION_UNAVAILABLE'});
assert.equal(validatePcgRequest(request),null);
assert.equal(request.worldType,'Desert');
assert.equal(request.layoutSettings.water.kind,'River');
assert.equal(request.layoutSettings.water.placement,'CenterNorthSouth');
const response=await fetch(base+'/api/generate-direct',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request})
});
assert.equal(response.status,200);
const result=await response.json();
assert.equal(result.ok,true,JSON.stringify(result));
const {world}=result;
const cells=Buffer.from(world.cells,'base64');
assert.equal(cells.length,world.width*world.height);
const water=world.cellLegend.indexOf('Water');
assert.ok(water>=0);
const center=Math.floor(world.width/2);
for(let y=0;y<world.height;y++)assert.equal(cells[y*world.width+center],water,'Central river row '+y);
console.log('PASS Desert natural-language central river hash='+world.worldHash);

for(const route of ['/spatial-v4','/spatial-v4/']){
  const retired=await fetch(base+route,{redirect:'manual'});
  assert.equal(retired.status,308);assert.equal(retired.headers.get('location'),'/unity');
}
const retiredApi=await fetch(base+'/api/v4/examples');
assert.equal(retiredApi.status,410);
assert.equal((await retiredApi.json()).code,'SPATIAL_V4_RETIRED');
console.log('PASS retired Spatial v4 routes');
