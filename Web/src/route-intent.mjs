// Natural-language guards only. Direct Intent and saved request JSON keep their values.
export const routeDefaults = Object.freeze({
  mode: "None", orientation: "EastWest", widthCells: 3, crossingPolicy: "BridgeIfNeeded"
});

const subjects = /도로|찻길|길(?!이)|다리|교량|강|하천|호수|산|\b(?:roads?|paths?|bridges?|rivers?|lakes?|mountains?)\b/gu;
const isRoute = /^(?:도로|찻길|길|다리|교량|roads?|paths?|bridges?)$/u;
const number = "[+-]?\\d+(?:,\\d+)*(?:\\.\\d+)?(?:e[+-]?\\d+)?(?:/\\d+)?";
const unit = "(?:칸|셀|타일|cells?|tiles?)";
const widths = [
  new RegExp(`(?:폭|너비|\\bwidth\\b)(?:은|는|이|가)?\\s*(?:of\\s+|is\\s+)?[:=]?\\s*(${number})(?:\\s*[- ]?${unit})?`, "gu"),
  new RegExp(`(${number})\\s*[- ]?${unit}\\s*[- ]?(?:wide\\b|폭|너비)`, "gu"),
  new RegExp(`(${number})\\s*[- ]?${unit}\\s*(?:짜리\\s*)?(?=도로|찻길|길(?!이)|\\b(?:roads?|paths?)\\b)`, "gu")
];
const directions = /남북|북남|북쪽?에서\s*남쪽?(?:으로)?|남쪽?에서\s*북쪽?(?:으로)?|동서|서동|동쪽?에서\s*서쪽?(?:으로)?|서쪽?에서\s*동쪽?(?:으로)?|\b(?:north[\s-]*(?:to[\s-]*)?south|south[\s-]*(?:to[\s-]*)?north|east[\s-]*(?:to[\s-]*)?west|west[\s-]*(?:to[\s-]*)?east|vertical|horizontal)\b|가로(?!지)|세로/gu;

function fail(code, message) {
  throw Object.assign(new Error(message), {code, status: 422});
}

// Bind modifiers to the nearest named feature within a clause, not to a river's
// direction/width elsewhere in the same prompt. A subjectless follow-up clause
// can qualify the preceding feature ("a road. Width 5 cells.").
function routeModifiers(text, patterns) {
  const found = [];
  let precedingSubject;
  for (const clause of text.split(/,(?!\d)|[;!?\n。]|\.(?!\d)|\b(?:and|but)\b|그리고|하지만/gu)) {
    const names = [...clause.matchAll(subjects)];
    for (const pattern of patterns) for (const match of clause.matchAll(pattern)) {
      const start = match.index, end = start + match[0].length;
      const ranked = names.map(name => ({name: name[0], distance:
        Math.max(0, name.index - end, start - name.index - name[0].length)}))
        .sort((a, b) => a.distance - b.distance);
      if (ranked.length > 1 && ranked[0].distance === ranked[1].distance
          && isRoute.test(ranked[0].name) !== isRoute.test(ranked[1].name)) {
        fail("AMBIGUOUS_ROUTE_INTENT", "도로와 다른 지형의 폭·방향을 각각 명시해 주세요.");
      }
      const subject = ranked[0]?.name ?? precedingSubject;
      if (subject && isRoute.test(subject)) found.push(match);
    }
    if (names.length) precedingSubject = names.at(-1)[0];
  }
  return found;
}

function singleValue(values, label) {
  const unique = [...new Set(values)];
  if (unique.length > 1) fail("CONFLICTING_INTENT", `도로 ${label} 지시가 서로 충돌합니다.`);
  return unique[0];
}

export function protectRouteIntent(prompt, route) {
  if (!route) return null;
  if (route.mode === "None") return {...routeDefaults};
  const text = prompt.normalize("NFKC").toLowerCase();
  const explicitWidths = routeModifiers(text, widths);
  const widthCells = singleValue(explicitWidths.map(match => Number(match[1])), "폭");
  if (widthCells !== undefined && (!Number.isInteger(widthCells) || widthCells < 1 || widthCells > 16)) {
    fail("INVALID_ROUTE_WIDTH", "도로 폭은 1~16 사이의 정수 칸 수여야 합니다.");
  }
  // A metric length or qualitative width cannot safely be converted into cells.
  // Reject it visibly instead of replacing a stated constraint with a default.
  const unsupportedWidths = routeModifiers(text, [
    /(?:폭|너비|\bwidth\b)(?:은|는|이|가)?\s*(?:of\s+|is\s+)?[:=]?\s*[+-]?\d+(?:\.\d+)?\s*(?:m\b|meters?\b|metres?\b|미터)/gu,
    /[+-]?\d+(?:\.\d+)?\s*[- ]?(?:m|meters?|metres?|미터)\s*[- ]?(?:wide\b|폭|너비)/gu,
    /폭|너비|넓은|넓게|좁은|좁게|\b(?:width|wide|narrow)\b/gu
  ]);
  if (unsupportedWidths.some(match => !explicitWidths.some(width =>
    width.input === match.input && width.index <= match.index && width.index + width[0].length >= match.index + match[0].length))) {
    fail("UNSUPPORTED_ROUTE_WIDTH", "도로 폭은 미터나 상대 크기 대신 정수 칸 수로 명시해 주세요.");
  }
  const orientation = singleValue(routeModifiers(text, [directions]).map(match =>
    /남|북|north|south|세로|vertical/u.test(match[0]) ? "NorthSouth" : "EastWest"), "방향");
  const crossingText = text.replace(/\bnot\s+without\s+bridges?\b/gu, "");
  const noCrossing = /\b(?:no|without)\s+(?:bridges?|(?:water|river)\s+crossings?)\b|\b(?:do\s+not|don't|without)\s+cross(?:ing)?\s+(?:the\s+)?(?:water|river)\b|\b(?:do\s+not|don't)\s+(?:add|build|use)\s+bridges?\b|\bbridges?\s+(?:are\s+)?(?:forbidden|prohibited)\b|(?:다리|교량)(?:은|는|을|를)?\s*(?:없이|없게|없음|금지|(?:만들|놓|추가하|사용하)지\s*(?:말|않))|(?:물|강|하천)(?:은|는|을|를)?\s*건너지\s*(?:않|말)/u.test(crossingText);
  if (noCrossing && /\b(?:with|build|add|use)\s+bridges?\b|(?:다리|교량)(?:을|를)?\s*(?:만들어|추가해|놓아)/u.test(
    crossingText.replace(/\b(?:do\s+not|don't)\s+(?:add|build|use)\s+bridges?\b/gu, ""))) {
    fail("CONFLICTING_INTENT", "교량 사용과 금지 지시가 서로 충돌합니다.");
  }
  return {...route, orientation: orientation ?? routeDefaults.orientation,
    widthCells: widthCells ?? routeDefaults.widthCells,
    crossingPolicy: noCrossing ? "NoCrossing" : routeDefaults.crossingPolicy};
}
