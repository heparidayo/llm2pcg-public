import {readFile} from 'node:fs/promises';
import {defaultRequest,validatePcgRequest} from '../../Shared/pcg-request.mjs';

const schema=JSON.parse(await readFile(new URL('../../Shared/Schema/pcg-request.schema.json',import.meta.url),'utf8'));
const worlds=schema.properties.worldType.enum;
export const NATURAL_FALLBACK_POLICY='pcg-natural-fallback@1';
const nature=new Set(['Forest','Swamp','Snowfield','Desert']);
const worldWords=[['Dungeon',/던전|\bdungeon\b/giu],['Cave',/동굴|\bcave\b/giu],
  ['Forest',/숲|삼림|\bforest\b/giu],['City',/도시|\bcity\b/giu],
  ['Swamp',/늪|습지|\b(?:swamp|marsh)\b/giu],['Snowfield',/설원|툰드라|\b(?:snowfield|tundra)\b/giu],
  ['Desert',/사막|\bdesert\b/giu]];

export function fallbackWorld(prompt) {
  const text=String(prompt??'').normalize('NFKC');
  const matches=worldWords.flatMap(([world,pattern])=>[...text.matchAll(pattern)].map(m=>({world,index:m.index})));
  // A final explicit world noun is a predictable fallback for descriptions such as '숲 같은 도시'.
  return matches.sort((a,b)=>a.index-b.index).at(-1)?.world??'Forest';
}

function dereference(spec,value) {
  if(spec?.$ref) return dereference(schema.$defs[spec.$ref.split('/').at(-1)],value);
  if(spec?.anyOf) {
    const choices=spec.anyOf.map(s=>dereference(s,value));
    return choices.find(s=>s.properties?.kind?.const===value?.kind)??choices.find(s=>s.type!=='null')??{};
  }
  return spec??{};
}

function validLeaf(value,spec) {
  if(Object.hasOwn(spec,'const')&&value!==spec.const) return false;
  if(spec.enum&&!spec.enum.includes(value)) return false;
  if(spec.type==='string'&&(typeof value!=='string'||value.trim().length<(spec.minLength??0))) return false;
  if(spec.type==='boolean'&&typeof value!=='boolean') return false;
  if(spec.type==='number'||spec.type==='integer') {
    if(!Number.isFinite(value)) return false;
    if(spec.type==='integer'&&(!Number.isInteger(value)||value < -2147483648||value > 2147483647)) return false;
    if(spec.minimum!==undefined&&value<spec.minimum||spec.maximum!==undefined&&value>spec.maximum) return false;
    if(spec.exclusiveMinimum!==undefined&&Math.fround(value)<=spec.exclusiveMinimum) return false;
  }
  return value!==undefined;
}

/** Repair only natural-language drafts. Direct JSON continues to use strict validation. */
export function repairNaturalDraft(prompt,candidate) {
  const object=candidate&&typeof candidate==='object'&&!Array.isArray(candidate)?candidate:{};
  const world=worlds.includes(object.worldType)?object.worldType:fallbackWorld(prompt);
  const defaults=defaultRequest(world,234,128,128);
  const replacements=[];
  const replace=(path,value,reason='invalid-or-missing')=>{
    replacements.push({path,value:structuredClone(value),reason});
    return structuredClone(value);
  };
  function merge(value,fallback,spec,path) {
    spec=dereference(spec,value);
    if(fallback===null) return value===null?null:replace(path,null,'inactive-for-world');
    if(Array.isArray(fallback)) {
      if(!Array.isArray(value)) return replace(path,fallback);
      const filtered=value.filter(item=>validLeaf(item,dereference(spec.items,item)));
      return filtered.length===value.length?[...filtered]:replace(path,filtered,'unsupported-type');
    }
    if(typeof fallback==='object') {
      if(!value||typeof value!=='object'||Array.isArray(value)) return replace(path,fallback);
      return Object.fromEntries(Object.keys(fallback).map(key=>[key,merge(value[key],fallback[key],spec.properties?.[key],path?path+'.'+key:key)]));
    }
    return validLeaf(value,spec)?value:replace(path,fallback);
  }
  const request=merge(object,defaults,schema,'');
  for(const key of ['schemaVersion','worldType','biome','generatorVersion'])
    if(request[key]!==defaults[key]) request[key]=replace(key,defaults[key],'world-contract');
  if(validatePcgRequest({...defaults,generationProfile:request.generationProfile}))
    request.generationProfile=replace('generationProfile',defaults.generationProfile,'world-contract');
  if(!nature.has(world)&&request.layoutSettings.landform.kind!=='None')
    request.layoutSettings.landform=replace('layoutSettings.landform',defaults.layoutSettings.landform,'unsupported-for-world');
  if(world==='Dungeon'&&request.generatorSettings.dungeon.minLeafSize>=Math.min(request.mapWidth,request.mapHeight))
    request.generatorSettings.dungeon.minLeafSize=replace('generatorSettings.dungeon.minLeafSize',defaults.generatorSettings.dungeon.minLeafSize,'map-size');
  if(world==='City'&&request.generatorSettings.city.buildingMinHeight>request.generatorSettings.city.buildingMaxHeight)
    for(const key of ['buildingMinHeight','buildingMaxHeight'])
      request.generatorSettings.city[key]=replace('generatorSettings.city.'+key,defaults.generatorSettings.city[key],'height-range');
  // A final guard protects the generator if a future contract adds cross-field rules.
  const error=validatePcgRequest(request);
  if(error) {
    const safe=defaultRequest(world,defaults.seed,defaults.mapWidth,defaults.mapHeight);
    return {request:replace('',safe,'contract-fallback'),replacements};
  }
  return {request,replacements};
}
