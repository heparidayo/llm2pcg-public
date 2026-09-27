import assert from "node:assert/strict";
import test from "node:test";
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {readFileSync} from "node:fs";
import {resolveIntent,emptyIntent,requestDigest} from "./request-resolver.mjs";
import {validateRequestV4,semanticCatalog,requestV4Schema} from "../../Shared/pcg-request-v4.mjs";
import {validateSchema} from "../../Shared/schema-validator.mjs";

export function riverIntent() {
  const d=emptyIntent(); d.seed=234;d.mapWidth=64;d.mapHeight=64;d.worldType="Forest";
  d.spatialFeatures=[{id:"river-main",kind:"River",placement:"CenterCrossing",orientation:"NorthSouth",size:"Large",exclusive:false}];
  d.distributionRules=[{category:"trees",types:["cherry_blossom"],amountMode:"RelativeDensity",amount:1000,region:"NearFeature",featureId:"river-main"},
    {category:"rocks",types:[],amountMode:"Off",amount:null,region:"WholeMap",featureId:null}];
  return d;
}
test("resolver assigns one server seed, preserves explicit seed and never mutates draft",()=>{
  const d=emptyIntent(),before=structuredClone(d);let calls=0;
  const a=resolveIntent(d,{seedFactory:()=>{calls++;return -2147483648;}});
  assert.equal(calls,1);assert.equal(a.request.seed,-2147483648);assert.equal(a.interpretation.seedSource,"server-random");
  const b=resolveIntent(d,{prompt:"seed 2147483647, 64x128",seedFactory:()=>{throw Error("must not draw");}});
  assert.equal(b.request.seed,2147483647);assert.equal(b.request.mapWidth,64);
  assert.deepEqual(d,before);assert.equal(requestDigest(a.request),requestDigest(structuredClone(a.request)));
});
test("resolver handles explicit off/type/caps and rejects unsupported or conflicting draft",()=>{
  const d=riverIntent();const r=resolveIntent(d,{prompt:"나무는 벚꽃만 최대 12그루, 바위는 없게"}).request;
  assert.equal(r.distributionRules[0].maxCount,12);assert.equal(r.distributionRules[1].amountMode,"Off");
  assert.equal(validateSchema(r,requestV4Schema),null);assert.equal(validateRequestV4(r),null);
  for(const worldType of ["City","Cave","Dungeon"])
    assert.throws(()=>resolveIntent({...d,worldType}),/Forest/);
  assert.throws(()=>resolveIntent({...d,unsupported:["exact count"]}),/exact/);
  assert.throws(()=>resolveIntent({...d,waterMode:"None"}),/conflict/);
  assert.throws(()=>resolveIntent({...d,distributionRules:[d.distributionRules[0],d.distributionRules[0]]}),/Duplicate/);
});
test("seed and numeric errors are never clamped; unknown keys are rejected",()=>{
  for(const seed of [NaN,Infinity,2147483648,1.5])assert.throws(()=>resolveIntent({...emptyIntent(),seed}));
  assert.throws(()=>resolveIntent({...emptyIntent(),surprise:true}));
  assert.throws(()=>resolveIntent(emptyIntent(),{prompt:"1000000x64",seedFactory:()=>1}));
});

