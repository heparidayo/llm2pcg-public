import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {validateSchema} from '../../Shared/schema-validator.mjs';
const outputSchema=JSON.parse(readFileSync(new URL('../../Shared/Schema/generated-world-v2.schema.json',import.meta.url),'utf8'));
import {decodeSpatialWorld,surfaceGeometry,glyphBoxes,semanticTypes} from '../public/spatial-v4-world.mjs';
import {emptyIntent,resolveIntent} from './request-resolver.mjs';
import {semanticCatalog,capabilitiesV4} from '../../Shared/pcg-request-v4.mjs';
function fixture(){const request=resolveIntent({...emptyIntent(),seed:234,mapWidth:16,mapHeight:16}).request;const zero=Buffer.alloc(256).toString('base64');return {request,world:{formatVersion:2,worldType:'Forest',generatorVersion:'forest-biome@2',seed:234,width:16,height:16,elevationUnits:Array(256).fill(4),waterMask:zero,routeMask:zero,bridgeMask:zero,protectedMask:zero,startIndex:0,exitIndex:255,worldHash:'a'.repeat(64),semanticHash:'b'.repeat(64),featureMasks:{},placements:[]}};}
test('v2 decoder preserves full integer buffers and rejects legacy, malformed masks and mismatched requests',()=>{
  const {world,request}=fixture(),decoded=decodeSpatialWorld(world,request);
  assert.deepEqual(Array.from(decoded.elevationUnits),world.elevationUnits);assert.equal(decoded.waterMask.length,256);
  for(const changed of [{formatVersion:1},{width:500},{elevationUnits:[0]},{waterMask:'AA=='},{waterMask:Buffer.alloc(256,2).toString('base64')},{seed:999},{worldHash:'bad'},{placements:[{}]}])assert.throws(()=>decodeSpatialWorld({...world,...changed},request));
  assert.equal(world.elevationUnits[0],4);assert.equal(typeof world.waterMask,'string');
});
test('v2 surface exact cell centers, boundary heights and upward triangle winding',()=>{
  const {world,request}=fixture();world.elevationUnits[0]=12;const decoded=decodeSpatialWorld(world,request),g=surfaceGeometry(decoded,request),stride=33;
  for(let y=0;y<16;y++)for(let x=0;x<16;x++)assert.equal(g.positions[((y*2+1)*stride+x*2+1)*3+1],world.elevationUnits[y*16+x]*.25);
  assert.equal(g.positions[1],3);assert.equal(g.triangles[0].length,256*24);
  const [a,b,c]=g.triangles[0];const p=g.positions;const ny=(p[b*3+2]-p[a*3+2])*(p[c*3]-p[a*3])-(p[b*3]-p[a*3])*(p[c*3+2]-p[a*3+2]);assert.ok(ny>0);
});
test('v2 bridge keeps water and has separate elevated deck; inconsistent bridge rejected',()=>{
  const {world,request}=fixture();const mask=new Uint8Array(256);mask[8*16+8]=1;world.waterMask=world.routeMask=world.bridgeMask=Buffer.from(mask).toString('base64');
  const decoded=decodeSpatialWorld(world,request),g=surfaceGeometry(decoded,request);
  assert.equal(g.triangles[3].length,6);assert.equal(g.triangles[4].length,6);
  assert.ok(g.positions[g.triangles[4][0]*3+1]>g.positions[g.triangles[3][0]*3+1]);
  assert.throws(()=>decodeSpatialWorld({...world,waterMask:Buffer.alloc(256).toString('base64')},request));
});
test('all canonical types have explicit glyphs and foreign category/type is rejected',()=>{
  for(const [category,types] of Object.entries(semanticTypes)){assert.deepEqual(types,semanticCatalog.categories[category].types);for(const type of types)assert.ok(glyphBoxes(category,type).length>0);}
  assert.throws(()=>glyphBoxes('trees','rock'));
});
test('capabilities mark the retired Web preview separately from opt-in Unity runtime',()=>{
  assert.equal(capabilitiesV4.rendererReady,true);assert.equal(capabilitiesV4.unityReady,false);
  assert.equal(capabilitiesV4.webPreview.formatVersion,2);assert.equal(capabilitiesV4.webPreview.requiresCoreHost,true);
  assert.equal(capabilitiesV4.webPreview.supported,false);assert.equal(capabilitiesV4.webPreview.retired,true);assert.equal(capabilitiesV4.webPreview.path,null);
});
test('all 64 valid contracts, two demos and four boundary sizes preserve full v2 data', {skip:process.env.PCG_V4_INTEGRATION!=='1'},()=>{
  const fixtures=JSON.parse(readFileSync(new URL('./fixtures/spatial-v4/contract-cases.json',import.meta.url),'utf8')).filter(c=>c.valid);
  const river=resolveIntent(JSON.parse(readFileSync(new URL('./fixtures/spatial-v4/river-cherry.intent.json',import.meta.url),'utf8'))).request;
  const bridge=structuredClone(river);bridge.route={mode:'StraightCrossing',orientation:'EastWest',widthCells:3,crossingPolicy:'BridgeIfNeeded'};
  const cases=[...fixtures,{id:'river-demo',request:river},{id:'bridge-demo',request:bridge},
    ...[[16,16],[64,128],[128,64],[500,500]].map(([mapWidth,mapHeight])=>({id:`boundary-${mapWidth}x${mapHeight}`,request:resolveIntent({...emptyIntent(),seed:234,mapWidth,mapHeight}).request}))];
  assert.equal(cases.length,70);
  const dll=fileURLToPath(new URL('../../Standalone/Llm2Pcg.CoreHost/bin/Debug/net8.0/Llm2Pcg.CoreHost.dll',import.meta.url));
  const result=spawnSync('dotnet',[dll,'--v4-batch'],{input:cases.map(c=>JSON.stringify({request:c.request,includeWorld:true})).join('\n')+'\n',encoding:'utf8',windowsHide:true,maxBuffer:128*1024*1024});
  assert.equal(result.status,0,result.stderr);const outputs=result.stdout.trim().split(/\r?\n/).map(s=>JSON.parse(s));assert.equal(outputs.length,cases.length);
  for(let c=0;c<cases.length;c++){
    const {id,request}=cases[c],raw=outputs[c];assert.equal(raw.ok,true,id);
    assert.equal(validateSchema(raw.world,outputSchema),null,id);
    const w=decodeSpatialWorld(raw.world,request);assert.deepEqual(w.placements,raw.world.placements,id);
    assert.deepEqual(Array.from(w.elevationUnits),raw.world.elevationUnits,id);
    for(const key of ['waterMask','routeMask','bridgeMask','protectedMask'])assert.deepEqual(Array.from(w[key]),Array.from(Buffer.from(raw.world[key],'base64')),id+'/'+key);
    for(const [key,values] of Object.entries(w.featureMasks))assert.deepEqual(Array.from(values),Array.from(Buffer.from(raw.world.featureMasks[key],'base64')),id+'/'+key);
    const g=surfaceGeometry(w,request);assert.ok(g.positions.every(Number.isFinite),id);
    for(const indices of g.triangles){assert.equal(indices.length%3,0,id);assert.ok(indices.every(i=>i<g.positions.length/3),id);}
    assert.equal(g.triangles.slice(0,3).reduce((n,t)=>n+t.length,0),w.width*w.height*24,id);
    assert.equal(g.triangles[3].length,w.waterMask.reduce((n,v)=>n+v,0)*6,id);
    assert.equal(g.triangles[4].length,w.bridgeMask.reduce((n,v)=>n+v,0)*6,id);
  }
});
test('real .NET v2 output decodes without dropping any placement or layer', {skip:process.env.PCG_V4_INTEGRATION!=='1'},()=>{
  const request=resolveIntent({...emptyIntent(),seed:234,mapWidth:32,mapHeight:32}).request;
  const dll=fileURLToPath(new URL('../../Standalone/Llm2Pcg.CoreHost/bin/Debug/net8.0/Llm2Pcg.CoreHost.dll',import.meta.url));
  const result=spawnSync('dotnet',[dll,'--v4-batch'],{input:JSON.stringify({request,includeWorld:true})+'\n',encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
  assert.equal(result.status,0,result.stderr);const raw=JSON.parse(result.stdout.trim());assert.equal(raw.ok,true);
  const w=decodeSpatialWorld(raw.world,request);assert.deepEqual(w.placements,raw.world.placements);
  for(const name of ['waterMask','routeMask','bridgeMask','protectedMask'])assert.deepEqual(Array.from(w[name]),Array.from(Buffer.from(raw.world[name],'base64')));
  assert.deepEqual(Array.from(w.elevationUnits),raw.world.elevationUnits);assert.ok(surfaceGeometry(w,request).positions.length>0);
});
