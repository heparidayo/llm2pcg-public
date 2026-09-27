import { defaultRequest } from "/shared/pcg-request.mjs";
import { WorldRenderer } from "/renderer.js";
import { summarizeGeneratedWorld } from "/world-codec.mjs";
import {naturalLanguageNotice} from '/natural-language-status.mjs';

const PROFILE_OPTIONS = {
  Dungeon: ["DefaultDungeon", "CompactDungeon", "SprawlingDungeon"],
  Cave: ["DefaultCave", "CavernousCave", "TightCave"],
  Forest: ["DefaultForest", "DenseForest", "MeadowForest"],
  City: ["DefaultCity", "GridCity", "OrganicCity"],
  Swamp: ["DefaultSwamp", "OpenMarsh", "DenseBog"],
  Snowfield: ["DefaultSnowfield", "SparseTundra", "FrozenGrove"],
  Desert: ["DefaultDesert", "DuneSea", "OasisDesert"]
};

const state = { renderer: null, lastResult: null, summary: null, busy: false, unityBusy: false };
const elements = Object.fromEntries([
  "runtime-status", "runtime-status-label", "direct-form", "natural-form", "world-type", "seed", "map-width", "map-height",
  "generation-profile", "water-threshold", "elevation-scale", "vegetation-distance", "vegetation-maximum", "tree-density",
  "tree-types", "building-min", "building-max", "presentation-preset", "prompt",
  "world-viewport", "viewport-placeholder", "loading-overlay", "world-badge", "badge-world", "badge-hash", "world-title",
  "world-meta", "statistics", "cell-total", "result-summary", "footer-message", "save-local", "load-local", "download-json", "copy-summary",
  "render-unity", "unity-handoff-status", "natural-status"
].map(id => [id, document.getElementById(id)]));
const naturalIdleText=elements['natural-status'].textContent;

initialize();

async function initialize() {
  wireInteractions();
  syncWorldControls();
  document.documentElement.dataset.llm2pcgAppReady = "true";
  window.__llm2pcgReleaseSubmitGuard?.();
  setRendererControlsEnabled(false);
  const manifest = await fetch("/asset-manifest.json").then(response => response.ok ? response.json() : null).catch(() => null);
  try {
    state.renderer = new WorldRenderer(elements["world-viewport"], manifest);
  } catch (error) {
    setRuntimeStatus("error", "WebGL 지원 브라우저 필요");
    elements["viewport-placeholder"].querySelector("p").textContent = "이 브라우저에서는 WebGL 3D context를 만들 수 없습니다.";
    elements["footer-message"].textContent = "Chrome, Edge, Firefox 등 WebGL 지원 브라우저에서 다시 여세요.";
    console.error("Three.js renderer initialization failed:", error);
    return;
  }
  setRendererControlsEnabled(true);
  await checkCoreHealth();
}

function wireInteractions() {
  document.querySelectorAll(".mode-tab").forEach(button => button.addEventListener("click", () => selectMode(button.dataset.mode)));
  elements["world-type"].addEventListener("change", syncWorldControls);
  elements["direct-form"].addEventListener("submit", event => { event.preventDefault(); generateDirect(); });
  elements["natural-form"].addEventListener("submit", event => { event.preventDefault(); generateNatural(); });
  elements.prompt.addEventListener('input',()=>{if(!state.busy)elements['natural-status'].textContent=naturalIdleText;});
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => state.renderer?.fitCamera(button.dataset.view)));
  elements["save-local"].addEventListener("click", saveLocal);
  elements["load-local"].addEventListener("click", loadLocal);
  elements["download-json"].addEventListener("click", downloadJson);
  elements["copy-summary"].addEventListener("click", copySummary);
  elements["render-unity"].addEventListener("click", renderInUnity);
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (!elements["direct-form"].classList.contains("hidden")) generateDirect(); else generateNatural();
    }
  });
}

