import { createServer } from "node:http";
import { handleV4 } from "./spatial-v4-api.mjs";
import {trackAiDelivery} from './ai-delivery.mjs';
import { createResolveCache } from "./resolve-cache.mjs";
import { parseStrictJson } from "../../Shared/strict-json.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { upgradePcgRequest, validatePcgRequest } from "../../Shared/pcg-request.mjs";
import { analyzePrompt, applyExplicitNumbers, applyVisualIntent, explicitPropsIntent, applySwampDefaults } from "./prompt-intent.mjs";
import { applyLandformIntent } from "./terrain-intent.mjs";
import { applyRiverIntent } from './water-intent.mjs';
import { repairNaturalDraft, NATURAL_FALLBACK_POLICY } from "./natural-language-fallback.mjs";
import { formatInterpretationDiagnostic } from "./interpretation-diagnostics.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(moduleDirectory, "../public");
const unityPublicDirectory = path.join(publicDirectory, "unity");
const threeDirectory = path.resolve(moduleDirectory, "../node_modules/three");
const sharedDirectory = path.resolve(moduleDirectory, "../../Shared");
const environmentFile = path.resolve(moduleDirectory, "../.env");
const localAssetManifest = path.join(publicDirectory, "asset-manifest.local.json");
const defaultAssetManifest = path.join(publicDirectory, "asset-manifest.json");
const modelDirectory = path.join(publicDirectory, "assets/models");

await loadEnvironmentFile(environmentFile);

const requestSchema = JSON.parse(await readFile(path.resolve(moduleDirectory, "../../Shared/Schema/pcg-request.schema.json"), "utf8"));
const openAiRequestSchema = toOpenAiStrictSchema(requestSchema);
const coreEndpoint = process.env.PCG_CORE_ENDPOINT ?? "http://127.0.0.1:8090/api/world/generate";
const unityEndpoint = process.env.UNITY_PCG_ENDPOINT ?? "http://127.0.0.1:8088/pcg/generate";
const openAiModel = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";

export { validatePcgRequest };

async function loadEnvironmentFile(filePath) {
  let contents;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Responses strict mode supports a JSON Schema subset. Derive the compatible form from the shared source,
// keeping frontend and generator-core contract values in one authored schema.
function toOpenAiStrictSchema(value) {
  if (Array.isArray(value)) return value.map(toOpenAiStrictSchema);
  if (value === null || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "$schema" || key === "$id" || key === "title") continue;
    if (key === "const") {
      result.enum = [child];
    } else {
      result[key] = toOpenAiStrictSchema(child);
    }
  }
  return result;
}

export function extractOutputText(response) {
  if (response?.status && response.status !== "completed")
    throw Object.assign(new Error("OpenAI response did not complete."), {code:"OPENAI_INCOMPLETE_RESPONSE"});
  for (const item of response?.output ?? [])
    for (const content of item.content ?? [])
      if(content.type==="refusal")
        throw Object.assign(new Error("OpenAI declined to translate this request."), {code:"OPENAI_REFUSAL"});
  if (typeof response.output_text === "string" && response.output_text.length > 0) return response.output_text;
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("OpenAI response did not contain output text.");
}

