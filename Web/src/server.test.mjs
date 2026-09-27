import assert from "node:assert/strict";
import test from "node:test";
import { applyDefaultWorldComponents, applyForestWaterPolicy, applyPresentationIntent, createWebServer, extractOutputText, validatePcgRequest } from "./server.mjs";
import { defaultRequest, upgradePcgRequest } from "../../Shared/pcg-request.mjs";

const request = defaultRequest("Dungeon", 12345);

test("validates the shared PCG request shape", () => {
  assert.equal(validatePcgRequest(request), null);
  for (const worldType of ["Dungeon", "Cave", "Forest", "City", "Swamp", "Snowfield", "Desert"]) assert.equal(validatePcgRequest(defaultRequest(worldType, 12345)), null);
});

test("supports deterministic visual category controls and cherry blossom filtering contract", () => {
  const forest = defaultRequest("Forest", 7788, 128, 128);
  forest.visualSettings.trees = { density: 0.65, maxCount: 120, allowedTypes: ["cherry_blossom"] };
  assert.equal(validatePcgRequest(forest), null);
  forest.visualSettings.trees.allowedTypes = ["imaginary_tree"];
  assert.match(validatePcgRequest(forest), /visualSettings/);
});

test("validates renderer-only presentation settings without changing generation settings", () => {
  for (const presentationSettings of [
    { geometryMode:"Voxel", propsEnabled:false },
    { geometryMode:"Surface", propsEnabled:false },
    { geometryMode:"Voxel", propsEnabled:true },
    { geometryMode:"Surface", propsEnabled:true }
  ]) {
    const candidate = defaultRequest("Forest", 7788, 128, 128);
    candidate.presentationSettings = presentationSettings;
    assert.equal(validatePcgRequest(candidate), null);
  }
  const invalid = defaultRequest("Forest", 7788);
  invalid.presentationSettings.geometryMode = "Smoothish";
  assert.match(validatePcgRequest(invalid), /presentationSettings/);
});

test("deterministically resolves Korean presentation mode wording after LLM translation", () => {
  const cases = [
    ["순수 복셀 버전의 숲을 만들어줘", { geometryMode:"Voxel", propsEnabled:true }],
    ["자연스러운 지형으로 프롭은 빼고 숲을 만들어줘", { geometryMode:"Surface", propsEnabled:false }],
    ["자연스러운 지형에 프롭 에셋도 추가해서 벚꽃 숲을 만들어줘", { geometryMode:"Surface", propsEnabled:true }],
    ["프롭 없이 복셀 버전의 숲을 만들어줘", { geometryMode:"Voxel", propsEnabled:false }]
  ];
  for (const [prompt, expected] of cases) {
    const candidate = defaultRequest("Forest", 234, 48, 48);
    candidate.presentationSettings = { geometryMode:"Voxel", propsEnabled:false };
    applyPresentationIntent(prompt, candidate);
    assert.deepEqual(candidate.presentationSettings, expected, prompt);
    assert.equal(validatePcgRequest(candidate), null);
  }
});

test("restores default visual components unless natural language explicitly excludes them", () => {
  const plainForest = defaultRequest("Forest", 234, 64, 64);
  plainForest.visualSettings = Object.fromEntries(Object.keys(plainForest.visualSettings).map(key => [key, { density:0, maxCount:0, allowedTypes:[] }]));
  plainForest.presentationSettings = { geometryMode:"Voxel", propsEnabled:false };
  applyPresentationIntent("숲을 만들어줘", plainForest);
  applyDefaultWorldComponents("숲을 만들어줘", plainForest);
  assert.deepEqual(plainForest.presentationSettings, { geometryMode:"Surface", propsEnabled:true });
  for (const category of Object.values(plainForest.visualSettings)) assert.equal(category.density, 1);
  assert.equal(validatePcgRequest(plainForest), null);

  const noTrees = defaultRequest("Forest", 235, 64, 64);
  applyPresentationIntent("숲을 만들지만 나무는 배치하지 말아줘", noTrees);
  applyDefaultWorldComponents("숲을 만들지만 나무는 배치하지 말아줘", noTrees);
  assert.equal(noTrees.presentationSettings.propsEnabled, true);
  assert.equal(noTrees.visualSettings.trees.density, 0);
  assert.equal(noTrees.visualSettings.rocks.density, 1);
  assert.equal(validatePcgRequest(noTrees), null);
});

