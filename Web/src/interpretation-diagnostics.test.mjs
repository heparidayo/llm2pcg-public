import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {defaultRequest} from '../../Shared/pcg-request.mjs';
import {createWebServer,resolveNaturalDraft,sendUnityDiagnostics} from './server.mjs';
import {formatInterpretationDiagnostic} from './interpretation-diagnostics.mjs';
import {naturalLanguageNotice} from '../public/natural-language-status.mjs';

test('diagnostics use bounded English text without raw prompts or provider errors',()=>{
  const {request,interpretation}=resolveNaturalDraft('비밀 한국어 요청',null,{reason:'INTERPRETATION_UNAVAILABLE'});
  const message=formatInterpretationDiagnostic(request,interpretation);
  assert.match(message,/Interpretation was incomplete/);
  assert.match(message,/INTERPRETATION_UNAVAILABLE/);
  assert.ok(/^[\x20-\x7e]+$/.test(message));
  assert.ok(message.length<=2048);
  assert.equal(formatInterpretationDiagnostic(request,{warnings:[]}), '');
});

test('both natural routes send diagnostics separately and still generate when logging fails',async()=>{
  const messages=[];
  const server=createWebServer({requestPcg:async()=>{throw new Error('provider secret');},
    sendDiagnosticsToUnity:async message=>{messages.push(message);throw new Error('Unity offline');},
    sendRequestToCore:async()=>({world:{formatVersion:1}}),
    sendRequestToUnity:async()=>({status:202,payload:{ok:true}})});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {
    for(const route of ['generate','unity/generate']) {
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'숲'})});
      assert.ok(response.ok);
      const result=await response.json();assert.ok(result.ok);assert.equal(result.request.worldType,'Forest');assert.equal(result.interpretation,undefined);
    }
    assert.equal(messages.length,2);
    assert.ok(messages.every(m=>m.includes('INTERPRETATION_UNAVAILABLE')&&!m.includes('provider secret')));
  } finally {await new Promise(r=>server.close(r));}
});

test('diagnostic delivery uses a separate endpoint and ignores offline Unity',async()=>{
  let calls=0;
  await sendUnityDiagnostics('English diagnostic',async(url,options)=>{
    calls++;assert.equal(url.pathname,'/pcg/diagnostics');
    assert.equal(options.headers['X-PCG-Diagnostics'],'English diagnostic');
    assert.ok(options.signal);throw new Error('offline');
  });
  await sendUnityDiagnostics('',async()=>{calls++;});
  assert.equal(calls,1);
});

test('Unity web form reports template fallback in the existing status text without a new panel',async()=>{
  const nodes=new Map();
  const document={querySelector:selector=>{
    if(!nodes.has(selector))nodes.set(selector,{value:'숲',textContent:'',handlers:{},classList:{remove(){},toggle(){}},addEventListener(event,handler){this.handlers[event]=handler;}});
    return nodes.get(selector);
  }};
  let response={ok:true,request:defaultRequest('Forest'),interpretation:{warnings:[{message:'해석 실패'}],fallback:{used:true}},unityStatus:202,unity:{ok:true}};
  const source=(await readFile(new URL('../public/unity/app.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  vm.runInNewContext(source,{document,naturalLanguageNotice,fetch:async()=>({json:async()=>response})});
  await nodes.get('#generator-form').handlers.submit({preventDefault(){}});
  const shown=JSON.parse(nodes.get('#result').textContent);
  assert.ok(shown.ok);assert.ok(shown.request);assert.equal(shown.interpretation,undefined);
  assert.equal(nodes.get('#natural-status').textContent,'Unity에 맵 생성 요청을 보냈습니다.');
  assert.equal(nodes.has('#ai-delivery'),false);
  response={...response,aiDelivery:{fallbackUsed:true,fallbackReason:'INTERPRETATION_UNAVAILABLE'}};
  await nodes.get('#generator-form').handlers.submit({preventDefault(){}});
  assert.match(nodes.get('#natural-status').textContent,/자연어 해석 또는 AI API 요청이 실패해 기본 템플릿을 적용했습니다/);
  assert.equal(JSON.parse(nodes.get('#result').textContent).aiDelivery,undefined);
  response={...response,ok:false,message:'Unity 연결 실패'};
  await nodes.get('#generator-form').handlers.submit({preventDefault(){}});
  assert.match(nodes.get('#natural-status').textContent,/기본 템플릿을 적용했습니다.*Unity 연결 실패/);
  assert.doesNotMatch(nodes.get('#natural-status').textContent,/생성 요청을 보냈/);
  nodes.get('#prompt').handlers.input();
  assert.equal(nodes.get('#natural-status').textContent,'');
});
