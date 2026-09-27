import {naturalLanguageNotice} from '/natural-language-status.mjs';
const form = document.querySelector("#generator-form");
const promptInput = document.querySelector("#prompt");
const result = document.querySelector("#result");
const naturalStatus = document.querySelector("#natural-status");
const directForm = document.querySelector("#direct-generator-form");
const directResult = document.querySelector("#direct-result");
const natureDefaults = {
  Swamp: { biome:"Wetland", profile:"DefaultSwamp", version:"swamp-biome@1", waterThreshold:.46, clearingRadius:12, vegetationMinDistance:4.5, vegetationMaxCount:500, elevationScale:3.5, elevationFrequency:.03, profiles:["DefaultSwamp","OpenMarsh","DenseBog"] },
  Snowfield: { biome:"Arctic", profile:"DefaultSnowfield", version:"snowfield-biome@1", waterThreshold:.18, clearingRadius:16, vegetationMinDistance:6, vegetationMaxCount:320, elevationScale:8, elevationFrequency:.025, profiles:["DefaultSnowfield","SparseTundra","FrozenGrove"] },
  Desert: { biome:"Arid", profile:"DefaultDesert", version:"desert-biome@1", waterThreshold:.08, clearingRadius:18, vegetationMinDistance:8, vegetationMaxCount:180, elevationScale:10, elevationFrequency:.018, profiles:["DefaultDesert","DuneSea","OasisDesert"] }
};

function showResult(target, body) {
  target.textContent = JSON.stringify(body, null, 2);
  target.classList.toggle("error", body.ok === false);
}

function integerValue(id) { return Number.parseInt(document.querySelector(`#${id}`).value, 10); }
function numberValue(id) { return Number.parseFloat(document.querySelector(`#${id}`).value); }
function listValue(id) { return document.querySelector(`#${id}`).value.split(",").map(value => value.trim()).filter(Boolean); }
function defaultVisualCategory() { return { density: 1, maxCount: 0, allowedTypes: [] }; }
function presentationSettings() {
  const preset = document.querySelector("#presentation-preset").value;
  if (preset === "VoxelOnly") return { geometryMode:"Voxel", propsEnabled:false };
  if (preset === "SurfaceOnly") return { geometryMode:"Surface", propsEnabled:false };
  if (preset === "VoxelWithProps") return { geometryMode:"Voxel", propsEnabled:true };
  return { geometryMode:"Surface", propsEnabled:true };
}
function defaultLayout() {
  return {
    landform: { kind:"None", placement:"Seeded", size:"Medium", intensity:"Medium" },
    water: { kind:"Default", placement:"Seeded", size:"Medium", meander:"Low", exclusive:false },
    route: { kind:"Default", placement:"Seeded", size:"Medium", orientation:"Seeded", meander:"Low" }
  };
}

function createVisualSettings() {
  return {
    trees: { density:numberValue("tree-density"), maxCount:integerValue("tree-max-count"), allowedTypes:listValue("tree-types") },
    rocks: defaultVisualCategory(),
    bushes: defaultVisualCategory(),
    groundDetails: defaultVisualCategory(),
    waterProps: defaultVisualCategory()
  };
}