// Presentation mode is renderer-only, so explicit Korean/English mode wording can be
// made deterministic after the semantic translation without touching world generation.
export function applyPresentationIntent(prompt, request) {
  const text = String(prompt ?? "").normalize("NFKC").toLowerCase();
  const presentation = request.presentationSettings ?? { geometryMode: "Surface", propsEnabled: true };
  const pureVoxelPreset = /(순수\s*복셀|복셀\s*(?:형|스타일)|pure\s*voxel|voxel\s*(?:style|with\s*voxel\s*props?))/i.test(text);
  const naturalTerrainWithAssetsPreset = /(자연(?:스러운)?\s*(?:지형|terrain)[^.!?\n]{0,22}(?:프롭|모델|에셋)[^.!?\n]{0,22}(?:추가|포함|사용|배치|있)|(?:프롭|모델|에셋)[^.!?\n]{0,22}자연(?:스러운)?\s*(?:지형|terrain))/i.test(text);
  const naturalTerrainWithoutPropsPreset = /(자연(?:스러운)?\s*(?:지형|terrain)[^.!?\n]{0,22}(?:프롭|모델|에셋)[^.!?\n]{0,22}(?:없|빼|제외|안\s*들어|미사용)|(?:프롭|모델|에셋)[^.!?\n]{0,22}(?:없|빼|제외|미사용)[^.!?\n]{0,22}자연(?:스러운)?\s*(?:지형|terrain))/i.test(text);
  const completePreset = /(완성형|최종(?:형|본| 버전)?|finished|complete(?:d)?)/i.test(text);
  const voxelPreset = /(초기\s*복셀|복셀\s*(?:만|버전|단계)|voxel\s*(?:only|version|stage))/i.test(text);
  const voxelWithPropsPreset = /(프롭\s*\+\s*복셀|복셀\s*\+\s*프롭|프롭[^.!?\n]{0,12}(?:들어|포함|있는|사용)[^.!?\n]{0,12}복셀|voxel\s*with\s*props)/i.test(text);
  const surfaceWithoutPropsPreset = /((?:비|논)\s*복셀[^.!?\n]{0,16}(?:표면|프롭|모델링)|(?:표면|surface)[^.!?\n]{0,16}(?:만|프롭\s*없|모델링\s*없)|surface\s*(?:only|without\s*props))/i.test(text);
  const noProps = explicitPropsIntent(prompt) === false;
  const withProps = explicitPropsIntent(prompt) === true;
  const hasExplicitPresentationIntent = pureVoxelPreset || naturalTerrainWithAssetsPreset || naturalTerrainWithoutPropsPreset || completePreset || voxelPreset || voxelWithPropsPreset || surfaceWithoutPropsPreset || noProps || withProps;

  // A model response without an explicit presentation instruction must never turn
  // a normal natural-language world into an empty, prop-free preview.
  if (!hasExplicitPresentationIntent) {
    presentation.geometryMode = "Surface";
    presentation.propsEnabled = true;
  }

  if (naturalTerrainWithAssetsPreset || completePreset) {
    presentation.geometryMode = "Surface";
    presentation.propsEnabled = true;
  } else if (naturalTerrainWithoutPropsPreset || surfaceWithoutPropsPreset) {
    presentation.geometryMode = "Surface";
    presentation.propsEnabled = false;
  } else if (pureVoxelPreset || voxelWithPropsPreset || voxelPreset) {
    presentation.geometryMode = "Voxel";
    presentation.propsEnabled = true;
  }

  const nonVoxel = /((?:비|논)\s*복셀|복셀(?:은|이)?\s*(?:아닌|아니게|없이)|표면|non[- ]?voxel|surface)/i.test(text);
  const explicitVoxel = /(^|[^비논])복셀|\bvoxel\b/i.test(text);
  if (!completePreset && !naturalTerrainWithAssetsPreset && !naturalTerrainWithoutPropsPreset) {
    if (nonVoxel) presentation.geometryMode = "Surface";
    else if (explicitVoxel) presentation.geometryMode = "Voxel";
    if (noProps) presentation.propsEnabled = false;
    else if (withProps) presentation.propsEnabled = true;
  }

  request.presentationSettings = presentation;
  // A named preset must not override an explicit omission.
  if (noProps) presentation.propsEnabled = false;
  return request;
}

// Keep the established public helper while using target-scoped domain parsing.
export const applyDefaultWorldComponents = applyVisualIntent;

export function applyForestWaterPolicy(prompt, request) {
  if (request?.worldType !== "Forest" || !request.generatorSettings?.forest) return request;
  const intent = analyzePrompt(prompt);
  const explicit = intent.constraints.some(c=>c.path==="generatorSettings.forest.waterThreshold");
  if (explicit) return applyExplicitNumbers(prompt,request);
  const current=request.generatorSettings.forest.waterThreshold;
  if (intent.waterIntent) request.generatorSettings.forest.waterThreshold=intent.waterIntent.value;
  else if (/습한|습윤한|침수된|범람한|늪\s*(?:같은|처럼)|\b(?:wet|water[- ]rich|flooded|swampy)\b/i.test(String(prompt)))
    request.generatorSettings.forest.waterThreshold=.46;
  else if (Number.isFinite(current)) request.generatorSettings.forest.waterThreshold=Math.min(current,.20);
  return request;
}

