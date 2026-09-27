// Protect explicit, single-landform wording after LLM translation. Open-ended semantics stay with the LLM.
const neutral = () => ({kind:"None",placement:"Seeded",size:"Medium",intensity:"Medium"});
const mountainNoun = /(?<![\p{L}])(?:산(?=이|은|을|에|만|도|\s|$)|언덕(?=이|은|을|에|만|도|\s|$))|\b(?:mountains?|hills?)\b/giu;
const directions = /중앙|가운데|중심|북쪽|남쪽|동쪽|서쪽|\b(?:central|centre|center|north|south|east|west)\b/giu;
const placements = {중앙:"Center",가운데:"Center",중심:"Center",북쪽:"North",남쪽:"South",동쪽:"East",서쪽:"West",central:"Center",centre:"Center",center:"Center",north:"North",south:"South",east:"East",west:"West"};

export function analyzeLandformPrompt(prompt) {
  const text=String(prompt??"").normalize("NFKC").toLowerCase();
  const nouns=[...text.matchAll(mountainNoun)];
  const constraints=[],warnings=[];
  const add=(field,value,evidence)=>constraints.push({path:"layoutSettings.landform."+field,value,evidence});
  if(nouns.length>1 || /산맥|여러\s*(?:개의?\s*)?산|(?:산|봉우리)\s*(?:두|세|[2-9])\s*개|\b(?:two|three|multiple|several)\s+(?:mountains?|peaks?)\b/i.test(text)) {
    warnings.push({code:"SINGLE_LANDFORM_LIMIT",message:"현재 지형 배치는 산 하나만 지원합니다. 여러 봉우리나 산맥은 정확히 재현하지 못합니다."});
    return {constraints,warnings};
  }
  if(!nouns.length) return {constraints,warnings};
  const noun=nouns[0];
  const prefix=text.slice(0,noun.index).split(/[,;.!?\n]|그리고|하지만|\bbut\b/).at(-1);
  const suffix=text.slice(noun.index+noun[0].length).split(/[,;.!?\n]|그리고|하지만|\bbut\b/)[0];
  const excluded=/\b(?:no|without|remove|exclude)\s+(?:(?:a|the|big|large|small|central)\s+)*$/i.test(prefix)
    || /^(?:이|은|을|를)?\s*(?:없이|없게|없는|없어|빼|제외|제거|만들지\s*마)/.test(suffix);
  const keep=/빼지\s*말|제외하지\s*말|제거하지\s*말|없지\s*않|\b(?:not without|do not remove|don't remove)\b/i.test(prefix+" "+suffix);
  if(excluded&&!keep) {
    for(const [field,value] of Object.entries(neutral())) add(field,value,noun[0]+suffix);
    return {constraints,warnings};
  }
  add("kind","Mountain",noun[0]);
  // Stop at a new scenery noun so e.g. '산이 있고 중앙에 호수' cannot move the mountain.
  const after=suffix.split(/숲|나무|호수|강|도로|\b(?:forest|trees?|lake|river|road)\b/)[0];
  const locations=[...prefix.matchAll(directions),...after.matchAll(directions)];
  if(locations.length===1) add("placement",placements[locations[0][0]],locations[0][0]);
  const adjectives=prefix.match(/(?:큰|거대한|커다란|작은|높은|낮은|완만한|넓은|크지만|고|지만|\s)+$/)?.[0]??"";
  const english=prefix.match(/\b(?:(?:a|the|big|large|huge|small|tall|high|low|gentle|wide|central|and)\s+)+$/)?.[0]??"";
  const modifiers=adjectives+" "+english;
  const large=/큰|거대한|커다란|넓은|크지만|\b(?:big|large|huge|wide)\b/.test(modifiers);
  const small=/작은|\bsmall\b/.test(modifiers);
  const low=/낮은|완만한|\b(?:low|gentle)\b/.test(modifiers)||/언덕|hill/.test(noun[0]);
  const high=/높은|\b(?:tall|high)\b/.test(modifiers);
  if(large&&!small) add("size","Large",modifiers.trim());
  if(small&&!large) add("size","Small",modifiers.trim());
  if(low&&!high) add("intensity","Low",modifiers.trim());
  else if(high||large) add("intensity","High",modifiers.trim());
  else if(small) add("intensity","Low",modifiers.trim());
  return {constraints,warnings};
}

export function applyLandformIntent(prompt,request) {
  if(!["Forest","Swamp","Snowfield","Desert"].includes(request.worldType)) return request;
  const {constraints}=analyzeLandformPrompt(prompt);
  for(const {path,value} of constraints) request.layoutSettings.landform[path.split(".").at(-1)]=value;
  return request;
}
