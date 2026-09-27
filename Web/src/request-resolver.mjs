import { randomInt, createHash } from "node:crypto";
import { validateSchema } from "../../Shared/schema-validator.mjs";
import { validateRequestV4, intentSchema, semanticCatalog,biomeVersions } from "../../Shared/pcg-request-v4.mjs";
import { analyzePrompt } from "./prompt-intent.mjs";
import { routeDefaults } from "./route-intent.mjs";

export function canonicalJson(value) {
  if(value===null || typeof value!=="object") return JSON.stringify(value);
  if(Array.isArray(value)) return "["+value.map(canonicalJson).join(",")+"]";
  return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonicalJson(value[k])).join(",")+"}";
}
export const requestDigest = request => createHash("sha256").update(canonicalJson(request)).digest("hex");
export const emptyIntent = () => ({intentVersion:1,worldType:null,seed:null,mapWidth:null,mapHeight:null,terrainPreset:null,
  waterMode:null,spatialFeatures:[],route:null,distributionRules:[],unsupported:[]});
function fail(code,message) { throw Object.assign(new Error(message),{code,status:422}); }

export function resolveIntent(draft, {prompt="",seedFactory=()=>randomInt(-2147483648,2147483648)}={}) {
  const shape=validateSchema(draft,intentSchema);
  if(shape) fail("INVALID_INTENT",shape);
  const intent=structuredClone(draft), evidence=[], warnings=[];
  if(intent.unsupported.length) fail("UNSUPPORTED_INTENT",intent.unsupported.join("; "));
  const worldType=intent.worldType??"Forest";
  if(!Object.hasOwn(biomeVersions,worldType)) fail("UNSUPPORTED_WORLD_V4","v4 supports Forest, Desert, Snowfield and Swamp only.");
  const explicit=analyzePrompt(prompt);
  warnings.push(...explicit.warnings.filter(w=>w.code!=="UNSUPPORTED_SPATIAL_LAYOUT" && w.code!=="COUNT_IS_CAP"));
  if(explicit.constraints.some(c=>c.path.startsWith("generatorSettings."))) fail("UNSUPPORTED_INTENT","Legacy algorithm thresholds are not supported in the v4 semantic resolver.");
  for(const c of explicit.constraints) {
    if(["seed","mapWidth","mapHeight"].includes(c.path)) {
      intent[c.path]=c.value; evidence.push({path:c.path,source:"explicit",evidence:c.evidence});
    }
  }
  const seed=intent.seed ?? seedFactory();
  const width=intent.mapWidth ?? 128,height=intent.mapHeight ?? 128,short=Math.min(width,height);
  const features=intent.spatialFeatures.map(f=>{
    if(f.kind!=="River" && f.orientation!==null) fail("INVALID_INTENT","Point landmarks cannot specify a crossing orientation.");
    const size=f.size??"Medium", radius={Small:.15,Medium:.24,Large:.34}[size];
    return {id:f.id,kind:f.kind,placement:f.placement,
      orientation:f.kind==="River"?(f.orientation??(seed%2===0?"NorthSouth":"EastWest")):"None",
      radiusCells:f.kind==="River"?0:Math.max(1,Math.floor(short*radius)),
      widthCells:f.kind==="River"?Math.max(1,Math.round(short*({Small:.04,Medium:.07,Large:.10}[size]))):0,
      heightUnits:f.kind==="Mountain"?({Small:16,Medium:32,Large:64}[size]):0,exclusive:f.exclusive};
  }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const rules=Object.entries(semanticCatalog.categories).map(([category,c])=>({
    category,types:[...c.defaults],amountMode:"RelativeDensity",densityPermille:c.densityPermille,
    maxCount:c.maxCount,minDistanceCells:category==="trees"&&intent.terrainPreset==="Dense"?3:c.minDistance,
    region:"WholeMap",featureId:"",minDistanceToFeature:0,maxDistanceToFeature:0
  }));
  const seen=new Set();
  if(worldType!=="Forest") {
    const trees=rules.find(r=>r.category==="trees"),rocks=rules.find(r=>r.category==="rocks"),water=rules.find(r=>r.category==="waterProps");
    trees.types=[worldType==="Desert"?"dead_tree":worldType==="Snowfield"?"conifer":"willow"];
    trees.densityPermille=worldType==="Desert"?100:worldType==="Swamp"?650:750;
    rocks.densityPermille=worldType==="Swamp"?100:350;
    if(worldType==="Snowfield") {water.amountMode="Off";water.maxCount=0;water.densityPermille=0;}
    evidence.push({path:"distributionRules",source:"biome-default",profile:worldType+"@2"});
  }
  for(const input of intent.distributionRules) {
    if(seen.has(input.category)) fail("CONFLICTING_RULES","Duplicate category: "+input.category);
    seen.add(input.category);
    const r=rules.find(r=>r.category===input.category);
    r.types=input.types.length?[...input.types].sort():r.types;
    r.amountMode=input.amountMode;
    if(input.amountMode!=="Off"&&r.maxCount===0){const defaults=semanticCatalog.categories[input.category];r.maxCount=defaults.maxCount;r.densityPermille=defaults.densityPermille;}
    if(input.amountMode==="Off") {r.maxCount=0;r.densityPermille=0;}
    if(input.amountMode==="AtMost") {
      if(input.amount===null) fail("INVALID_INTENT","AtMost requires amount.");
      r.maxCount=input.amount;r.densityPermille=1000;
    }
    if(input.amountMode==="RelativeDensity") {
      if(input.amount!==null && input.amount>1000) fail("INVALID_INTENT","Relative density must be 0..1000 permille.");
      r.densityPermille=input.amount??r.densityPermille;
    }
    r.region=input.region;r.featureId=input.featureId??"";
    if(input.region==="NearFeature") {r.minDistanceToFeature=1;r.maxDistanceToFeature=Math.max(2,Math.min(12,Math.floor(short*.08)));}
    evidence.push({path:"distributionRules."+input.category,source:"intent"});
  }
  // Existing explicit type/off/count rules remain authoritative, scoped by category.
  for(const c of explicit.constraints.filter(c=>c.path.startsWith("visualSettings."))) {
    const [,category,field]=c.path.split("."),r=rules.find(r=>r.category===category);
    if(field==="allowedTypes") {
      // Legacy empty allowedTypes means unrestricted, not an empty v4 catalog.
      // Off is encoded independently; never turn a removed category into invalid types.
      if(c.value.length)r.types=[...c.value].sort();
    }
    if(field==="density") {r.densityPermille=Math.round(c.value*1000);if(c.value===0){r.amountMode="Off";r.maxCount=0;}}
    if(field==="maxCount") {
      if(r.amountMode==="Off"&&c.value>0) fail("CONFLICTING_RULES","Positive count conflicts with excluded category.");
      r.maxCount=c.value;if(c.value>0){r.amountMode="AtMost";r.densityPermille=1000;}
    }
    evidence.push({path:c.path,source:"explicit",evidence:c.evidence});
  }
  const request={schemaVersion:4,generatorVersion:biomeVersions[worldType],resolverVersion:"pcg-resolver@1",catalogVersion:semanticCatalog.version,
    worldType,seed,mapWidth:width,mapHeight:height,
    terrain:{heightUnits:worldType==="Desert"?40:worldType==="Swamp"?16:24,noiseScale:worldType==="Desert"?40:24,octaves:4,waterLevelUnits:worldType==="Swamp"?7:0},waterMode:intent.waterMode??"Default",
    spatialFeatures:features,route:intent.route??{...routeDefaults},
    distributionRules:rules};
  const invalid=validateRequestV4(request);
  if(invalid) fail("INVALID_RESOLVED_REQUEST",invalid);
  warnings.push({code:"EXPERIMENTAL_V4",message:"Forest v4 is experimental. Unity Editor preview is opt-in on port 8089 (max 256x256); check live status before sending. Web 3D primitive preview at /spatial-v4 requires CoreHost and consumes full v2 output; it does not use Unity asset models or provide navigation."});
  return {request,requestHash:requestDigest(request),interpretation:{resolverVersion:request.resolverVersion,
    seedSource:intent.seed===null?"server-random":evidence.some(e=>e.path==="seed")?"explicit":"intent",
    defaults:{worldType:intent.worldType===null,mapSize:intent.mapWidth===null||intent.mapHeight===null,route:intent.route===null},
    evidence,warnings}};
}