export function finalizePcgInterpretation(prompt,candidate) {
  const validationError=validatePcgRequest(candidate);
  if(validationError) throw Object.assign(new Error(validationError),{code:"OPENAI_INVALID_CONTRACT"});
  const request=structuredClone(upgradePcgRequest(candidate));
  applyPromptPolicies(prompt,request);
  const finalError=validatePcgRequest(request);
  if(finalError) throw Object.assign(new Error(finalError),{code:"INVALID_PROMPT_CONSTRAINT"});
  const interpretation=analyzePrompt(prompt);
  warnUnsupportedRiverWorld(request,interpretation);
  if(interpretation.constraints.some(c=>c.path==="layoutSettings.landform.kind"&&c.value==="Mountain") && !["Forest","Swamp","Snowfield","Desert"].includes(request.worldType))
    interpretation.warnings.push({code:"UNSUPPORTED_LANDFORM_WORLD",message:"산 지형은 숲·설원·사막·늪에서 지원합니다. 도시·동굴·던전에는 적용하지 않습니다."});
  return {request,interpretation};
}

function applyPromptPolicies(prompt,request) {
  applyPresentationIntent(prompt,request);
  applyDefaultWorldComponents(prompt,request);
  applySwampDefaults(prompt,request);
  applyForestWaterPolicy(prompt,request);
  applyExplicitNumbers(prompt,request);
  applyLandformIntent(prompt,request);
  applyRiverIntent(prompt,request);
}

export function resolveNaturalDraft(prompt,candidate,{reason}={}) {
  const initial=repairNaturalDraft(prompt,candidate);
  applyPromptPolicies(prompt,initial.request);
  const final=repairNaturalDraft(prompt,initial.request);
  const interpretation=analyzePrompt(prompt);
  warnUnsupportedRiverWorld(final.request,interpretation);
  if(interpretation.constraints.some(c=>c.path==='layoutSettings.landform.kind'&&c.value==='Mountain')&&
     !['Forest','Swamp','Snowfield','Desert'].includes(final.request.worldType))
    interpretation.warnings.push({code:'UNSUPPORTED_LANDFORM_WORLD',message:'이 바이옴은 산 지형을 지원하지 않아 기본 지형으로 생성했습니다.'});
  const replacements=[...initial.replacements,...final.replacements];
  const used=Boolean(reason||replacements.length);
  interpretation.fallback={used,policy:NATURAL_FALLBACK_POLICY,reason:reason??null,replacements};
  if(used) interpretation.warnings.push({code:'DEFAULTS_APPLIED',message:reason
    ?'자연어 해석을 완료하지 못해 인식 가능한 조건과 기본 설정으로 맵을 생성했습니다.'
    :'지원하지 않거나 잘못된 설정을 기본값으로 바꾸어 맵을 생성했습니다.'});
  return {request:final.request,interpretation};
}

export async function requestPcgFromOpenAi(prompt, fetchImplementation = fetch) {
  return finalizePcgInterpretation(prompt,await requestCandidateFromOpenAi(prompt,fetchImplementation)).request;
}

function warnUnsupportedRiverWorld(request,interpretation) {
  if(!['Forest','Swamp','Snowfield','Desert'].includes(request.worldType)&&
     interpretation.constraints.some(c=>c.path==='layoutSettings.water'&&c.value.kind==='River'))
    interpretation.warnings.push({code:'UNSUPPORTED_WATER_WORLD',message:'중앙 강은 숲·사막·설원·늪에서 지원합니다.'});
}

