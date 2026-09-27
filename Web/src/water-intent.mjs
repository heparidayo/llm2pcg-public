// Preserve explicit river geometry even when the model or provider falls back.
export function analyzeRiverPrompt(prompt) {
  const text=String(prompt??'').normalize('NFKC').toLowerCase();
  const rivers=[...text.matchAll(/강(?=이|은|을|물|\s|$)|\b(?:river|stream)\b/gu)];
  if(!rivers.length)return {constraints:[],supported:false};
  const scope=text.slice(Math.max(0,rivers[0].index-40));
  if(/(?:강|river|stream)(?:이|은|을)?\s*(?:없|빼|제외|제거)|\b(?:no|without)\s+(?:a\s+)?(?:river|stream)\b/u.test(scope))
    return {constraints:[{path:'layoutSettings.water',value:{kind:'Default',placement:'Seeded',size:'Medium',meander:'Low',exclusive:false},evidence:scope}],supported:true};
  if(rivers.length>1||/강\s*(?:두|세|[2-9])\s*개|여러\s*(?:개의?\s*)?강|\b(?:two|multiple|several)\s+rivers\b/u.test(text))return {constraints:[],supported:false};
  // Off-center placement stays unsupported; do not silently move an eastern river.
  if(/(?:동쪽|서쪽|북쪽|남쪽)에\s*강|\briver\s+(?:in|on)\s+the\s+(?:east|west|north|south)\b/u.test(text))return {constraints:[],supported:false};
  const ns=/남북|북남|북(?:쪽)?에서\s*남|\bnorth[ -]*(?:to[ -]*)?south\b|\bsouth[ -]*(?:to[ -]*)?north\b/u.test(text);
  const ew=/동서|서동|동(?:쪽)?에서\s*서|\beast[ -]*(?:to[ -]*)?west\b|\bwest[ -]*(?:to[ -]*)?east\b/u.test(text);
  if(ns&&ew)return {constraints:[],supported:false};
  const size=/넓은\s*강|큰\s*강|\b(?:wide|large)\s+river\b/u.test(text)?'Large'
    :/좁은\s*강|작은\s*강|\b(?:narrow|small)\s+river\b/u.test(text)?'Small':'Medium';
  const exclusive=/강\s*(?:밖|바깥)|강\s*(?:안|내)에?만|물은?\s*강에만|\bonly\s+(?:the\s+)?river\b/u.test(text);
  return {constraints:[{path:'layoutSettings.water',value:{kind:'River',placement:ew?'CenterEastWest':'CenterNorthSouth',size,meander:'Low',exclusive},evidence:scope}],supported:true};
}

export function applyRiverIntent(prompt,request) {
  if(!['Forest','Swamp','Snowfield','Desert'].includes(request.worldType))return request;
  const {constraints}=analyzeRiverPrompt(prompt);
  for(const {value} of constraints)request.layoutSettings.water=structuredClone(value);
  return request;
}
