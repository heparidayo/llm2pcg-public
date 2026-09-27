import test from 'node:test';
import assert from 'node:assert/strict';
import {naturalLanguageNotice} from '../public/natural-language-status.mjs';

test('fallback notices distinguish unavailable interpretation, empty input and repaired values',()=>{
 assert.match(naturalLanguageNotice({aiDelivery:{fallbackUsed:true,fallbackReason:'INTERPRETATION_UNAVAILABLE'}}),/AI API 요청이 실패해 기본 템플릿을 적용/);
 assert.match(naturalLanguageNotice({aiDelivery:{fallbackUsed:true,fallbackReason:'EMPTY_PROMPT'}}),/요청이 비어 있어 기본 템플릿을 적용/);
 assert.match(naturalLanguageNotice({aiDelivery:{fallbackUsed:true,fallbackReason:null}}),/일부 값을 사용할 수 없어 기본 템플릿 값으로 보완/);
});
test('success and errors without actual fallback never claim a template was applied',()=>{
 for(const result of [{ok:true},{ok:false},{aiDelivery:{fallbackUsed:false}},{aiDelivery:{status:'unconfirmed'}}])
  assert.equal(naturalLanguageNotice(result),'');
});