export async function requestCandidateFromOpenAi(prompt, fetchImplementation = fetch, {onDelivery} = {}) {
 return trackAiDelivery(prompt,{model:openAiModel,onDelivery},async tracker=>{
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("OPENAI_API_KEY is not configured for the Web middleware.");
    error.code = "OPENAI_API_KEY_MISSING";
    throw error;
  }

  const lexicalIntent=analyzePrompt(prompt);
  const response = await tracker.fetch(fetchImplementation,"https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openAiModel,
      store: false,
      input: [
        {
          role: "developer",
          content: "Translate the user's request into exactly one schemaVersion 3 PCGRequest JSON object. Support Dungeon/Stone/dungeon-bsp@1, Cave/Stone/cave-cellular@1, Forest/Temperate/forest-biome@1, City/Temperate/city-hybrid-wfc@1, Swamp/Wetland/swamp-biome@1, Snowfield/Arctic/snowfield-biome@1, and Desert/Arid/desert-biome@1. Swamp, Snowfield, and Desert reuse exactly generatorSettings.forest; all inactive branches must be null. Choose only a profile valid for the worldType. Use noiseOctaves 3-6 and practical biome ranges. For a normal Forest use waterThreshold 0.20. When the user explicitly requests water, a lake, pond, river, stream, or wet forest, use 0.46 (0.56 for abundant water, 0.30 for little water). A normal Swamp uses 0.46. Include trees by default. Set waterThreshold 0 only when the user explicitly requests no water. Keep tree density 1 unless explicitly asked to omit or reduce trees. Disable propSettings outside Dungeon. Always emit all visualSettings and layoutSettings fields. Empty visual allowedTypes means unrestricted; density 1 and maxCount 0 mean default/unlimited. Default policy: unless the user explicitly asks to omit or reduce a category, keep every visual category at density 1/maxCount 0. A plain forest must keep all normal visual categories. Map 벚꽃/사쿠라 to trees [cherry_blossom], 활엽수 [broadleaf], 침엽수/소나무 [conifer], 버드나무 [willow], 고사목 [dead_tree], 야자수 [palm], 선인장 [cactus], 바위 to rocks [rock], 덤불 [bush], 갈대 [reeds], and 풀/꽃/식물/버섯/그루터기/통나무/가지/가시덤불 to matching groundDetails. A phrase such as '나무는 벚꽃만' restricts only trees. Interpret 없게 as density 0, 적게 as about .35, 많이 as 1. Use null specialRooms outside Dungeon. Do not explain the JSON or expose algorithms."
        },
        {
          role: "developer",
          content: "Terrain support: Forest, Swamp, Snowfield and Desert can have ONE Mountain landform. Emit layoutSettings.landform kind Mountain, placement Center/North/South/East/West/Seeded, size Small/Medium/Large, intensity Low/Medium/High. 중앙/가운데/중심 -> Center, 북쪽 -> North, 남쪽 -> South, 동쪽 -> East, 서쪽 -> West; unspecified location -> Seeded. 큰 산 -> Large/High, 작은 산 -> Small/Low, 높은 산 -> intensity High, 낮은 산/완만한 언덕 -> intensity Low. Size controls footprint; intensity controls height. Preserve normal elevationScale (background terrain), vegetation and assets when adding a mountain. A forest with a mountain remains Forest. No requested mountain or explicitly no mountain -> landform None/Seeded/Medium/Medium. City/Cave/Dungeon always use that neutral landform. Only a single mountain is supported: multiple peaks, valleys and plateaus are unsupported. Nature worlds support ONE straight river through the map center: water kind River, placement CenterNorthSouth for 남북/north-south or CenterEastWest for 동서/east-west, size Small/Medium/Large, meander Low, exclusive false unless water outside the river is explicitly prohibited. An unspecified river direction defaults to CenterNorthSouth. Preserve the biome water threshold for explicit rivers unless the user gives a threshold. Other water layouts remain Default/Seeded/Medium/Low/exclusive false. Always keep route Default/Seeded/Medium/Seeded/Low. Off-center rivers, specified lakes and roads remain unsupported. 툰드라 -> Snowfield with SparseTundra. 푸릇푸릇/울창 -> Forest with DenseForest, vegetationMinDistance about 3-4, vegetationMaxCount at least 650, and unrestricted visual categories at density 1."
        },
        {
          role: "developer",
          content: "Always emit presentationSettings. It changes rendering only and never the generated world. Default -> Surface,true. 순수 복셀/복셀 버전 -> Voxel,true; the Web renderer draws both terrain and props as voxels. 자연스러운 지형 with 프롭 제외/프롭 없이 -> Surface,false. 자연스러운 지형 with 프롭 에셋 추가, 완성형/최종/finished -> Surface,true. Explicitly omitting props/assets always sets propsEnabled false. When geometry and prop wording are separate, obey both explicitly."
        },
        {
          role:"developer",
          content:"Domain lexer constraints from the user are listed below. Preserve these explicit values; maxCount is an upper bound, not an exact placement guarantee. For all other meaning use the user's description. Capability warnings describe limits, not supported features. Do not turn a subtype exclusion into deleting the whole category.\n"+JSON.stringify({constraints:lexicalIntent.constraints.map(({path,value})=>({path,value})),warnings:lexicalIntent.warnings.map(({code})=>code)})
        },
        { role: "user", content: prompt }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "pcg_request",
          strict: true,
          schema: openAiRequestSchema
        }
      }
    })
  });

  const body = await response.json().catch(() => {
    throw Object.assign(new Error("OpenAI returned a non-JSON response."),{code:"OPENAI_INVALID_RESPONSE"});
  });
  tracker.received(body);
  if (!response.ok) {
    const error = new Error(body.error?.message ?? "OpenAI request failed.");
    error.code = "OPENAI_REQUEST_FAILED";
    throw error;
  }

  let request;
  try {
    request = JSON.parse(extractOutputText(body));
  } catch (cause) {
    if (cause.code === "OPENAI_REFUSAL" || cause.code === "OPENAI_INCOMPLETE_RESPONSE") throw cause;
    const error = new Error("OpenAI returned invalid PCG JSON.");
    error.code = "OPENAI_INVALID_JSON";
    error.cause = cause;
    throw error;
  }
  return request;
 });
}

