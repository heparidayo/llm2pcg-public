import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { analyzePrompt, tokenizePrompt } from "./prompt-intent.mjs";
import { finalizePcgInterpretation, requestPcgFromOpenAi, extractOutputText, createWebServer } from "./server.mjs";
import { defaultRequest, validatePcgRequest } from "../../Shared/pcg-request.mjs";

const interpret = (prompt,candidate=defaultRequest("Forest",234,64,64))=>finalizePcgInterpretation(prompt,candidate);
for (const [prompt,expected] of [
  ["나무는 많이 바위는 없게",{trees:1,rocks:0}],
  ["나무는 없게, 바위는 많이",{trees:0,rocks:1}],
  ["나무와 바위 없이",{trees:0,rocks:0}],
  ["나무는 없게, 나무는 많이",{trees:1,rocks:1}],
  ["no trees and many rocks",{trees:0,rocks:1}],
  ["many trees without rocks",{trees:1,rocks:0}],
  ["few trees, without rocks",{trees:.35,rocks:0}],
  ["나무는 듬성듬성, 바위는 많이",{trees:.35,rocks:1}],
  ["나무 밀도 0%, 바위 밀도 25%",{trees:0,rocks:.25}],
  ["나무 0그루, 바위 12개",{trees:0,rocks:1}]
]) test("scoped visual intent: "+prompt,()=>{
  const {request}=interpret(prompt);
  for(const [key,density] of Object.entries(expected))assert.equal(request.visualSettings[key].density,density);
});

test("longest lexemes keep cherry blossoms and dead trunks out of flower/tree substrings",()=>{
  const {tokens}=tokenizePrompt("벚꽃, 통나무, 버드나무");
  assert.deepEqual(tokens.map(t=>[t.category,t.type]),[["trees","cherry_blossom"],["groundDetails","log"],["trees","willow"]]);
});
test("only applies to the named type category",()=>{
  const {request}=interpret("나무는 벚꽃만 있고 바위는 없게");
  assert.deepEqual(request.visualSettings.trees.allowedTypes,["cherry_blossom"]);
  assert.equal(request.visualSettings.trees.density,1);
  assert.equal(request.visualSettings.rocks.density,0);
  assert.equal(request.visualSettings.groundDetails.density,1);
});
test("normalization and explicit seed, size and threshold override model guesses",()=>{
  const {request,interpretation}=interpret("시드 -１７, １２８×６４ 숲, waterThreshold 0.4");
  assert.equal(request.seed,-17);assert.equal(request.mapWidth,128);assert.equal(request.mapHeight,64);
  assert.equal(request.generatorSettings.forest.waterThreshold,.4);
  assert.ok(interpretation.constraints.some(c=>c.path==="seed"&&c.evidence.includes("-17")));
});
test("an explicit omission outranks finished preset",()=>{
  assert.equal(interpret("완성형 숲, 프롭 없이").request.presentationSettings.propsEnabled,false);
});
test("tree exclusion cannot leak into the global props switch",()=>{
  const {request}=interpret("프롭은 넣고 나무는 없게");
  assert.equal(request.presentationSettings.propsEnabled,true);
  assert.equal(request.visualSettings.trees.density,0);
});
test("English omission after visual categories still targets global props",()=>{
  assert.equal(interpret("many trees, without props").request.presentationSettings.propsEnabled,false);
});
test("model candidates are not mutated",()=>{
  const candidate=defaultRequest("Forest"); const before=structuredClone(candidate);
  interpret("나무 없이",candidate);assert.deepEqual(candidate,before);
});
test("central river is supported while exact-area claims still produce capability warnings",()=>{
  const {request,interpretation}=interpret("중앙에 강이 있는 숲, 물은 30%");
  assert.ok(!interpretation.warnings.some(w=>w.code==="UNSUPPORTED_SPATIAL_LAYOUT"));
  assert.ok(interpretation.warnings.some(w=>w.code==="WATER_COVERAGE_NOT_EXACT"));
  assert.equal(request.layoutSettings.water.kind,"River");
});
test("count is a cap, not a promise of exact placement",()=>{
  const {request,interpretation}=interpret("나무는 최대 12그루");
  assert.equal(request.visualSettings.trees.maxCount,12);
  assert.ok(interpretation.warnings.some(w=>w.code==="COUNT_IS_CAP"));
});
test("double negatives are not blindly treated as exclusion",()=>{
  const {request,interpretation}=interpret("나무를 빼지 말아줘");
  assert.equal(request.visualSettings.trees.density,1);
  assert.ok(interpretation.warnings.some(w=>w.code==="AMBIGUOUS_NEGATION"));
});
test("specific tree exclusion does not erase every tree",()=>{
  const {request}=interpret("벚꽃은 제외해줘");
  assert.equal(request.visualSettings.trees.density,1);
  assert.ok(!request.visualSettings.trees.allowedTypes.includes("cherry_blossom"));
  assert.ok(request.visualSettings.trees.allowedTypes.includes("conifer"));
});
test("grass exclusion preserves other ground-detail types",()=>{
  const {request}=interpret("벚꽃만 있고 풀은 없게");
  assert.deepEqual(request.visualSettings.trees.allowedTypes,["cherry_blossom"]);
  assert.ok(!request.visualSettings.groundDetails.allowedTypes.includes("grass"));
  assert.ok(request.visualSettings.groundDetails.allowedTypes.includes("mushroom"));
});
test("ice exclusion still permits rocks",()=>{
  assert.deepEqual(interpret("얼음 제외").request.visualSettings.rocks.allowedTypes,["rock"]);
});
for(const prompt of ["시드 2147483648 숲","1000000x64 숲","나무 밀도 120%","waterThreshold 2 숲"])
  test("rejects unsafe explicit constraint: "+prompt,()=>{
    assert.throws(()=>interpret(prompt),{code:"INVALID_PROMPT_CONSTRAINT"});
  });