const hostDll=new URL("../../Standalone/Llm2Pcg.CoreHost/bin/Debug/net8.0/Llm2Pcg.CoreHost.dll",import.meta.url);
const integration=process.env.PCG_V4_INTEGRATION==="1";
test("C# v4 schema/semantic parity, spatial invariants, repeatability, visual monotonicity", {skip:!integration},async t=>{
  const child=spawn("dotnet",[decodeURIComponent(hostDll.pathname).replace(/^\/([A-Z]:)/i,"$1"),"--v4-batch"],{stdio:["pipe","pipe","pipe"],windowsHide:true});
  let stderr="";child.stderr.on("data",d=>stderr+=d);
  const waiting=[];createInterface({input:child.stdout}).on("line",line=>waiting.shift()?.resolve(JSON.parse(line)));
  child.on("exit",code=>{while(waiting.length)waiting.shift().reject(Error("Host exited "+code+": "+stderr));});
  async function invoke(request,includeWorld=false){
    return await new Promise((resolve,reject)=>{waiting.push({resolve,reject});child.stdin.write(JSON.stringify({request,includeWorld})+"\n");});
  }
  t.after(()=>{child.stdin.end();child.kill();});
  const base=resolveIntent(riverIntent()).request;
  const a=await invoke(base,true),b=await invoke(base,true);
  assert.equal(a.ok,true,JSON.stringify(a));assert.deepEqual(a.world,b.world);
  const world=a.world,water=Buffer.from(world.waterMask,"base64"),path=Buffer.from(world.routeMask,"base64");
  assert.equal(path.some(x=>x!==0),false);
  assert.ok(world.placements.filter(p=>p.category==="trees").length>0);
  assert.ok(world.placements.filter(p=>p.category==="trees").every(p=>p.type==="cherry_blossom"));
  assert.equal(world.placements.filter(p=>p.category==="rocks").length,0);
  assert.ok(world.placements.every(p=>p.category==="waterProps"?water[p.y*64+p.x]===1:water[p.y*64+p.x]===0));
  for(const d of world.placementDiagnostics)assert.equal(d.placedCount+Object.values(d.rejected).reduce((a,b)=>a+b,0),d.candidateCount);
  for(let y=0;y<64;y++)assert.ok(water.subarray(y*64,(y+1)*64).some(x=>x===1));
  const bridge=structuredClone(base);bridge.route={mode:"StraightCrossing",orientation:"EastWest",widthCells:3,crossingPolicy:"BridgeIfNeeded"};
  const bridged=await invoke(bridge,true);assert.equal(bridged.ok,true);
  assert.deepEqual(bridged.world.waterMask,world.waterMask);
  assert.ok(Buffer.from(bridged.world.bridgeMask,"base64").some(x=>x===1));
  bridge.route.crossingPolicy="NoCrossing";assert.equal((await invoke(bridge)).code,"UNSATISFIABLE_ROUTE");
  const invalidMutations=[
    r=>delete r.seed,r=>r.seed=2147483648,r=>r.seed=1.5,r=>r.mapWidth=15,r=>r.mapHeight=501,
    r=>r.unknown=true,r=>r.terrain.octaves=0,r=>r.terrain.missing=1,r=>r.generatorVersion="forest-biome@1",
    r=>r.spatialFeatures[0].orientation="None",r=>r.spatialFeatures.push(r.spatialFeatures[0]),
    r=>r.distributionRules[0].featureId="missing",r=>r.distributionRules[0].types=["rock"],
    r=>r.distributionRules[0].amountMode="Exact",r=>r.route.widthCells=0,r=>r.waterMode="None"
  ];
  for(const mutate of invalidMutations){const r=structuredClone(base);mutate(r);assert.ok(validateRequestV4(r));assert.equal((await invoke(r)).ok,false);}
  const fixtureFile=new URL("./fixtures/spatial-v4/contract-cases.json",import.meta.url);
  const fixtures=JSON.parse(readFileSync(fixtureFile,"utf8"));
  for(const fixture of fixtures){const local=validateRequestV4(fixture.request);assert.equal(!local,fixture.valid,fixture.id);
    const actual=await invoke(fixture.request);assert.equal(actual.ok,fixture.valid,fixture.id+": "+JSON.stringify(actual));}
  const treeSets=[];
  for(const density of [0,350,1000]){
    const r=structuredClone(base);r.distributionRules[0].densityPermille=density;
    const actual=await invoke(r,true);assert.equal(actual.ok,true);
    treeSets.push(new Set(actual.world.placements.filter(p=>p.category==="trees").map(p=>p.stableId)));
  }
  assert.equal(treeSets[0].size,0);assert.ok([...treeSets[1]].every(id=>treeSets[2].has(id)));
  const withRocks=structuredClone(base);withRocks.distributionRules[1]={...withRocks.distributionRules[1],amountMode:"AtMost",densityPermille:1000,maxCount:20};
  const c=await invoke(withRocks,true);assert.deepEqual(c.world.placements.filter(p=>p.category==="trees"),world.placements.filter(p=>p.category==="trees"));
  assert.equal(c.world.worldHash,world.worldHash);
  // Catalog parity is explicit, not filename inference.
  const catalog=await new Promise((resolve,reject)=>{waiting.push({resolve,reject});child.stdin.write('{"catalog":true}\n');});
  assert.deepEqual(catalog.catalog,semanticCatalog);
  for(const [category,data] of Object.entries(semanticCatalog.categories))assert.deepEqual(catalog.runtimeTypes[category],data.types);
});