test("natural Forest caps unrequested water while explicit wet prompts take precedence", () => {
  const cherryForest = defaultRequest("Forest", 234, 128, 128);
  cherryForest.generatorSettings.forest.waterThreshold = 0.46;
  applyForestWaterPolicy("128x128 크기의 숲을 완성형으로 만들어줘. 나무는 벚꽃 같은 나무만 있게 해줘.", cherryForest);
  assert.equal(cherryForest.generatorSettings.forest.waterThreshold, 0.20);

  const wetForest = defaultRequest("Forest", 235, 128, 128);
  wetForest.generatorSettings.forest.waterThreshold = 0.46;
  applyForestWaterPolicy("물이 많고 습한 숲을 만들어줘", wetForest);
  assert.equal(wetForest.generatorSettings.forest.waterThreshold, 0.56);

  const swamp = defaultRequest("Swamp", 236, 128, 128);
  applyForestWaterPolicy("물이 많은 늪을 만들어줘", swamp);
  assert.equal(swamp.generatorSettings.forest.waterThreshold, 0.46);
  assert.equal(defaultRequest("Forest").generatorSettings.forest.waterThreshold, 0.20);
});

test("upgrades schemaVersion 2 payloads with presentation and unrestricted visual defaults", () => {
  const older = defaultRequest("Forest", 7789);
  older.schemaVersion = 2;
  delete older.visualSettings;
  delete older.presentationSettings;
  delete older.layoutSettings;
  const upgraded = upgradePcgRequest(older);
  assert.equal(upgraded.schemaVersion, 3);
  assert.equal(upgraded.visualSettings.trees.density, 1);
  assert.deepEqual(upgraded.visualSettings.trees.allowedTypes, []);
  assert.deepEqual(upgraded.presentationSettings, { geometryMode:"Surface", propsEnabled:true });
  assert.equal(upgraded.layoutSettings.landform.kind, "None");
  assert.equal(upgraded.layoutSettings.water.kind, "Default");
  assert.equal(upgraded.layoutSettings.route.kind, "Default");
  assert.equal(validatePcgRequest(upgraded), null);
});

test("upgrades a legacy v1 Dungeon request to the v3 generator contract", () => {
  const legacy = { ...request, schemaVersion: 1 };
  delete legacy.generatorVersion;
  const upgraded = upgradePcgRequest(legacy);
  assert.equal(upgraded.schemaVersion, 3);
  assert.equal(upgraded.generatorVersion, "dungeon-bsp@1");
  assert.equal(validatePcgRequest(upgraded), null);
});

test("rejects unsupported water and route layout overrides", () => {
  const forest = defaultRequest("Forest", 7790, 128, 128);
  forest.layoutSettings.landform = { kind:"Mountain", placement:"Center", size:"Large", intensity:"High" };
  forest.layoutSettings.water = { kind:"River", placement:"CenterCrossing", size:"Large", meander:"Medium", exclusive:false };
  assert.match(validatePcgRequest(forest), /layoutSettings/);

  const city = defaultRequest("City", 7791, 128, 128);
  city.layoutSettings.route = { kind:"Road", placement:"CenterCrossing", size:"Large", orientation:"Seeded", meander:"Low" };
  assert.match(validatePcgRequest(city), /layoutSettings/);
});

test("rejects requests with more than one active generator branch", () => {
  const invalid = defaultRequest("Dungeon", 12345);
  invalid.generatorSettings.cave = defaultRequest("Cave", 12345).generatorSettings.cave;
  assert.match(validatePcgRequest(invalid), /Exactly one/);
});

