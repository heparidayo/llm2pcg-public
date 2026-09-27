import { analyzeLandformPrompt } from "./terrain-intent.mjs";
import { analyzeRiverPrompt } from './water-intent.mjs';
import { defaultRequest } from "../../Shared/pcg-request.mjs";
// Domain lexemes, not the model's BPE tokens. Offsets refer to NFKC-normalized text.
// LLM owns open-ended semantics; these rules protect explicit, bounded constraints.
const categories = {
  trees: [["나무","수목","트리","trees?","vegetation"], {
    cherry_blossom:["벚꽃","사쿠라","cherry blossom"], broadleaf:["활엽수","broadleaf"],
    conifer:["침엽수","소나무","conifer","pine"], willow:["버드나무","willow"],
    dead_tree:["고사목","dead tree"], palm:["야자수","palm"], cactus:["선인장","cactus"]
  }],
  rocks: [["바위","돌","rocks?"], {ice:["얼음","ice"]}],
  bushes: [["덤불","관목","bush(?:es)?"], {}],
  groundDetails: [["지표식물","ground details?"], {
    grass:["풀","grass"], flower:["꽃","flowers?"], plant:["식물","고사리","plants?","fern"],
    mushroom:["버섯","mushrooms?"], stump:["그루터기","stumps?"], log:["통나무","logs?"],
    branch:["가지","branches"], thorn:["가시덤불","thorns?"]
  }],
  waterProps: [["수초","수변\\s*소품","수생\\s*식물","water props?","water plants?","aquatic plants?"], {
    reeds:["갈대","reeds"], lily_pad:["수련","lily pads?"], water_lily:["연꽃","water lil(?:y|ies)"]
  }]
};
const lexemes = Object.entries(categories).flatMap(([category,[generic,types]]) =>
  [...generic.map(pattern=>({category,pattern})),
    ...Object.entries(types).flatMap(([type,patterns])=>patterns.map(pattern=>({category,type,pattern})))]);