export async function sendToCore(request, fetchImplementation = fetch) {
  const response = await fetchImplementation(coreEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message ?? `Standalone CoreHost returned ${response.status}.`);
    error.code = payload.code ?? "CORE_REQUEST_FAILED";
    throw error;
  }
  if (!payload.world || payload.world.formatVersion !== 1) {
    const error = new Error("Standalone CoreHost returned an unsupported GeneratedWorld document.");
    error.code = "INVALID_GENERATED_WORLD";
    throw error;
  }
  return payload;
}

export async function readCoreHealth(fetchImplementation = fetch) {
  const endpoint = new URL("/health", coreEndpoint);
  const response = await fetchImplementation(endpoint);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message ?? `Standalone CoreHost returned ${response.status}.`);
    error.code = payload.code ?? "CORE_HOST_UNAVAILABLE";
    throw error;
  }
  return payload;
}

export async function sendToUnity(request, fetchImplementation = fetch) {
  let response;
  try {
    response = await fetchImplementation(unityEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
  } catch (cause) {
    const error = new Error("Unity 생성 서버에 연결할 수 없습니다. Unity 프로젝트에서 Play Mode를 실행해 주세요.");
    error.code = "UNITY_BRIDGE_UNAVAILABLE";
    error.cause = cause;
    throw error;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message ?? `Unity Bridge returned ${response.status}.`);
    error.code = payload.code ?? "UNITY_REQUEST_FAILED";
    error.upstreamStatus = response.status;
    throw error;
  }
  return { status: response.status, payload };
}

export async function sendUnityDiagnostics(message, fetchImplementation = fetch) {
  if(!message) return;
  try {
    await fetchImplementation(new URL('/pcg/diagnostics',unityEndpoint), {
      method:'POST', headers:{'X-PCG-Diagnostics':message}, signal:AbortSignal.timeout(500)
    });
  } catch { /* Diagnostics must not interrupt standalone generation when Unity is offline. */ }
}