test("a repeated prompt and candidate resolve identically",()=>{
  assert.deepEqual(interpret("시드 234, 64x64 벚꽃만, 바위 없이"),interpret("시드 234, 64x64 벚꽃만, 바위 없이"));
});

const schema=JSON.parse(await readFile(new URL("../../Shared/Schema/pcg-request.schema.json",import.meta.url),"utf8"));
for(const [world,branch] of [["Dungeon","dungeon"],["Cave","cave"],["Forest","forest"],["City","city"],["Desert","forest"],["Swamp","forest"],["Snowfield","forest"]]) {
  test("numeric schema guard parity: "+world,()=>{
    const fields=schema.$defs[branch+"Settings"].properties;
    for(const [key,spec] of Object.entries(fields)) {
      for(const value of [undefined,null,"4",NaN,Infinity,-Infinity]) {
        const r=defaultRequest(world);r.generatorSettings[branch][key]=value;
        assert.ok(validatePcgRequest(r),key+" "+String(value));
      }
      const r=defaultRequest(world);
      if(spec.maximum!==undefined){r.generatorSettings[branch][key]=spec.maximum+1;assert.ok(validatePcgRequest(r),key+" max");}
      if(spec.type==="integer"){r.generatorSettings[branch][key]=1.5;assert.ok(validatePcgRequest(r),key+" integer");}
    }
  });
}
test("visual type membership is checked per category, not one global union",()=>{
  const r=defaultRequest("Forest");r.visualSettings.rocks.allowedTypes=["cherry_blossom"];
  assert.match(validatePcgRequest(r),/rocks.allowedTypes/);
});
test("malformed LLM objects are rejected before deterministic policies",()=>{
  for(const r of [null,[],{}, {...defaultRequest("Forest"),generatorSettings:{forest:{}}}])
    assert.throws(()=>interpret("숲",r),{code:"OPENAI_INVALID_CONTRACT"});
});
test("refusals and incomplete output never enter JSON-to-PCG translation",()=>{
  assert.throws(()=>extractOutputText({status:"incomplete",output_text:"{}"}),{code:"OPENAI_INCOMPLETE_RESPONSE"});
  assert.throws(()=>extractOutputText({status:"completed",output:[{content:[{type:"refusal",refusal:"No"}]}]}),{code:"OPENAI_REFUSAL"});
});
test("Responses integration uses bounded, non-stored requests and deterministic constraints",async()=>{
  const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY="test-only-not-a-real-key";
  try {
    let outbound;
    const result=await requestPcgFromOpenAi("시드 234, 나무는 많이 바위는 없게",async(url,options)=>{
      assert.equal(url,"https://api.openai.com/v1/responses");
      outbound=JSON.parse(options.body);assert.ok(options.signal);
      return {ok:true,json:async()=>({status:"completed",output_text:JSON.stringify(defaultRequest("Forest",999))})};
    });
    assert.equal(outbound.store,false);assert.equal(outbound.text.format.strict,true);
    assert.equal(result.seed,234);assert.equal(result.visualSettings.trees.density,1);assert.equal(result.visualSettings.rocks.density,0);
  } finally {if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old;}
});
test("natural generation logs interpretation privately and forwards exactly the resolved request",async()=>{
  let forwarded, diagnostic;
  const server=createWebServer({sendDiagnosticsToUnity:async message=>{diagnostic=message;},requestPcg:async()=>defaultRequest("Forest",999),sendRequestToCore:async(request)=>{forwarded=request;return {world:{formatVersion:1}};}});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const response=await fetch("http://127.0.0.1:"+server.address().port+"/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:"시드 234, 나무는 많이 바위는 없게, 중앙에 강"})});
    const body=await response.json();assert.equal(response.status,200);
    assert.deepEqual(body.request,forwarded);assert.equal(forwarded.seed,234);
    assert.equal(body.interpretation,undefined);assert.equal(forwarded.layoutSettings.water.kind,'River');assert.equal(diagnostic,undefined);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
test("invalid translated request is replaced before reaching either generator",async()=>{
  let calls=0;
  const accept=request=>{assert.equal(validatePcgRequest(request),null);assert.equal(request.worldType,"Forest");calls++;};
  const server=createWebServer({requestPcg:async()=>null,sendRequestToCore:async request=>{accept(request);return {world:{formatVersion:1}};},sendRequestToUnity:async request=>{accept(request);return {status:202,payload:{ok:true}};}});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    for(const route of ["/api/generate","/api/unity/generate"]) {
      const response=await fetch("http://127.0.0.1:"+server.address().port+route,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:"숲"})});
      assert.equal(response.status,route==="/api/generate"?200:202);assert.equal((await response.json()).interpretation,undefined);
    }
    assert.equal(calls,2);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