function createDirectRequest() {
  const worldType = document.querySelector("#world-type").value;
  const common = {
    schemaVersion:3,
    seed:integerValue("seed"),
    worldType,
    mapWidth:integerValue("map-width"),
    mapHeight:integerValue("map-height"),
    propSettings:{enabled:false,density:0,maxCount:0,allowedTypes:[]},
    visualSettings:createVisualSettings(),
    presentationSettings:presentationSettings(),
    layoutSettings:defaultLayout(),
    specialRooms:null
  };
  if (worldType === "Cave") return { ...common, biome:"Stone", generationProfile:"DefaultCave", generatorVersion:"cave-cellular@1", generatorSettings:{dungeon:null,city:null,forest:null,cave:{fillPercent:46,automataSteps:5,minimumRegionSize:24,tunnelRadius:1,extraTunnelCount:1}} };
  if (worldType === "Forest") return { ...common, biome:"Temperate", generationProfile:"DefaultForest", generatorVersion:"forest-biome@1", generatorSettings:{dungeon:null,city:null,forest:{waterThreshold:.20,noiseOctaves:4,clearingRadius:14,vegetationMinDistance:4,vegetationMaxCount:600,elevationScale:numberValue("forest-elevation-scale"),elevationFrequency:numberValue("forest-elevation-frequency")},cave:null} };
  if (natureDefaults[worldType]) {
    const defaults = natureDefaults[worldType];
    const selectedProfile = document.querySelector("#nature-generation-profile").value;
    return { ...common, biome:defaults.biome, generationProfile:defaults.profiles.includes(selectedProfile)?selectedProfile:defaults.profile, generatorVersion:defaults.version, generatorSettings:{dungeon:null,city:null,cave:null,forest:{waterThreshold:numberValue("nature-water-threshold"),noiseOctaves:4,clearingRadius:defaults.clearingRadius,vegetationMinDistance:numberValue("nature-vegetation-distance"),vegetationMaxCount:integerValue("nature-vegetation-maximum"),elevationScale:numberValue("forest-elevation-scale"),elevationFrequency:numberValue("forest-elevation-frequency")}} };
  }
  if (worldType === "City") return { ...common, biome:"Temperate", generationProfile:"DefaultCity", generatorVersion:"city-hybrid-wfc@1", generatorSettings:{dungeon:null,city:{hubMinDistance:20,hubMaxCount:8,roadWidth:2,extraLoopCount:2,wfcBacktrackLimit:64,wfcRestartLimit:2,buildingMinHeight:numberValue("city-building-min-height"),buildingMaxHeight:numberValue("city-building-max-height")},forest:null,cave:null} };
  const bossCount = integerValue("boss-count");
  const propsEnabled = document.querySelector("#props-enabled").checked;
  return {
    ...common,
    generatorVersion:"dungeon-bsp@1",
    worldType:"Dungeon",
    biome:"Stone",
    generationProfile:document.querySelector("#generation-profile").value,
    generatorSettings:{dungeon:{maxDepth:integerValue("max-depth"),minLeafSize:integerValue("min-leaf-size")},city:null,forest:null,cave:null},
    propSettings:{enabled:propsEnabled,density:numberValue("prop-density"),maxCount:integerValue("prop-max-count"),allowedTypes:listValue("prop-types")},
    specialRooms:{boss:{enabled:bossCount>0,count:bossCount,placement:"FarthestFromStart"},treasure:roomSetting("treasure-count"),shop:roomSetting("shop-count"),secret:roomSetting("secret-count")}
  };
}

function roomSetting(id) {
  const count = integerValue(id);
  return { enabled:count > 0, count, placement:"FarthestFromStart" };
}

async function sendSnapshotCommand(path) {
  directResult.classList.remove("error");
  directResult.textContent = "Unity snapshot command is being sent…";
  try {
    const response = await fetch(path, { method:"POST" });
    showResult(directResult, await response.json());
  } catch (error) {
    showResult(directResult, { ok:false, code:"NETWORK_ERROR", message:error.message });
  }
}

directForm.addEventListener("submit", async event => {
  event.preventDefault();
  directResult.classList.remove("error");
  directResult.textContent = "Unity에 직접 요청을 전송하는 중…";
  try {
    const response = await fetch("/api/unity/generate-direct", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({request:createDirectRequest()}) });
    showResult(directResult, await response.json());
  } catch (error) {
    showResult(directResult, { ok:false, code:"NETWORK_ERROR", message:error.message });
  }
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  result.textContent = "Generating request with OpenAI and sending it to Unity…";
  naturalStatus.textContent = "요청을 해석하고 맵을 생성하는 중입니다…";
  try {
    const response = await fetch("/api/unity/generate", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({prompt:promptInput.value}) });
    const body = await response.json();
    const {interpretation,aiDelivery,...displayBody}=body;
    showResult(result, displayBody);
    const generationStatus = body.ok
      ? "Unity에 맵 생성 요청을 보냈습니다."
      : (body.message || "맵 생성 서비스 연결을 확인해 주세요.");
    naturalStatus.textContent=[naturalLanguageNotice(body),generationStatus].filter(Boolean).join(' ');
  } catch (error) {
    showResult(result, { ok:false, code:"NETWORK_ERROR", message:error.message });
    naturalStatus.textContent = "Web 서버 연결을 확인해 주세요.";
  }
});
promptInput.addEventListener('input',()=>{naturalStatus.textContent='';});

document.querySelector("#save-snapshot").addEventListener("click", () => sendSnapshotCommand("/api/unity/save"));
document.querySelector("#load-snapshot").addEventListener("click", () => sendSnapshotCommand("/api/unity/load"));
document.querySelector("#world-type").addEventListener("change", event => {
  const defaults = natureDefaults[event.target.value];
  if (!defaults) return;
  document.querySelector("#nature-generation-profile").value = defaults.profile;
  document.querySelector("#nature-water-threshold").value = defaults.waterThreshold;
  document.querySelector("#nature-vegetation-distance").value = defaults.vegetationMinDistance;
  document.querySelector("#nature-vegetation-maximum").value = defaults.vegetationMaxCount;
  document.querySelector("#forest-elevation-scale").value = defaults.elevationScale;
  document.querySelector("#forest-elevation-frequency").value = defaults.elevationFrequency;
});
