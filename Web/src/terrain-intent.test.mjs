import test from "node:test";
import assert from "node:assert/strict";
import {defaultRequest,validatePcgRequest} from "../../Shared/pcg-request.mjs";
import {finalizePcgInterpretation,createWebServer} from "./server.mjs";
import {proposeV4Migration} from "./migrate-v3-to-v4.mjs";
const interpret=(prompt,world="Forest")=>finalizePcgInterpretation(prompt,defaultRequest(world,234,128,128));

test("central large mountain overrides a neutral model result and keeps presentation assets",()=>{
  const {request,interpretation}=interpret("중앙에 큰 산이 있는 숲 만들어줘");
  assert.deepEqual(request.layoutSettings.landform,{kind:"Mountain",placement:"Center",size:"Large",intensity:"High"});
  assert.equal(request.generatorSettings.forest.elevationScale,6);
  assert.equal(request.presentationSettings.propsEnabled,true);
  assert.equal(request.visualSettings.trees.density,1);
  assert.deepEqual(interpretation.warnings,[]);
});
for(const [prompt,world,placement,size,intensity] of [
  ["북쪽에 작은 산이 있는 설원","Snowfield","North","Small","Low"],
  ["남쪽에 큰 산이 있는 사막","Desert","South","Large","High"],
  ["동쪽에 높은 산이 있는 늪","Swamp","East","Medium","High"],
  ["서쪽에 완만한 언덕이 있는 숲","Forest","West","Medium","Low"],
  ["a forest with a large mountain in the center","Forest","Center","Large","High"],
  ["a low mountain in the north","Forest","North","Medium","Low"],
  ["중앙에 크지만 낮은 산","Forest","Center","Large","Low"]
]) test("terrain wording: "+prompt,()=>{
  assert.deepEqual(interpret(prompt,world).request.layoutSettings.landform,{kind:"Mountain",placement,size,intensity});
});
test("mountain omissions restore neutral settings without touching unrelated categories",()=>{
  for(const prompt of ["산 없이 숲 만들어줘","산은 없게","a forest without mountains"]) {
    const candidate=defaultRequest("Forest");candidate.layoutSettings.landform={kind:"Mountain",placement:"Center",size:"Large",intensity:"High"};
    assert.deepEqual(finalizePcgInterpretation(prompt,candidate).request.layoutSettings.landform,defaultRequest("Forest").layoutSettings.landform);
  }
  assert.equal(interpret("산을 빼지 말아줘").request.layoutSettings.landform.kind,"Mountain");
  const request=interpret("중앙에 큰 산이 있는 숲, 나무 없이").request;
  assert.equal(request.layoutSettings.landform.kind,"Mountain");assert.equal(request.visualSettings.trees.density,0);
});
test("unrelated Korean words and other scenery sizes cannot invent or resize mountains",()=>{
  for(const prompt of ["산책하기 좋은 숲","산뜻한 숲","부산의 숲"]) assert.equal(interpret(prompt).request.layoutSettings.landform.kind,"None");
  const request=interpret("큰 숲에 작은 산").request;
  assert.equal(request.layoutSettings.landform.size,"Small");
});
test("unsupported terrain is visible, and a supported mountain does not hide river warnings",()=>{
  assert.ok(interpret("중앙에 큰 산, 동쪽에 강").interpretation.warnings.some(w=>w.code==="UNSUPPORTED_SPATIAL_LAYOUT"));
  assert.ok(interpret("산 두 개 있는 숲").interpretation.warnings.some(w=>w.code==="SINGLE_LANDFORM_LIMIT"));
  assert.ok(interpret("중앙에 계곡이 있는 숲").interpretation.warnings.some(w=>w.code==="UNSUPPORTED_LANDFORM"));
  assert.ok(interpret("중앙에 큰 산이 있는 도시","City").interpretation.warnings.some(w=>w.code==="UNSUPPORTED_LANDFORM_WORLD"));
});
test("mountain validation allows only supported nature worlds and bounded layouts",()=>{
  for(const world of ["Forest","Snowfield","Swamp","Desert","Dungeon","Cave","City"]) {
    const r=defaultRequest(world);r.layoutSettings.landform={kind:"Mountain",placement:"North",size:"Large",intensity:"High"};
    assert.equal(validatePcgRequest(r)===null,["Forest","Snowfield","Swamp","Desert"].includes(world));
  }
  for(const [field,value] of [["kind","Valley"],["placement","Outside"],["size","Huge"],["intensity",100]]) {
    const r=interpret("중앙에 큰 산").request;r.layoutSettings.landform[field]=value;assert.ok(validatePcgRequest(r));
  }
  assert.throws(()=>proposeV4Migration(interpret("중앙에 큰 산").request),{code:"MIGRATION_REQUIRES_REVIEW"});
});
test("both main natural-language APIs forward the same mountain contract",async()=>{
  const forwarded=[];
  const server=createWebServer({requestPcg:async()=>defaultRequest("Forest"),sendRequestToCore:async r=>{forwarded.push(r);return {world:{formatVersion:1}};},sendRequestToUnity:async r=>{forwarded.push(r);return {status:202,payload:{ok:true}};}});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    for(const route of ["/api/generate","/api/unity/generate"]) {
      const response=await fetch("http://127.0.0.1:"+server.address().port+route,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:"시드 234, 128x128 중앙에 큰 산이 있는 숲 만들어줘"})});
      assert.ok(response.ok);const body=await response.json();assert.equal(body.request.layoutSettings.landform.kind,"Mountain");assert.equal(body.interpretation,undefined);
    }
    assert.deepEqual(forwarded[0],forwarded[1]);assert.equal(forwarded[0].seed,234);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
