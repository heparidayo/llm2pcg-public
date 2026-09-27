import {validatePcgRequest} from '../../Shared/pcg-request.mjs';
import {semanticCatalog,biomeVersions,validateRequestV4} from '../../Shared/pcg-request-v4.mjs';
import {emptyIntent,resolveIntent,requestDigest} from './request-resolver.mjs';

// Explicit proposal only. Neither existing snapshots nor API routes invoke this.
export function proposeV4Migration(source) {
  const fail=message=>{throw Object.assign(new Error(message),{code:'MIGRATION_REQUIRES_REVIEW'});};
  if(source?.schemaVersion!==3)fail('Only explicit v3 requests are accepted; upgrade older contracts separately.');
  const invalid=validatePcgRequest(source);if(invalid)fail(invalid);
  if(!Object.hasOwn(biomeVersions,source.worldType))fail('City/Cave/Dungeon do not have a v4 spatial adapter.');
  if(source.propSettings.enabled)fail('Legacy gameplay props have no v4 semantic equivalent.');
  if(source.layoutSettings?.landform?.kind==="Mountain")fail('A v3 Mountain must be recreated explicitly in v4; migration would discard the requested landform.');
  if(source.layoutSettings?.water?.kind==='River')fail('A v3 River must be recreated explicitly in v4; migration would discard the requested river.');
  const {request}=resolveIntent({...emptyIntent(),worldType:source.worldType,seed:source.seed,mapWidth:source.mapWidth,mapHeight:source.mapHeight});
  const warnings=[
    'Generator changes to @2. This is a new world, NOT an identical v3 replay.',
    'Legacy noise, elevation, clearing and vegetation settings are replaced by the versioned v4 biome defaults; review terrain values.',
    'Legacy neutral water/route settings become v4 Default water and None route. The old automatic path layout is not preserved.',
    'Renderer style and gameplay props are not migrated. v4 primitive appearance differs from v3.'
  ];
  for(const rule of request.distributionRules) {
    const old=source.visualSettings?.[rule.category];if(!old)fail('Complete v3 visualSettings are required for an explicit migration.');
    if(old.allowedTypes.some(t=>!semanticCatalog.categories[rule.category].types.includes(t)))fail('Unsupported v4 type in '+rule.category+': '+old.allowedTypes.join(', '));
    if(old.allowedTypes.length)rule.types=[...old.allowedTypes].sort();
    const off=source.presentationSettings?.propsEnabled===false||old.density===0;
    rule.amountMode=off?'Off':'RelativeDensity';rule.densityPermille=off?0:Math.round(old.density*1000);
    rule.maxCount=off?0:old.maxCount===0?10000:old.maxCount;
    if(!off&&old.maxCount===0)warnings.push(rule.category+': v3 maxCount=0 meant no explicit cap, NOT Off. Proposed v4 safety cap is 10000; review it.');
    if(!off&&old.density*1000!==rule.densityPermille)warnings.push(rule.category+': density rounded to integer permille.');
  }
  const error=validateRequestV4(request);if(error)fail(error);
  return {ok:true,requiresReview:true,sourceRequestHash:requestDigest(source),requestHash:requestDigest(request),request,
    retained:['worldType','seed','mapWidth','mapHeight','supported visual types','explicit zero density/hidden props','positive count caps'],
    replaced:{generatorVersion:source.generatorVersion,generationProfile:source.generationProfile,generatorSettings:source.generatorSettings,layoutSettings:source.layoutSettings,presentationSettings:source.presentationSettings},warnings};
}