export async function sendUnitySnapshotCommand(command, fetchImplementation = fetch) {
  const endpoint = new URL(command === "save" ? "/pcg/save" : "/pcg/load", unityEndpoint);
  let response;
  try {
    response = await fetchImplementation(endpoint, { method: "POST" });
  } catch (cause) {
    const error = new Error("Unity 생성 서버에 연결할 수 없습니다. Unity 프로젝트에서 Play Mode를 실행해 주세요.");
    error.code = "UNITY_BRIDGE_UNAVAILABLE";
    error.cause = cause;
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message ?? `Unity Bridge returned ${response.status}.`);
    error.code = payload.code ?? "UNITY_REQUEST_FAILED";
    throw error;
  }
  return { status: response.status, payload };
}

async function readJsonBody(request, strict = false) {
  if(strict) {
    const chunks=[];let bytes=0;
    for await(const chunk of request){bytes+=chunk.length;if(bytes>65536)throw new Error("Request body too large");chunks.push(chunk);}
    return parseStrictJson(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
  }
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 65536) throw new Error("Request body is too large.");
  }
  return JSON.parse(body);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function sendStatic(response, filePath, contentType) {
  try {
    const contents = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
    response.end(contents);
  } catch {
    response.writeHead(404).end();
  }
}

async function sendPreferredStatic(response, preferredPath, fallbackPath, contentType) {
  try {
    const contents = await readFile(preferredPath);
    response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
    response.end(contents);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await sendStatic(response, fallbackPath, contentType);
  }
}

function safeStaticPath(root, prefix, requestUrl, extension) {
  const relative = decodeURIComponent(requestUrl.slice(prefix.length));
  if (!relative || relative.includes("\\") || relative.split("/").includes("..") || !relative.toLowerCase().endsWith(extension)) return null;
  const resolved = path.resolve(root, relative);
  return resolved.startsWith(`${path.resolve(root)}${path.sep}`) ? resolved : null;
}

