import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebServer,requestCandidateFromOpenAi} from './server.mjs';
import {requestIntentFromOpenAi} from './spatial-v4-api.mjs';
import {emptyIntent} from './request-resolver.mjs';
import {naturalLanguageNotice} from '../public/natural-language-status.mjs';

async function serverTest(options,work) {
 const server=createWebServer({enableExperimentalV4:Boolean(options.v4Options),...options});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const post=async(path,body)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+path,
  {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 try {await work(post);}finally {await new Promise(r=>server.close(r));}
}
test('HTTP receipt matches the actual AI user message and cached retries call AI once',async()=>{
 let sent,calls=0;
 await serverTest({v4Options:{requestIntent:(prompt,options)=>requestIntentFromOpenAi(prompt,{...options,apiKey:'private-test-key',fetchImplementation:async(_url,options)=>{
  calls++;sent=JSON.parse(options.body).input.find(m=>m.role==='user').content;
  return new Response(JSON.stringify({id:'resp-test',model:'reported-model',status:'completed',output_text:JSON.stringify(emptyIntent())}),{headers:{'x-request-id':'req-test'}});
 }})}},async post=>{
  const input={prompt:'  강가에 벚꽃\n나무만 있는 숲  ',requestId:'delivery-test-00001'};
  const first=await post('/api/v4/resolve',input),again=await post('/api/v4/resolve',input);
  assert.equal(first.status,200);assert.equal(first.body.aiDelivery.prompt,sent);
  assert.equal(first.body.aiDelivery.status,'responded');assert.equal(first.body.aiDelivery.outcome,'completed');
  assert.equal(first.body.aiDelivery.providerRequestId,'req-test');assert.equal(first.body.aiDelivery.model,'reported-model');
  assert.ok(first.body.aiDelivery.respondedAt);assert.ok(first.body.aiDelivery.durationMs>=0);
  assert.equal(again.body.aiDelivery.reused,true);assert.equal(calls,1);
  assert.ok(!JSON.stringify(first.body).includes('private-test-key'));
  const direct=await post('/api/v4/resolve',{intent:emptyIntent()});
  assert.equal(direct.body.aiDelivery.status,'not-requested');assert.equal(calls,1);
 });
});
test('HTTP errors, invalid provider output, missing keys and timeouts retain truthful receipts',async()=>{
 const cases=[
  {apiKey:'test',fetchImplementation:async()=>new Response('{}',{status:401}),status:'responded',outcome:'http-error'},
  {apiKey:'test',fetchImplementation:async()=>new Response('bad-json'),status:'responded',outcome:'invalid-response'},
  {apiKey:'test',fetchImplementation:async()=>{throw Error('timeout');},status:'unconfirmed',outcome:'unknown'},
  {apiKey:'',fetchImplementation:async()=>{throw Error('must not send');},status:'not-sent',outcome:'not-sent'}
 ];
 for(const scenario of cases)await serverTest({v4Options:{requestIntent:(prompt,options)=>requestIntentFromOpenAi(prompt,{...options,...scenario})}},async post=>{
  const result=await post('/api/v4/resolve',{prompt:'숲'});
  assert.equal(result.body.ok,false);assert.equal(result.body.aiDelivery.status,scenario.status);
  assert.equal(result.body.aiDelivery.outcome,scenario.outcome);
  assert.equal(naturalLanguageNotice(result.body),'');
 });
});
test('legacy fallback exposes a failed AI receipt even when generation succeeds',async()=>{
 const prior=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test';
 try {
  await serverTest({requestPcg:(prompt,_fetch,options)=>requestCandidateFromOpenAi(prompt,async()=>new Response('{}',{status:401}),options),
   sendDiagnosticsToUnity:async()=>{},sendRequestToCore:async()=>({world:{formatVersion:1}}),
   sendRequestToUnity:async()=>({status:202,payload:{ok:true}})},async post=>{
    for(const path of ['/api/generate','/api/unity/generate']){
     const {body}=await post(path,{prompt:'사막'});
     assert.equal(body.ok,true);assert.equal(body.aiDelivery.outcome,'http-error');assert.equal(body.aiDelivery.fallbackUsed,true);
     assert.equal(body.aiDelivery.fallbackReason,'INTERPRETATION_UNAVAILABLE');
     assert.match(naturalLanguageNotice(body),/AI API 요청이 실패해 기본 템플릿을 적용/);
    }
   });
 } finally {if(prior===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=prior;}
});
