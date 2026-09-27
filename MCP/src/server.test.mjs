import assert from "node:assert/strict";
import test from "node:test";
import { createMcpHandler } from "./server.mjs";
import { defaultRequest } from "../../Shared/pcg-request.mjs";
import {emptyIntent,resolveIntent} from "../../Web/src/request-resolver.mjs";
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test("MCP v4 targets CoreHost with exact request; rejects malformed request before forwarding",async()=>{
  const request=resolveIntent({...emptyIntent(),seed:234}).request;let calls=0;
  const handler=createMcpHandler({v4Endpoint:"http://core.test/v4",fetchImplementation:async(url,opts)=>{
    calls++;assert.equal(url,"http://core.test/v4");assert.deepEqual(JSON.parse(opts.body),request);
    return new Response(JSON.stringify({ok:true,summary:{worldHash:"test"}}));
  }});
  const result=await handler({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"generate_world_v4",arguments:{request}}});
  assert.equal(result.result.isError,undefined);
  const bad=await handler({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"generate_world_v4",arguments:{request:{}}}});
  assert.equal(bad.result.isError,true);assert.equal(calls,1);
});

test('MCP v4 enforces its argument envelope without forwarding hidden options',async()=>{
 let calls=0;const handler=createMcpHandler({fetchImplementation:async()=>{calls++;throw Error('must not forward');}});
 const request=resolveIntent({...emptyIntent(),seed:1}).request;
 for(const args of [null,[],{request,seed:2},{request,prompt:'forest'},{unknown:request}]) {
  const r=await handler({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'generate_world_v4',arguments:args}});
  assert.equal(r.result.isError,true);
 }
 assert.equal(calls,0);
});

test('MCP forwards all eight public gallery requests unchanged without LLM interpretation',async()=>{
 const gallery=JSON.parse(readFileSync(new URL('../../Shared/Examples/spatial-v4-gallery.json',import.meta.url),'utf8'));let expected,calls=0;
 const handler=createMcpHandler({fetchImplementation:async(_url,options)=>{calls++;assert.deepEqual(JSON.parse(options.body),expected);return new Response(JSON.stringify({ok:true}));}});
 for(const c of gallery){expected=c.request;const r=await handler({jsonrpc:'2.0',id:c.id,method:'tools/call',params:{name:'generate_world_v4',arguments:{request:expected}}});assert.notEqual(r.result.isError,true,c.id);}
 assert.equal(calls,8);
});

const fixtureUrl=new URL('../../Web/src/fixtures/spatial-v4/contract-cases.json',import.meta.url);
test('MCP uses the same 80 valid/invalid contract fixtures as Node and C#',async()=>{
 let forwarded=0;const handler=createMcpHandler({fetchImplementation:async()=>{forwarded++;return new Response(JSON.stringify({ok:true}));}});
 const fixtures=JSON.parse(readFileSync(fixtureUrl,'utf8'));
 for(const c of fixtures){const before=forwarded;const r=await handler({jsonrpc:'2.0',id:c.id,method:'tools/call',params:{name:'generate_world_v4',arguments:{request:c.request}}});assert.equal(!r.result.isError,c.valid,c.id);assert.equal(forwarded-before,c.valid?1:0,c.id);}
 assert.equal(fixtures.length,80);
});

test('stdio rejects decoded duplicate JSON keys before dispatch',async()=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url))],{windowsHide:true});let output='',errors='';
 child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>errors+=b);
 const exit=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 child.stdin.end('{"jsonrpc":"2.0","id":1,"method":"tools/list","meth\\u006fd":"tools/list"}\n');
 assert.equal(await exit,0,errors);assert.equal(JSON.parse(output).error.code,-32700);
});

const request = defaultRequest("Cave", 12345);

test("lists generate_world and the generate_dungeon compatibility alias", async () => {
  const response = await createMcpHandler()({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.deepEqual(response.result.tools.map((tool) => tool.name), ["generate_world", "generate_dungeon", "generate_world_v4"]);
});

test("forwards a validated request to Unity", async () => {
  let forwarded;
  const handler = createMcpHandler({
    unityEndpoint: "http://unity.test/pcg/generate",
    fetchImplementation: async (url, options) => {
      forwarded = { url, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ ok: true, code: "ACCEPTED" }), { status: 202 });
    }
  });
  const response = await handler({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "generate_world", arguments: { request } } });
  assert.equal(forwarded.url, "http://unity.test/pcg/generate");
  assert.deepEqual(forwarded.body, request);
  assert.equal(response.result.isError, undefined);
});