export function createWebServer({ requestPcg = requestCandidateFromOpenAi, sendRequestToCore = sendToCore, sendRequestToUnity = sendToUnity, sendCommandToUnity = sendUnitySnapshotCommand, sendDiagnosticsToUnity = sendUnityDiagnostics, readHealth = readCoreHealth, enableExperimentalV4 = false, v4Options = {} } = {}) {
  v4Options={resolveCache:createResolveCache(),...v4Options};
  return createServer(async (request, response) => {
    let aiDelivery;
    try {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (pathname.startsWith("/api/v4/")) {
        if(!enableExperimentalV4)return sendJson(response,410,{ok:false,code:'SPATIAL_V4_RETIRED',message:'실험용 Spatial v4 Web 경로는 폐기했습니다. /unity 화면을 사용해 주세요.'});
        try {
          if (request.method === "GET" && ["/api/v4/capabilities","/api/v4/unity-status","/api/v4/examples"].includes(pathname)) return sendJson(response,200,await handleV4(pathname,null,v4Options));
          if (request.method !== "POST" || !["/api/v4/resolve","/api/v4/new-seed","/api/v4/generate-direct","/api/v4/generate-unity"].includes(pathname)) return sendJson(response,404,{ok:false,code:"NOT_FOUND"});
          // v4 browser writes must come through our same-origin JSON UI, not a cross-site form.
          if (!["127.0.0.1","localhost"].includes(new URL(`http://${request.headers.host}`).hostname)) return sendJson(response,403,{ok:false,code:"HOST_NOT_ALLOWED"});
          if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) return sendJson(response,403,{ok:false,code:"ORIGIN_NOT_ALLOWED"});
          if (!(request.headers["content-type"]??"").toLowerCase().startsWith("application/json")) return sendJson(response,415,{ok:false,code:"JSON_REQUIRED"});
          let body;
          try { body=await readJsonBody(request,true); } catch { return sendJson(response,400,{ok:false,code:"INVALID_JSON_BODY"}); }
          return sendJson(response,200,await handleV4(pathname,body,v4Options));
        } catch (error) { return sendJson(response,error.status??502,{ok:false,code:error.code??"V4_PIPELINE_FAILED",message:error.message,aiDelivery:error.aiDelivery}); }
      }
      if (request.method === "GET" && pathname === "/") return sendStatic(response, path.join(publicDirectory, "index.html"), "text/html; charset=utf-8");
      if (request.method === "GET" && ["/spatial-v4","/spatial-v4/"].includes(pathname)) {response.writeHead(308,{Location:'/unity'});return response.end();}
      if (request.method === "GET" && pathname === "/strict-json.mjs") return sendStatic(response,path.join(sharedDirectory,"strict-json.mjs"),"text/javascript; charset=utf-8");
      if (request.method === "GET" && pathname === "/natural-language-status.mjs") return sendStatic(response,path.join(publicDirectory,"natural-language-status.mjs"),"text/javascript; charset=utf-8");
      if (request.method === "GET" && (pathname === "/unity" || pathname === "/unity/")) return sendStatic(response, path.join(unityPublicDirectory, "index.html"), "text/html; charset=utf-8");
      if (request.method === "GET" && pathname === "/unity/app.js") return sendStatic(response, path.join(unityPublicDirectory, "app.js"), "text/javascript; charset=utf-8");
      if (request.method === "GET" && pathname === "/unity/styles.css") return sendStatic(response, path.join(unityPublicDirectory, "styles.css"), "text/css; charset=utf-8");
      if (request.method === "GET" && pathname === "/app.js") return sendStatic(response, path.join(publicDirectory, "app.js"), "text/javascript; charset=utf-8");
      if (request.method === "GET" && pathname === "/renderer.js") return sendStatic(response, path.join(publicDirectory, "renderer.js"), "text/javascript; charset=utf-8");
      if (request.method === "GET" && pathname === "/world-codec.mjs") return sendStatic(response, path.join(publicDirectory, "world-codec.mjs"), "text/javascript; charset=utf-8");
      if (request.method === "GET" && pathname === "/styles.css") return sendStatic(response, path.join(publicDirectory, "styles.css"), "text/css; charset=utf-8");
      if (request.method === "GET" && pathname === "/asset-manifest.json") return sendPreferredStatic(response, localAssetManifest, defaultAssetManifest, "application/json; charset=utf-8");
      if (request.method === "GET" && pathname === "/vendor/three.module.js") return sendStatic(response, path.join(threeDirectory, "build/three.module.js"), "text/javascript; charset=utf-8");
      if (request.method === "GET" && pathname === "/vendor/three.core.js") return sendStatic(response, path.join(threeDirectory, "build/three.core.js"), "text/javascript; charset=utf-8");
      if (request.method === "GET" && pathname === "/vendor/OrbitControls.js") return sendStatic(response, path.join(threeDirectory, "examples/jsm/controls/OrbitControls.js"), "text/javascript; charset=utf-8");
      if (request.method === "GET" && pathname.startsWith("/vendor/addons/")) {
        const filePath = safeStaticPath(path.join(threeDirectory, "examples/jsm"), "/vendor/addons/", pathname, ".js");
        return filePath ? sendStatic(response, filePath, "text/javascript; charset=utf-8") : sendJson(response, 404, { ok: false, code: "NOT_FOUND" });
      }
      if (request.method === "GET" && pathname.startsWith("/assets/models/")) {
        const filePath = safeStaticPath(modelDirectory, "/assets/models/", pathname, ".glb");
        return filePath ? sendStatic(response, filePath, "model/gltf-binary") : sendJson(response, 404, { ok: false, code: "NOT_FOUND" });
      }
      if (request.method === "GET" && pathname === "/shared/pcg-request.mjs") return sendStatic(response, path.join(sharedDirectory, "pcg-request.mjs"), "text/javascript; charset=utf-8");
      if (request.method === "GET" && pathname === "/api/health") return sendJson(response, 200, await readHealth());
      if (request.method === "POST" && (pathname === "/api/unity/save" || pathname === "/api/unity/load")) {
        const command = pathname.endsWith("/save") ? "save" : "load";
        const unityResponse = await sendCommandToUnity(command);
        return sendJson(response, 202, { ok: true, unityStatus: unityResponse.status, unity: unityResponse.payload });
      }
      const generationPaths = ["/api/generate", "/api/generate-direct", "/api/render-unity", "/api/unity/generate", "/api/unity/generate-direct"];
      if (request.method !== "POST" || !generationPaths.includes(pathname)) return sendJson(response, 404, { ok: false, code: "NOT_FOUND" });

      let body;
      try { body=await readJsonBody(request); }
      catch { return sendJson(response,400,{ok:false,code:"INVALID_JSON_BODY",message:"A valid JSON request body is required (maximum 65536 characters)."}); }
      if(!body||typeof body!=="object"||Array.isArray(body))return sendJson(response,400,{ok:false,code:"INVALID_JSON_BODY",message:"A JSON object is required."});
      let pcgRequest, interpretation;
      if (pathname === "/api/generate-direct" || pathname === "/api/render-unity" || pathname === "/api/unity/generate-direct") {
        pcgRequest = upgradePcgRequest(body.request);
        const validationError = validatePcgRequest(pcgRequest);
        if (validationError) return sendJson(response, 400, { ok: false, code: "INVALID_PCG_REQUEST", message: validationError });
        aiDelivery={status:'not-requested',reason:'확정 JSON으로 생성합니다.'};
      } else {
        const prompt = body.prompt;
        if (typeof prompt !== "string" || prompt.length > 4000) return sendJson(response, 400, { ok: false, code: "INVALID_PROMPT", message: "prompt must be a string of at most 4000 characters." });
        let candidate,reason;
        if(!prompt.trim()) {reason='EMPTY_PROMPT';aiDelivery={status:'not-sent',outcome:'not-sent',prompt:''};}
        else {
          aiDelivery={status:'unconfirmed',prompt:prompt.trim()};
          try {candidate=await requestPcg(prompt.trim(),undefined,{onDelivery:receipt=>{aiDelivery=receipt;}});}
          catch(error) {reason='INTERPRETATION_UNAVAILABLE';aiDelivery=error.aiDelivery??aiDelivery;}
        }
        ({request:pcgRequest,interpretation}=resolveNaturalDraft(prompt.trim(),candidate,{reason}));
        aiDelivery.fallbackUsed=interpretation.fallback.used;
        aiDelivery.fallbackReason=interpretation.fallback.reason;
        const diagnostic=formatInterpretationDiagnostic(pcgRequest,interpretation);
        if(diagnostic) {
          try { await sendDiagnosticsToUnity(diagnostic); }
          catch { /* Diagnostic delivery is independent of map generation. */ }
        }
      }
      if (pathname === "/api/render-unity") {
        const unityResponse = await sendRequestToUnity(pcgRequest);
        return sendJson(response, 200, { ok: true, request: pcgRequest, unityStatus: unityResponse.status, unity: unityResponse.payload,aiDelivery });
      }
      if (pathname.startsWith("/api/unity/")) {
        const unityResponse = await sendRequestToUnity(pcgRequest);
        return sendJson(response, 202, { ok: true, request: pcgRequest, unityStatus: unityResponse.status, unity: unityResponse.payload,aiDelivery });
      }
      const coreResponse = await sendRequestToCore(pcgRequest);
      return sendJson(response, 200, { ok: true, request: pcgRequest, world: coreResponse.world,aiDelivery });
    } catch (error) {
      const status = error.code==="INVALID_PROMPT_CONSTRAINT" ? 400
        : error.code==="OPENAI_REFUSAL" ? 422
        : ["OPENAI_API_KEY_MISSING", "CORE_HOST_UNAVAILABLE", "UNITY_BRIDGE_UNAVAILABLE"].includes(error.code) ? 503 : 502;
      return sendJson(response, status, { ok: false, code: error.code ?? "WEB_PIPELINE_ERROR", message: error.message,aiDelivery });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.WEB_PORT ?? 3000);
  createWebServer().listen(port, "127.0.0.1", () => console.log(`LLM2PCG Web UI listening on http://127.0.0.1:${port}`));
}