function selectMode(mode) {
  document.querySelectorAll(".mode-tab").forEach(button => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  elements["direct-form"].classList.toggle("hidden", mode !== "direct");
  elements["natural-form"].classList.toggle("hidden", mode !== "natural");
}

function syncWorldControls() {
  const worldType = elements["world-type"].value;
  const request = defaultRequest(worldType, numberValue("seed"), numberValue("map-width"), numberValue("map-height"));
  elements["generation-profile"].replaceChildren(...PROFILE_OPTIONS[worldType].map(profile => new Option(profile, profile)));
  elements["generation-profile"].value = request.generationProfile;
  const nature = request.generatorSettings.forest;
  if (nature) {
    elements["water-threshold"].value = nature.waterThreshold;
    elements["elevation-scale"].value = nature.elevationScale;
    elements["vegetation-distance"].value = nature.vegetationMinDistance;
    elements["vegetation-maximum"].value = nature.vegetationMaxCount;
  }
  if (request.generatorSettings.city) {
    elements["building-min"].value = request.generatorSettings.city.buildingMinHeight;
    elements["building-max"].value = request.generatorSettings.city.buildingMaxHeight;
  }
}

function createDirectRequest() {
  const worldType = elements["world-type"].value;
  const request = defaultRequest(worldType, integerValue("seed"), integerValue("map-width"), integerValue("map-height"));
  request.generationProfile = elements["generation-profile"].value;
  request.presentationSettings = presentationSettings(elements["presentation-preset"].value);
  if (request.generatorSettings.forest) {
    Object.assign(request.generatorSettings.forest, {
      waterThreshold: numberValue("water-threshold"),
      elevationScale: numberValue("elevation-scale"),
      vegetationMinDistance: numberValue("vegetation-distance"),
      vegetationMaxCount: integerValue("vegetation-maximum")
    });
  }
  if (request.generatorSettings.city) {
    request.generatorSettings.city.buildingMinHeight = numberValue("building-min");
    request.generatorSettings.city.buildingMaxHeight = numberValue("building-max");
  }
  request.visualSettings.trees = {
    density: numberValue("tree-density"),
    maxCount: 0,
    allowedTypes: elements["tree-types"].value.split(",").map(value => value.trim()).filter(Boolean)
  };
  return request;
}

function presentationSettings(preset) {
  if (preset === "PureVoxel") return { geometryMode: "Voxel", propsEnabled: true };
  if (preset === "SurfaceOnly") return { geometryMode: "Surface", propsEnabled: false };
  return { geometryMode: "Surface", propsEnabled: true };
}

function presentationLabel(presentation) {
  if (presentation.geometryMode === "Voxel" && presentation.propsEnabled) return "순수 복셀 · 프롭도 복셀";
  if (presentation.geometryMode === "Surface" && !presentation.propsEnabled) return "자연스러운 지형 · 프롭 제외";
  if (presentation.geometryMode === "Surface" && presentation.propsEnabled) return "자연스러운 지형 · 프롭 에셋";
  return `${presentation.geometryMode} · Props off`;
}

async function generateDirect() {
  if (state.busy || !ensureRendererReady()) return;
  await generate("/api/generate-direct", { request: createDirectRequest() });
}

async function generateNatural() {
  if (state.busy || !ensureRendererReady()) return;
  await generate("/api/generate", { prompt: elements.prompt.value });
}

async function generate(endpoint, payload) {
  setBusy(true);
  const natural=Object.hasOwn(payload,'prompt');
  let notice='';
  if(natural)elements['natural-status'].textContent='요청을 해석하고 맵을 생성하는 중입니다…';
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json();
    notice=naturalLanguageNotice(body);
    if(natural)elements['natural-status'].textContent=notice || naturalIdleText;
    if (!response.ok || !body.ok) throw Object.assign(new Error(body.message || `HTTP ${response.status}`), { code: body.code });
    await displayResult(body);
    setRuntimeStatus("ready", "독립 CoreHost 연결됨");
  } catch (error) {
    if(natural)elements['natural-status'].textContent=[notice,'맵 생성에 실패했습니다. '+error.message].filter(Boolean).join(' ');
    elements["result-summary"].textContent = `${error.code || "GENERATION_FAILED"}\n${error.message}`;
    elements["footer-message"].textContent = "생성 실패";
    setRuntimeStatus("error", "CoreHost 또는 Web 설정 확인 필요");
  } finally {
    setBusy(false);
  }
}

