import { readFileSync } from "node:fs";
import { validateSchema } from "./schema-validator.mjs";
export const requestV4Schema = JSON.parse(readFileSync(new URL("./Schema/pcg-request-v4.schema.json", import.meta.url), "utf8"));
export const intentSchema = JSON.parse(readFileSync(new URL("./Schema/pcg-intent.schema.json", import.meta.url), "utf8"));
export const semanticCatalog = JSON.parse(readFileSync(new URL("./Capabilities/semantic-forest-v1.json", import.meta.url), "utf8"));
export const biomeVersions={Forest:"forest-biome@2",Desert:"desert-biome@2",Snowfield:"snowfield-biome@2",Swamp:"swamp-biome@2"};
export const capabilitiesV4 = {
  experimental:true, schemaVersion:4, worldTypes:Object.keys(biomeVersions), generatorVersion:"forest-biome@2", generatorVersions:biomeVersions,
  rendererReady:true, unityReady:false, stages:["headless-spatial","semantic-placement","web-primitive-preview"],
  webPreview:{supported:false,retired:true,requiresCoreHost:true,maximumMapSize:500,formatVersion:2,path:null,generateEndpoint:null,profile:"web-primitive-forest@1"},
  unityEditorPreview:{supported:true,requiresOptIn:true,maximumMapSize:256,statusEndpoint:"/api/v4/unity-status",generateEndpoint:"/api/v4/generate-unity",profile:"primitive-forest@1"},
  unsupported:["City/Cave/Dungeon spatial controls","Exact counts","clustering","navigation guarantee"],
  catalog:semanticCatalog
};
export function validateRequestV4(request) {
  const shape = validateSchema(request,requestV4Schema);
  if(shape) return shape;
  if(biomeVersions[request.worldType]!==request.generatorVersion)return "World/generator version mismatch.";
  const ids = new Set(), kinds = new Set();
  for(const f of request.spatialFeatures) {
    if(ids.has(f.id) || kinds.has(f.kind)) return "Duplicate feature ID or kind.";
    ids.add(f.id); kinds.add(f.kind);
    if(f.kind==="River") {
      if(f.placement!=="CenterCrossing" || f.orientation==="None" || f.widthCells<1 || f.radiusCells!==0 || f.heightUnits!==0)
        return "River requires crossing direction and width only.";
    } else {
      if(f.placement==="CenterCrossing" || f.orientation!=="None" || f.radiusCells<1 || f.widthCells!==0)
        return "Landmark requires radius and point placement only.";
      if(f.kind==="Mountain" && (f.heightUnits<1 || f.exclusive)) return "Mountain requires height and cannot be exclusive.";
      if(f.kind==="Lake" && f.heightUnits!==0) return "Lake cannot add height.";
      if(f.radiusCells > Math.floor(Math.min(request.mapWidth,request.mapHeight)*0.4)) return "Feature radius exceeds map capacity.";
    }
    if(f.kind!=="Mountain" && request.waterMode==="None") return "Water feature conflicts with waterMode None.";
  }
  if(request.spatialFeatures.some(f=>f.kind!=="Mountain"&&f.exclusive) && kinds.has("River") && kinds.has("Lake")) return "Exclusive water feature conflicts with another water feature.";
  const categories = new Set();
  for(const r of request.distributionRules) {
    if(categories.has(r.category)) return "One distribution rule per category is supported.";
    categories.add(r.category);
    const known=semanticCatalog.categories[r.category].types;
    if(!r.types.length || new Set(r.types).size!==r.types.length || r.types.some(t=>!known.includes(t))) return "Unsupported or duplicate semantic type.";
    if(r.minDistanceToFeature>r.maxDistanceToFeature) return "Invalid feature distance interval.";
    if(r.region==="NearFeature") {
      if(!ids.has(r.featureId)) return "Unknown feature reference.";
    } else if(r.featureId!=="" || r.minDistanceToFeature!==0 || r.maxDistanceToFeature!==0) return "Inactive feature distances must be zero.";
    if(r.amountMode==="Off" && (r.maxCount!==0 || r.densityPermille!==0)) return "Off must have zero density and cap.";
    if(r.amountMode==="AtMost" && r.densityPermille!==1000) return "AtMost uses full candidate density.";
  }
  if(categories.size!==5) return "All five resolved categories are required.";
  return null;
}