test("reports the standalone CoreHost health without Unity", async () => {
  const server = createWebServer({
    readHealth: async () => ({ ok: true, service: "llm2pcg-core-host", unityRequired: false })
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.service, "llm2pcg-core-host");
    assert.equal(body.unityRequired, false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("serves the web shell when the root URL has a query string", async () => {
  const server = createWebServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/?mode=direct`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.match(body, /LLM2PCG/);
    const unityShell = await fetch(`http://127.0.0.1:${address.port}/unity/`);
    assert.equal(unityShell.status, 200);
    assert.match(await unityShell.text(), /LOCAL UNITY PCG DEMO/);
    for (const assetPath of ["/unity/app.js", "/unity/styles.css"]) {
      const assetResponse = await fetch(`http://127.0.0.1:${address.port}${assetPath}`);
      assert.equal(assetResponse.status, 200, `${assetPath} should be served`);
    }
    for (const modulePath of ["/vendor/three.module.js", "/vendor/three.core.js"]) {
      const moduleResponse = await fetch(`http://127.0.0.1:${address.port}${modulePath}`);
      assert.equal(moduleResponse.status, 200, `${modulePath} should be served`);
      assert.match(moduleResponse.headers.get("content-type"), /text\/javascript/);
      assert.ok((await moduleResponse.text()).length > 1000);
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("extracts structured output from a Responses payload", () => {
  const payload = { output: [{ content: [{ type: "output_text", text: JSON.stringify(request) }] }] };
  assert.equal(extractOutputText(payload), JSON.stringify(request));
});

test("generates a renderer-neutral world through the standalone core", async () => {
  let forwarded;
  const generated = {
    formatVersion: 1, worldType: "Dungeon", generatorVersion: "dungeon-bsp@1", seed: 12345,
    width: 100, height: 100, worldHash: "TEST1234", gridEncoding: "base64-u8", floatEncoding: "base64-f32le",
    cellLegend: ["Empty","Floor","Corridor"], cells: "AA==", elevations: null, structureHeights: null
  };
  const server = createWebServer({
    sendRequestToCore: async (pcgRequest) => {
      forwarded = pcgRequest;
      return { ok: true, world: generated };
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/generate-direct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(forwarded, request);
    assert.equal(body.world.worldHash, "TEST1234");
    assert.equal(body.world.formatVersion, 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("forwards the same validated request to the optional Unity renderer", async () => {
  let forwarded;
  const server = createWebServer({
    sendRequestToUnity: async (pcgRequest) => {
      forwarded = pcgRequest;
      return { status: 202, payload: { ok: true, code: "ACCEPTED", seed: pcgRequest.seed } };
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/render-unity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(forwarded, request);
    assert.equal(body.ok, true);
    assert.equal(body.unityStatus, 202);
    assert.equal(body.unity.code, "ACCEPTED");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("keeps the restored Unity-only frontend on namespaced APIs", async () => {
  let forwarded;
  const commands = [];
  const server = createWebServer({
    sendRequestToUnity: async (pcgRequest) => {
      forwarded = pcgRequest;
      return { status: 202, payload: { ok: true, code: "ACCEPTED", seed: pcgRequest.seed } };
    },
    sendCommandToUnity: async (command) => {
      commands.push(command);
      return { status: 202, payload: { ok: true, code: `${command.toUpperCase()}_QUEUED` } };
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const generatedResponse = await fetch(`http://127.0.0.1:${address.port}/api/unity/generate-direct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request })
    });
    const generatedBody = await generatedResponse.json();
    assert.equal(generatedResponse.status, 202);
    assert.deepEqual(forwarded, request);
    assert.equal(generatedBody.unity.code, "ACCEPTED");

    for (const command of ["save", "load"]) {
      const commandResponse = await fetch(`http://127.0.0.1:${address.port}/api/unity/${command}`, { method: "POST" });
      assert.equal(commandResponse.status, 202);
    }
    assert.deepEqual(commands, ["save", "load"]);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("reports an unavailable Unity Bridge without affecting standalone generation", async () => {
  const server = createWebServer({
    sendRequestToUnity: async () => {
      throw Object.assign(new Error("Unity Bridge is unavailable."), { code: "UNITY_BRIDGE_UNAVAILABLE" });
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/render-unity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request })
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.code, "UNITY_BRIDGE_UNAVAILABLE");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("all Nature requests use the forest settings branch and preserve strict biome contracts", () => {
  for (const worldType of ["Swamp","Snowfield","Desert"]) {
    const nature = defaultRequest(worldType, 8800);
    assert.ok(nature.generatorSettings.forest);
    assert.deepEqual([nature.generatorSettings.dungeon,nature.generatorSettings.city,nature.generatorSettings.cave],[null,null,null]);
    assert.equal(validatePcgRequest(nature), null);
  }
  const invalid = defaultRequest("Swamp", 8801); invalid.biome = "Arid";
  assert.match(validatePcgRequest(invalid), /biome/);
});