async function displayResult(result) {
  await state.renderer.render(result.world, result.request);
  state.lastResult = result;
  state.summary = summarizeGeneratedWorld(result.world);
  elements["viewport-placeholder"].classList.add("hidden");
  elements["world-badge"].classList.remove("hidden");
  elements["badge-world"].textContent = result.world.worldType.toUpperCase();
  elements["badge-hash"].textContent = result.world.worldHash;
  elements["world-title"].textContent = `${result.world.worldType} · seed ${result.world.seed}`;
  elements["world-meta"].innerHTML = [
    ["Size", `${result.world.width} × ${result.world.height}`],
    ["Generator", result.world.generatorVersion],
    ["World hash", result.world.worldHash],
    ["Contract", `PCGRequest v${result.request.schemaVersion} → World v${result.world.formatVersion}`],
    ["Presentation", presentationLabel(result.request.presentationSettings)],
    ["Runtime", "Standalone .NET"],
    ["Renderer", state.renderer.usedModelAssets ? "Three.js + local GLB" : "Three.js procedural"],
    ["Unity", "Not required"]
  ].map(([term, value]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  renderStatistics(result.world.statistics, result.world.width * result.world.height);
  elements["result-summary"].textContent = JSON.stringify({ request: result.request, world: state.summary }, null, 2);
  elements["render-unity"].disabled = false;
  setUnityHandoffStatus("ready", `Web 결과 ${result.world.worldHash} 준비됨 · Unity Play Mode에서 전송하세요.`);
  elements["footer-message"].textContent = `${result.world.worldType} generated · ${result.world.worldHash}`;
}

function renderStatistics(statistics, total) {
  const entries = Object.entries(statistics || {});
  elements["cell-total"].textContent = `${total.toLocaleString()} cells`;
  elements.statistics.replaceChildren(...entries.map(([label, count]) => {
    const row = document.createElement("div");
    row.className = "stat-row";
    const ratio = label === "Props" ? Math.min(100, count / Math.max(1, total) * 500) : count / Math.max(1, total) * 100;
    row.innerHTML = `<span>${escapeHtml(label)}</span><div class="stat-track"><div class="stat-fill" style="width:${ratio.toFixed(2)}%"></div></div><strong>${Number(count).toLocaleString()}</strong>`;
    return row;
  }));
}

function setBusy(value) {
  state.busy = value;
  elements.prompt.disabled=value;
  elements["loading-overlay"].classList.toggle("hidden", !value);
  document.querySelectorAll(".primary-action").forEach(button => button.disabled = value);
  elements["render-unity"].disabled = value || state.unityBusy || !state.lastResult;
}

function setRendererControlsEnabled(value) {
  document.querySelectorAll(".primary-action, [data-view]").forEach(button => button.disabled = !value);
}

function ensureRendererReady() {
  if (state.renderer) return true;
  setFooter("WebGL 렌더러가 준비되지 않아 생성할 수 없습니다.");
  return false;
}

async function renderInUnity() {
  if (!state.lastResult || state.unityBusy) return;
  state.unityBusy = true;
  elements["render-unity"].disabled = true;
  setUnityHandoffStatus("pending", "Unity Bridge에 동일 PCGRequest를 전송하는 중…");
  try {
    const response = await fetch("/api/render-unity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: state.lastResult.request })
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw Object.assign(new Error(body.message || `HTTP ${response.status}`), { code: body.code });
    const code = body.unity?.code || `HTTP ${body.unityStatus}`;
    setUnityHandoffStatus("success", `${code} · seed ${state.lastResult.world.seed} 대기열 등록 · Unity 화면에서 hash ${state.lastResult.world.worldHash}를 확인하세요.`);
    setFooter(`Unity handoff accepted · ${state.lastResult.world.worldHash}`);
  } catch (error) {
    const message = error.code === "UNITY_BRIDGE_UNAVAILABLE"
      ? "Unity 프로젝트를 열고 Play Mode에서 BRIDGE ONLINE 상태인지 확인하세요."
      : `${error.code || "UNITY_HANDOFF_FAILED"} · ${error.message}`;
    setUnityHandoffStatus("error", message);
    setFooter("Web 결과는 유지됨 · Unity 전송만 실패");
  } finally {
    state.unityBusy = false;
    elements["render-unity"].disabled = !state.lastResult || state.busy;
  }
}

function setUnityHandoffStatus(status, message) {
  elements["unity-handoff-status"].className = `handoff-status ${status}`;
  elements["unity-handoff-status"].textContent = message;
}

async function checkCoreHealth() {
  try {
    const response = await fetch("/api/health");
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.message || "CoreHost unavailable");
    setRuntimeStatus("ready", "독립 CoreHost 연결됨");
    elements["footer-message"].textContent = "Unity 없이 생성 준비 완료";
  } catch {
    setRuntimeStatus("error", "CoreHost가 실행되지 않음");
    elements["footer-message"].textContent = "Standalone CoreHost를 먼저 실행하세요";
  }
}

function setRuntimeStatus(status, message) {
  elements["runtime-status"].classList.remove("ready", "error");
  elements["runtime-status"].classList.add(status);
  elements["runtime-status-label"].textContent = message;
}

function saveLocal() {
  if (!state.lastResult) return setFooter("저장할 월드가 없습니다.");
  localStorage.setItem("llm2pcg.generated-world.v1", JSON.stringify(state.lastResult));
  setFooter(`브라우저에 ${state.lastResult.world.worldHash} 저장 완료`);
}

async function loadLocal() {
  const raw = localStorage.getItem("llm2pcg.generated-world.v1");
  if (!raw) return setFooter("브라우저 저장본이 없습니다.");
  try { await displayResult(JSON.parse(raw)); setFooter("브라우저 저장본을 불러왔습니다."); }
  catch (error) { setFooter(`저장본을 읽지 못했습니다: ${error.message}`); }
}

function downloadJson() {
  if (!state.lastResult) return setFooter("내보낼 월드가 없습니다.");
  const blob = new Blob([JSON.stringify(state.lastResult, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.lastResult.world.worldType.toLowerCase()}-seed${state.lastResult.world.seed}-${state.lastResult.world.worldHash}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function copySummary() {
  if (!state.summary) return setFooter("복사할 결과가 없습니다.");
  await navigator.clipboard.writeText(elements["result-summary"].textContent);
  setFooter("요청과 결과 요약을 복사했습니다.");
}

function setFooter(message) { elements["footer-message"].textContent = message; }
function integerValue(id) { return Number.parseInt(elements[id].value, 10); }
function numberValue(id) { return Number.parseFloat(elements[id].value); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
