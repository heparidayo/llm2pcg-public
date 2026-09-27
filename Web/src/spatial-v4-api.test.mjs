import test from "node:test";
import assert from "node:assert/strict";
import {createWebServer} from "./server.mjs";
import {emptyIntent,resolveIntent} from "./request-resolver.mjs";
import {handleV4,requestIntentFromOpenAi,protectSpatialIntent} from "./spatial-v4-api.mjs";
import {validateRequestV4} from '../../Shared/pcg-request-v4.mjs';

test('public gallery contains eight valid resolved requests without mutating shared defaults',async()=>{
 const r=await handleV4('/api/v4/examples',null);assert.equal(r.examples.length,8);for(const c of r.examples)assert.equal(validateRequestV4(c.request),null);
 r.examples[0].request.seed=999;assert.equal((await handleV4('/api/v4/examples',null)).examples[0].request.seed,234);
});

test("v4 HTTP resolve draws one seed, generation forwards saved JSON, legacy Unity is not called",async t=>{
  let seedCalls=0,received;
  const server=createWebServer({enableExperimentalV4:true,sendRequestToUnity:()=>{throw Error("Unity must not be called");},
    v4Options:{seedFactory:()=>{seedCalls++;return 901;},requestIntent:async()=>({...emptyIntent(),seed:777}),
      sendV4:async request=>{received=request;return {ok:true,world:{formatVersion:2}};}}});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>server.close());
  const url="http://127.0.0.1:"+server.address().port;
  const post=(path,body)=>fetch(url+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const resolved=await (await post("/api/v4/resolve",{prompt:"숲을 만들어"})).json();
  assert.equal(resolved.ok,true);assert.equal(resolved.request.seed,901);assert.equal(seedCalls,1);
  const result=await (await post("/api/v4/generate-direct",{request:resolved.request})).json();
  assert.equal(result.ok,true);assert.deepEqual(received,resolved.request);assert.equal(seedCalls,1);
  const malformed=await post("/api/v4/generate-direct",{request:{schemaVersion:4}});
  assert.equal(malformed.status,400);
  assert.equal((await fetch(url+"/api/v4/capabilities")).status,200);
});
test("v4 semantic API uses strict compact intent, bounded non-stored requests and no seed invention",async()=>{
  let captured;
  const draft=emptyIntent();
  const result=await requestIntentFromOpenAi("숲",{apiKey:"test-placeholder",fetchImplementation:async(_url,opts)=>{
    captured=JSON.parse(opts.body);return new Response(JSON.stringify({status:"completed",output_text:JSON.stringify(draft)}));
  }});
  assert.deepEqual(result,draft);assert.equal(captured.store,false);assert.equal(captured.max_output_tokens,3500);
  assert.equal(captured.text.format.strict,true);assert.equal(captured.model,"gpt-5.4-mini");
  assert.deepEqual(captured.text.format.schema.required,Object.keys(captured.text.format.schema.properties));
  assert.equal(captured.text.format.schema.properties.intentVersion.type,"integer");
  assert.equal(protectSpatialIntent("숲",{...draft,seed:991}).seed,null);
  assert.equal(protectSpatialIntent("시드 3 숲",draft).seed,3);
  assert.throws(()=>protectSpatialIntent("길 없이 다리",draft),/충돌/);
  assert.throws(()=>protectSpatialIntent("나무 정확히 10개",draft),/정확/);
});
test("v4 refusals, incomplete, malformed and unsupported outputs never generate",async()=>{
  for(const payload of [{status:"incomplete"},{status:"completed",output:[{content:[{type:"refusal"}]}]},{status:"completed",output_text:"not-json"}]){
    await assert.rejects(()=>requestIntentFromOpenAi("forest",{apiKey:"test",fetchImplementation:async()=>new Response(JSON.stringify(payload))}));
  }
  await assert.rejects(()=>handleV4("/api/v4/resolve",{prompt:"숲"},{requestIntent:async()=>({})}));
  await assert.rejects(()=>handleV4("/api/v4/resolve",{intent:{...emptyIntent(),worldType:"City"}}));
});
test("road direction never overwrites the independently interpreted river direction",()=>{
 const draft={...emptyIntent(),spatialFeatures:[{id:'river',kind:'River',placement:'CenterCrossing',orientation:'NorthSouth',size:null,exclusive:false}],route:{mode:'StraightCrossing',orientation:'EastWest',widthCells:3,crossingPolicy:'BridgeIfNeeded'}};
 const actual=protectSpatialIntent('북에서 남으로 중앙을 지나는 강, 동서 방향의 곧은 길과 교량',draft);
 assert.equal(actual.spatialFeatures[0].orientation,'NorthSouth');assert.equal(actual.route.orientation,'EastWest');
});
test("water plants is the waterProps category, not a groundDetails plant exclusion",()=>{
 const d={...emptyIntent(),worldType:'Swamp',seed:390,waterMode:'None',distributionRules:[{category:'waterProps',types:[],amountMode:'Off',amount:null,region:'WholeMap',featureId:null}]};
 const r=resolveIntent(d,{prompt:'A swamp without water, without paths, and without water plants. Seed 390.'});
 const water=r.request.distributionRules.find(r=>r.category==='waterProps');assert.equal(water.amountMode,'Off');assert.equal(water.maxCount,0);assert.ok(water.types.length);
});
test('Korean aquatic plant spacing does not become a foreign ground-detail type exclusion',()=>{
 for(const phrase of ['수생식물','수생 식물','수생  식물','수변 소품']) {
  const d={...emptyIntent(),worldType:'Swamp',seed:4316,distributionRules:[{category:'waterProps',types:[],amountMode:'Off',amount:null,region:'WholeMap',featureId:null}]};
  const r=resolveIntent(d,{prompt:phrase+'은 없게'}).request;
  assert.equal(r.distributionRules.find(r=>r.category==='waterProps').amountMode,'Off');
  assert.deepEqual(r.distributionRules.find(r=>r.category==='groundDetails'),resolveIntent({...emptyIntent(),worldType:'Swamp',seed:4316}).request.distributionRules.find(r=>r.category==='groundDetails'));
 }
});
test('visual water nouns cannot switch off terrain water, while independent water negation still applies',()=>{
 for(const prompt of ['수생 식물은 없게','식물은 없게','no water plants','no aquatic plants'])assert.equal(protectSpatialIntent(prompt,emptyIntent()).waterMode,null,prompt);
 for(const prompt of ['수생 식물과 물은 없게','no water plants and no water'])assert.equal(protectSpatialIntent(prompt,emptyIntent()).waterMode,'None',prompt);
 const lake={...emptyIntent(),spatialFeatures:[{id:'lake',kind:'Lake',placement:'East',orientation:null,size:'Small',exclusive:true}]};
 assert.equal(protectSpatialIntent('A lake with no water anywhere outside this lake',lake).waterMode,'Default');
});
test('an inactive model route uses the canonical Node defaults without changing direct intent input',async()=>{
 const draft={...emptyIntent(),route:{mode:'None',orientation:'NorthSouth',widthCells:1,crossingPolicy:'NoCrossing'}};
 assert.deepEqual(protectSpatialIntent('without roads',draft).route,{mode:'None',orientation:'EastWest',widthCells:3,crossingPolicy:'BridgeIfNeeded'});
 const direct=await handleV4('/api/v4/resolve',{intent:draft},{seedFactory:()=>1});assert.deepEqual(direct.request.route,draft.route);
});
test('a separate bridge deck is supported when a river and crossing route are present',()=>{
 const prompt='중앙 남북 강을 동서 직선 길과 별도 다리 데크로 건너는 숲';
 const draft={...emptyIntent(),spatialFeatures:[{id:'river',kind:'River',placement:'CenterCrossing',orientation:'NorthSouth',size:'Medium',exclusive:false}],
  route:{mode:'StraightCrossing',orientation:'EastWest',widthCells:3,crossingPolicy:'BridgeIfNeeded'},unsupported:['별도 다리 데크']};
 assert.deepEqual(protectSpatialIntent(prompt,draft).unsupported,[]);
 assert.deepEqual(protectSpatialIntent('Forest with a north-south river, east-west road and separate bridge deck',
  {...draft,unsupported:['separate bridge deck','curved bridge deck']}).unsupported,['curved bridge deck']);
 assert.deepEqual(protectSpatialIntent(prompt,{...draft,unsupported:['별도 다리 데크','선인장']}).unsupported,['선인장']);
 assert.deepEqual(protectSpatialIntent(prompt,{...draft,route:null}).unsupported,['별도 다리 데크']);
});
test('water only in a lake is not a global water prohibition; ambiguous lake counts are not exclusive',async()=>{
 const draft={...emptyIntent(),waterMode:'None',spatialFeatures:[{id:'lake',kind:'Lake',placement:'Center',orientation:null,size:'Large',exclusive:false}]};
 for(const prompt of ['Forest. Water only inside that lake, nowhere else.','숲. 물은 그 호수 안에만 있게 해 줘.','A lake is the only water area; no water outside it.','호수 바깥에는 물이 전혀 없게 해 줘.']){
  const r=await handleV4('/api/v4/resolve',{prompt},{requestIntent:async()=>draft,seedFactory:()=>234});
  assert.equal(r.request.waterMode,'Default');assert.equal(r.request.spatialFeatures[0].exclusive,true);
 }
 assert.equal(protectSpatialIntent('중앙 호수 하나만',{...draft,waterMode:null}).spatialFeatures[0].exclusive,false);
 assert.throws(()=>protectSpatialIntent('No water. Water only inside the lake.',draft),{code:'CONFLICTING_INTENT'});
 assert.throws(()=>protectSpatialIntent('No water outside the lake.',emptyIntent()),{code:'CONFLICTING_INTENT'});
});
