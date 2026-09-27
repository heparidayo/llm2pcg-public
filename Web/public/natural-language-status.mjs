export function naturalLanguageNotice(result) {
  const fallback=result?.aiDelivery;
  if(!fallback?.fallbackUsed)return '';
  if(fallback.fallbackReason==='EMPTY_PROMPT')
    return '자연어 요청이 비어 있어 기본 템플릿을 적용했습니다.';
  if(fallback.fallbackReason==='INTERPRETATION_UNAVAILABLE')
    return '자연어 해석 또는 AI API 요청이 실패해 기본 템플릿을 적용했습니다.';
  return '자연어 해석 결과의 일부 값을 사용할 수 없어 기본 템플릿 값으로 보완했습니다.';
}
