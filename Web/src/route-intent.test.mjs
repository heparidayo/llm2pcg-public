import test from "node:test";
import assert from "node:assert/strict";
import {emptyIntent, requestDigest} from "./request-resolver.mjs";
import {handleV4, protectSpatialIntent} from "./spatial-v4-api.mjs";

const draft = (route = {}) => ({...emptyIntent(), worldType: "Forest", seed: 234,
  mapWidth: 64, mapHeight: 64, route: {mode: "StraightCrossing", orientation: "NorthSouth",
    widthCells: 1, crossingPolicy: "NoCrossing", ...route}});
const resolve = (prompt, candidate = draft()) => handleV4("/api/v4/resolve", {prompt}, {
  requestIntent: async () => candidate, seedFactory: () => 234
});

test("unmentioned active route details resolve identically across different model guesses", async () => {
  for (const prompt of ["시드 234, 64x64 숲에 도로를 만들어줘.", "Forest, seed 234, 64x64, with a road."]) {
    const a = await resolve(prompt);
    const b = await resolve(prompt, draft({orientation: "EastWest", widthCells: 16, crossingPolicy: "BridgeIfNeeded"}));
    assert.deepEqual(a.request, b.request);
    assert.equal(a.requestHash, b.requestHash);
    assert.deepEqual(a.request.route, {mode: "StraightCrossing", orientation: "EastWest", widthCells: 3, crossingPolicy: "BridgeIfNeeded"});
  }
});

for (const [phrase, width] of [
  ["도로 폭 5칸", 5], ["폭이 6칸인 도로", 6], ["너비 4칸의 길", 4],
  ["7칸짜리 도로", 7], ["road width: 8 cells", 8], ["a 9-cell-wide road", 9],
  ["a path 10 tiles wide", 10], ["a road. Width is 11 cells.", 11],
  ["도로 폭 １칸", 1], ["road width 16", 16]
]) test(`explicit route width overrides model defaults: ${phrase}`, async () => {
  assert.equal((await resolve(phrase)).request.route.widthCells, width);
});

test("river widths and directions cannot supply omitted road parameters", async () => {
  for (const prompt of [
    "남북 방향 폭 8칸의 강, 도로를 만들어줘.",
    "A north-south river 8 cells wide and a road.",
    "A road, and a north-south river 8 cells wide."
  ]) {
    const candidate = {...draft(), spatialFeatures: [{id: "river", kind: "River", placement: "CenterCrossing",
      orientation: "NorthSouth", size: "Medium", exclusive: false}]};
    const protectedDraft = protectSpatialIntent(prompt, candidate);
    assert.equal(protectedDraft.route.widthCells, 3, prompt);
    assert.equal(protectedDraft.route.orientation, "EastWest", prompt);
    assert.deepEqual(protectedDraft.spatialFeatures, candidate.spatialFeatures);
  }
});

test("explicit route orientation and no-crossing policy override model guesses", async () => {
  for (const prompt of ["남북 방향 도로 폭 5칸, 다리 없이", "A north-south road 5 cells wide, without bridges."]) {
    const r = await resolve(prompt, draft({orientation: "EastWest", widthCells: 1, crossingPolicy: "BridgeIfNeeded"}));
    assert.deepEqual(r.request.route, {mode: "StraightCrossing", orientation: "NorthSouth", widthCells: 5, crossingPolicy: "NoCrossing"});
  }
  const r = await resolve("동서 방향 도로와 교량", draft());
  assert.equal(r.request.route.orientation, "EastWest");
  assert.equal(r.request.route.crossingPolicy, "BridgeIfNeeded");
  assert.equal((await resolve("북쪽에서 남쪽으로 맵을 가로지르는 도로")).request.route.orientation, "NorthSouth");
});

test("invalid, conflicting or unsupported explicit widths fail instead of being clamped or defaulted", async () => {
  for (const value of ["0", "17", "-1", "1.5", "1e3", "1/2", "1,000"]) {
    await assert.rejects(resolve(`도로 폭 ${value}칸`), {code: "INVALID_ROUTE_WIDTH"});
  }
  for (const prompt of ["도로 폭 3칸, 도로 폭 5칸", "a north-south road and an east-west road", "a road without bridges, but build bridges"]) {
    await assert.rejects(resolve(prompt), {code: "CONFLICTING_INTENT"});
  }
  for (const prompt of ["도로 폭 5미터", "a 5-meter-wide road", "넓은 도로", "a narrow road", "도로 폭 세 칸", "a road width three cells"]) {
    await assert.rejects(resolve(prompt), {code: "UNSUPPORTED_ROUTE_WIDTH"});
  }
});

test("vertical routes and explicit bridge prohibitions are preserved without confusing double negation", async () => {
  for (const prompt of ["a vertical road, do not build bridges", "세로 도로, 교량 금지"]) {
    const r = await resolve(prompt, draft({orientation: "EastWest", crossingPolicy: "BridgeIfNeeded"}));
    assert.equal(r.request.route.orientation, "NorthSouth");
    assert.equal(r.request.route.crossingPolicy, "NoCrossing");
  }
  assert.equal((await resolve("a road, not without bridges")).request.route.crossingPolicy, "BridgeIfNeeded");
});

test("route length and unrelated numeric constraints are not a road width", async () => {
  for (const prompt of ["시드 234, 64x64 숲, 도로, 나무 최대 12그루", "A road of length 8 cells."]) {
    assert.equal((await resolve(prompt)).request.route.widthCells, 3);
  }
});

test("natural route guards do not change direct Intent, saved JSON or caller-owned drafts", async () => {
  const candidate = draft(), before = structuredClone(candidate);
  await resolve("a road", candidate);
  assert.deepEqual(candidate, before);
  const direct = await handleV4("/api/v4/resolve", {intent: candidate});
  assert.deepEqual(direct.request.route, candidate.route);
  const requestBefore = structuredClone(direct.request);
  for (const endpoint of ["/api/v4/generate-direct", "/api/v4/generate-unity"]) {
    let received;
    const sender = async request => {received = structuredClone(request); return {ok: true};};
    await handleV4(endpoint, {request: direct.request}, {sendV4: sender, sendUnityV4: sender});
    assert.deepEqual(received, requestBefore);
    assert.equal(requestDigest(received), direct.requestHash);
  }
});

test("c07 road-width regression preserves the independent river and explicit road direction", async () => {
  const candidate = {...draft(), worldType: "Snowfield", seed: 4307, mapWidth: null, mapHeight: null,
    spatialFeatures: [{id: "river1", kind: "River", placement: "CenterCrossing", orientation: "NorthSouth", size: null, exclusive: false}]};
  const resolved = await resolve("Snowfield with a north-south river across the center and a straight east-west road, bridging water where necessary. Seed 4307.", candidate);
  assert.deepEqual(resolved.request.route, {mode: "StraightCrossing", orientation: "EastWest", widthCells: 3, crossingPolicy: "BridgeIfNeeded"});
  assert.equal(resolved.request.seed, 4307);
  assert.equal(resolved.request.spatialFeatures[0].orientation, "NorthSouth");
  assert.equal(resolved.request.spatialFeatures[0].id, "river1");
});