const waterLexemes = ["(?<![가-힣])물(?!고기|감|건|체|류|품)", "수면", "호수", "연못", "개울", "강(?=가|이|은|을|도|물|\\s|$)", "water", "lakes?", "ponds?", "rivers?", "streams?"].map(pattern=>({category:"water",pattern}));
const separator = /[,;!?\n。]|\.(?!\d)|\b(?:but|and)\b|하지만|그리고|그러나/giu;
const negative = /없|빼|제외|제거|미사용|(?:사용|배치|넣|표시)하지|안\s*(?:배치|넣|두|보이)|\b(?:no|without|remove|exclude)\b/i;
const doubleNegative = /없지\s*않|빼지\s*말|제외하지\s*말|제거하지\s*말|\b(?:not without|do not remove|don't remove)\b/i;
const sparse = /적게|적은|적고|드문|드물|듬성|조금|\b(?:few|sparse|less)\b/i;
const abundant = /많|빽빽|가득|울창|\b(?:many|dense|plenty)\b/i;
const only = /만(?!들)|\bonly\b/i;
const freshCategory = () => ({density:1,maxCount:0,allowedTypes:[]});
const typesForCategory = category => [
  ...(category==="rocks"?["rock"]:category==="bushes"?["bush"]:[]),
  ...Object.keys(categories[category][1])
];

export function tokenizePrompt(prompt, {includeWater=false}={}) {
  const text = String(prompt ?? "").normalize("NFKC").toLowerCase();
  const candidates = [];
  for (const lexeme of includeWater ? [...lexemes,...waterLexemes] : lexemes) {
    const english = /^[a-z]/i.test(lexeme.pattern);
    const pattern = new RegExp(english ? `\\b(?:${lexeme.pattern})\\b` : lexeme.pattern,"giu");
    for (const match of text.matchAll(pattern)) candidates.push({
      category:lexeme.category, ...(lexeme.type ? {type:lexeme.type} : {}),
      text:match[0], start:match.index, end:match.index+match[0].length
    });
  }
  // Longest at a shared position wins: 벚꽃 is a tree, not also the ground-detail 꽃.
  candidates.sort((a,b)=>a.start-b.start || b.end-a.end);
  const tokens = [];
  for (const token of candidates) if (!tokens.length || token.start>=tokens.at(-1).end) tokens.push(token);
  return {text,tokens};
}

export function explicitPropsIntent(prompt) {
  const {text,tokens}=tokenizePrompt(prompt);
  const props=[...text.matchAll(/프롭|모델링|모델\s*에셋|에셋|\b(?:props?|assets?)\b/gi)];
  let result;
  for(const match of props) {
    const start=match.index,end=start+match[0].length;
    const leftBoundary=Math.max(...[...text.slice(0,start).matchAll(/[,;.!?\n]/g)].map(m=>m.index),-1)+1;
    const previous=tokens.filter(t=>t.end<=start&&t.start>=leftBoundary).at(-1);
    const next=tokens.find(t=>t.start>=end);
    const prefix=previous
      ? text.slice(previous.end,start).match(/\b(?:no|without|with|include)\s*$/i)?.[0]??""
      : text.slice(leftBoundary,start);
    const suffix=text.slice(end,next?.start??text.length).split(/[,;.!?\n]/)[0];
    const scope=prefix+" "+suffix;
    if(negative.test(scope)&&!doubleNegative.test(scope))result=false;
    else if(/있|들어|포함|사용|켜|추가|넣|\bwith\b|\binclude\b/i.test(scope))result=true;
  }
  return result;
}

export function analyzePrompt(prompt) {
  const {text,tokens} = tokenizePrompt(prompt,{includeWater:true});
  const constraints = [], warnings = [];
  let waterIntent;
  const add = (path,value,evidence) => constraints.push({path,value,evidence});
  for (const match of text.matchAll(/(?:\bseed|시드)\s*(?:는|은|값)?\s*[:=]?\s*(-?\d+)(?!\d|\.\d)/g))
    add("seed",Number(match[1]),match[0]);
  for (const match of text.matchAll(/(?<![\d.])(\d+)\s*[x×*]\s*(\d+)(?!\d|\.\d)/g)) {
    add("mapWidth",Number(match[1]),match[0]); add("mapHeight",Number(match[2]),match[0]);
  }
  // Explicit algorithm threshold is not an area percentage and must not be silently clamped.
  for (const match of text.matchAll(/(?:waterthreshold|물\s*임계값|수면\s*임계값)\s*[:=]?\s*(\d+(?:\.\d+)?)/g))
    add("generatorSettings.forest.waterThreshold",Number(match[1]),match[0]);

  let start=0;
  const boundaries=[...text.matchAll(separator)].map(m=>({start:m.index,end:m.index+m[0].length}));
  boundaries.push({start:text.length,end:text.length});
  for (const boundary of boundaries) {
    const local=tokens.filter(t=>t.start>=start&&t.end<=boundary.start);
    const groups=[];
    for (const token of local) {
      const previous=groups.at(-1);
      const between=previous?text.slice(previous.end,token.start):"";
      const modified=negative.test(between)||sparse.test(between)||abundant.test(between)||/\d|%/.test(between);
      if(previous?.category===token.category&&!modified) { previous.tokens.push(token); previous.end=token.end; }
      else groups.push({category:token.category,start:token.start,end:token.end,tokens:[token]});
    }
    for (let i=0;i<groups.length;i++) {
      const group=groups[i], next=groups[i+1];
      const prefix=i===0?text.slice(start,group.start)
        :text.slice(groups[i-1].end,group.start).match(/\b(?:no|without|many|few|only)\s*$/i)?.[0]??"";
      const suffix=text.slice(group.end,next?.start??boundary.start)
        .replace(/\b(?:no|without|many|few|only)\s*$/i,"");
      let scope=prefix+" "+text.slice(group.start,group.end)+" "+suffix;
      // "나무와 바위 없이": share the trailing modifier only across a bare noun list.
      if(next&&/^\s*(?:와|과|및|\/)\s*$/.test(suffix)) {
        const tail=text.slice(next.end,groups[i+2]?.start??boundary.start);
        if(negative.test(tail)&&!doubleNegative.test(tail)) scope+=" "+tail;
      }
      const path="visualSettings."+group.category;
      const types=[...new Set(group.tokens.map(t=>t.type).filter(Boolean))];
      const isNegative=negative.test(scope)&&!doubleNegative.test(scope);
      if (group.category === "water") {
        if (isNegative) waterIntent = {value:0,evidence:scope.trim()};
        else if (doubleNegative.test(scope)) waterIntent = {value:.46,evidence:scope.trim()};
        else if (sparse.test(scope)) waterIntent = {value:.30,evidence:scope.trim()};
        else if (abundant.test(scope)) waterIntent = {value:.56,evidence:scope.trim()};
        else waterIntent = {value:.46,evidence:scope.trim()};
        continue;
      }
      if (doubleNegative.test(scope)) {
        warnings.push({code:"AMBIGUOUS_NEGATION",message:"이중 부정은 단순 제외 규칙으로 덮어쓰지 않습니다.",evidence:scope.trim()});
      } else if(isNegative && types.length===1) {
        const remaining=typesForCategory(group.category).filter(t=>t!==types[0]);
        add(path+".allowedTypes",remaining,scope.trim());
        // Empty allowedTypes means unrestricted, so a category with no remaining types must be off.
        add(path+".density",remaining.length?1:0,scope.trim());
      } else if(isNegative && types.length>1) {
        warnings.push({code:"TYPE_EXCLUSION_REQUIRES_REVIEW",message:"특정 종류의 제외는 전체 분류 삭제로 변환하지 않습니다. 해석된 종류 목록을 확인하세요.",evidence:scope.trim()});
      } else if(isNegative) add(path+".density",0,scope.trim());
      else {
        const percent=scope.match(/(?:밀도|density)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(%?)/i);
        if(percent) add(path+".density",Number(percent[1])/(percent[2]?100:1),scope.trim());
        else if(sparse.test(scope)) add(path+".density",.35,scope.trim());
        else if(abundant.test(scope)) add(path+".density",1,scope.trim());
        if(types.length&&only.test(scope)) add(path+".allowedTypes",types,scope.trim());
      }
      const count=scope.match(/(?:최대\s*|max(?:imum)?\s*)?(\d+)\s*(?:개체|개|그루)/i);
      if(count) {
        add(path+".maxCount",Number(count[1]),scope.trim());
        if(Number(count[1])===0) add(path+".density",0,scope.trim());
        warnings.push({code:"COUNT_IS_CAP",message:"개수는 배치 상한입니다. 지형·간격 조건에 따라 실제 개수는 적을 수 있습니다.",evidence:count[0]});
      }
    }
    start=boundary.end;
  }
  const landform=analyzeLandformPrompt(prompt);
  constraints.push(...landform.constraints); warnings.push(...landform.warnings);
  const river=analyzeRiverPrompt(prompt);
  constraints.push(...river.constraints);
  if (/(?:중앙|가운데|가로지|중심|동쪽|서쪽|북쪽|남쪽|\bcentral\b|\bcenter\b|\bcrossing\b)[^.!?\n]{0,25}(?:호수|도로|길|lake|road)|(?:호수|도로|lake|road)[^.!?\n]{0,25}(?:중앙|가운데|가로지|\bcenter\b|\bcross)/i.test(text)
      || (!river.supported && /(?:중앙|가운데|동쪽|서쪽|북쪽|남쪽)[^.!?\n]{0,25}강/i.test(text)))
    warnings.push({code:"UNSUPPORTED_SPATIAL_LAYOUT",message:"중앙을 남북·동서로 관통하는 강은 지원합니다. 그 밖의 지정 위치 강·호수·횡단 도로는 아직 지원하지 않습니다."});
  if(/계곡|고원|분화구|\b(?:valley|plateau|crater)\b/i.test(text))
    warnings.push({code:"UNSUPPORTED_LANDFORM",message:"현재 지형 변경은 산·완만한 언덕 하나를 지원합니다. 계곡·고원·분화구는 지원하지 않습니다."});
  if (/(?:물|호수|수면|water)[^.!?\n]{0,12}\d+\s*%/i.test(text))
    warnings.push({code:"WATER_COVERAGE_NOT_EXACT",message:"물 임계값은 수면 면적 비율과 다릅니다. 요청한 물 면적 비율을 정확히 보장하지 않습니다."});
  return {version:"pcg-intent@1",tokens,constraints,warnings,...(waterIntent?{waterIntent}:{})};
}

export function applyVisualIntent(prompt,request) {
  const intent=analyzePrompt(prompt);
  request.visualSettings ??= {};
  for(const name of Object.keys(categories)) {
    const current=request.visualSettings[name];
    const controlled=intent.constraints.some(c=>c.path==="visualSettings."+name+".density");
    const mentioned=intent.tokens.some(t=>t.category===name);
    if(!current || (!controlled&&!mentioned&&current.density===0))
      request.visualSettings[name]={...freshCategory(),allowedTypes:current?.allowedTypes??[]};
  }
  for(const constraint of intent.constraints.filter(c=>c.path.startsWith("visualSettings."))) {
    const [,category,field]=constraint.path.split(".");
    request.visualSettings[category][field]=constraint.value;
  }
  return request;
}

export function applySwampDefaults(prompt, request) {
  if (request?.worldType !== "Swamp") return request;
  const intent = analyzePrompt(prompt);
  const defaults = defaultRequest("Swamp").generatorSettings.forest;
  // A plain swamp uses the complete wetland preset, independent of model guesses.
  request.generatorSettings.forest = {...defaults};
  const namedProfile = String(prompt).match(/\b(DefaultSwamp|OpenMarsh|DenseBog)\b/i)?.[1];
  request.generationProfile = ["DefaultSwamp","OpenMarsh","DenseBog"].find(p=>p.toLowerCase()===namedProfile?.toLowerCase())??"DefaultSwamp";
  if (intent.waterIntent) request.generatorSettings.forest.waterThreshold = intent.waterIntent.value;
  for (const category of Object.keys(categories))
    for (const [field, value] of Object.entries(freshCategory())) {
      const explicit = intent.constraints.some(c => c.path === `visualSettings.${category}.${field}`);
      const species = field === "allowedTypes" && intent.tokens.some(t => t.category === category && t.type);
      if (!explicit && !species) request.visualSettings[category][field] = value;
    }
  return request;
}

export function applyExplicitNumbers(prompt,request) {
  for(const {path,value} of analyzePrompt(prompt).constraints.filter(c=>["seed","mapWidth","mapHeight","generatorSettings.forest.waterThreshold"].includes(c.path))) {
    if(path.startsWith("generatorSettings.forest.")) {
      if(request.generatorSettings?.forest) request.generatorSettings.forest.waterThreshold=value;
    } else request[path]=value;
  }
  return request;
}