test("generate_dungeon alias upgrades legacy v1 requests before forwarding", async () => {
  let forwarded;
  const legacy = defaultRequest("Dungeon", 777);
  legacy.schemaVersion = 1;
  delete legacy.generatorVersion;
  const handler = createMcpHandler({ fetchImplementation: async (_url, options) => { forwarded = JSON.parse(options.body); return new Response(JSON.stringify({ ok: true }), { status: 202 }); } });
  const response = await handler({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "generate_dungeon", arguments: { request: legacy } } });
  assert.equal(response.result.isError, undefined);
  assert.equal(forwarded.schemaVersion, 3);
  assert.equal(forwarded.generatorVersion, "dungeon-bsp@1");
  assert.equal(forwarded.layoutSettings.landform.kind, "None");
  assert.equal(forwarded.layoutSettings.water.kind, "Default");
  assert.equal(forwarded.layoutSettings.route.kind, "Default");
});

test("generate_world rejects unsupported spatial layout overrides", async () => {
  let forwarded;
  const spatial = defaultRequest("Forest", 34001, 128, 128);
  spatial.layoutSettings.landform = { kind:"Valley", placement:"Center", size:"Large", intensity:"High" };
  const handler = createMcpHandler({ fetchImplementation: async (_url, options) => { forwarded = JSON.parse(options.body); return new Response(JSON.stringify({ok:true}), {status:202}); } });
  const response = await handler({ jsonrpc:"2.0",id:4,method:"tools/call",params:{name:"generate_world",arguments:{request:spatial}} });
  assert.equal(response.result.isError, true);
  assert.equal(forwarded, undefined);
});

test("generate_world forwards supported mountain and central river layouts unchanged",async()=>{
  let forwarded;
  const handler=createMcpHandler({fetchImplementation:async(_url,options)=>{
    forwarded=JSON.parse(options.body);return new Response(JSON.stringify({ok:true}),{status:202});
  }});
  for(const world of ['Forest','Swamp','Snowfield','Desert']) {
    const request=defaultRequest(world,234,128,128);
    request.layoutSettings.landform={kind:'Mountain',placement:'Center',size:'Large',intensity:'High'};
    request.layoutSettings.water={kind:'River',placement:'CenterNorthSouth',size:'Medium',meander:'Low',exclusive:true};
    const response=await handler({jsonrpc:'2.0',id:world,method:'tools/call',params:{name:'generate_world',arguments:{request}}});
    assert.notEqual(response.result.isError,true,world);
    assert.deepEqual(forwarded,request,world);
  }
});

test("generate_world preserves presentation settings for Unity", async () => {
  let forwarded;
  const candidate = defaultRequest("Cave", 34011, 64, 64);
  candidate.presentationSettings = { geometryMode:"Voxel", propsEnabled:true };
  const handler = createMcpHandler({ fetchImplementation: async (_url, options) => { forwarded = JSON.parse(options.body); return new Response(JSON.stringify({ok:true}), {status:202}); } });
  const response = await handler({ jsonrpc:"2.0",id:41,method:"tools/call",params:{name:"generate_world",arguments:{request:candidate}} });
  assert.equal(response.result.isError, undefined);
  assert.deepEqual(forwarded.presentationSettings, candidate.presentationSettings);
});

test("generate_world accepts every Nature biome contract", async () => {
  const forwarded = [];
  const handler = createMcpHandler({ fetchImplementation: async (_url, options) => { forwarded.push(JSON.parse(options.body)); return new Response(JSON.stringify({ok:true}), {status:202}); } });
  for (const worldType of ["Swamp","Snowfield","Desert"]) {
    const response = await handler({ jsonrpc:"2.0",id:worldType,method:"tools/call",params:{name:"generate_world",arguments:{request:defaultRequest(worldType,991)}} });
    assert.equal(response.result.isError, undefined);
  }
  assert.deepEqual(forwarded.map((value) => value.worldType), ["Swamp","Snowfield","Desert"]);
  assert.ok(forwarded.every((value) => value.generatorSettings.forest && value.generatorSettings.city === null));
});
