// Receipts describe observed provider responses, never an assumed network delivery.
export async function trackAiDelivery(prompt,{model,onDelivery},work) {
  const started=Date.now();
  const receipt={provider:'OpenAI',model,prompt,status:'not-sent',outcome:'pending',startedAt:new Date(started).toISOString()};
  const publish=()=>onDelivery?.(structuredClone(receipt));
  const tracker={
    async fetch(fetchImplementation,url,options) {
      receipt.status='unconfirmed';publish();
      const response=await fetchImplementation(url,options);
      receipt.status='responded';receipt.httpStatus=response.status;
      receipt.respondedAt=new Date().toISOString();
      receipt.providerRequestId=response.headers?.get('x-request-id')??null;
      if(!response.ok)receipt.outcome='http-error';
      publish();return response;
    },
    received(payload) {
      if(typeof payload.id==='string')receipt.responseId=payload.id;
      if(typeof payload.model==='string')receipt.model=payload.model;
    }
  };
  try {
    const result=await work(tracker);receipt.outcome='completed';return result;
  } catch(error) {
    if(receipt.outcome==='pending')receipt.outcome=receipt.status==='responded'
      ?error.code==='OPENAI_REFUSAL'?'refused':error.code==='OPENAI_INCOMPLETE_RESPONSE'?'incomplete':'invalid-response'
      :receipt.status==='not-sent'?'not-sent':'unknown';
    receipt.errorCode=error.code??'AI_REQUEST_FAILED';
    receipt.durationMs=Date.now()-started;
    error.aiDelivery=structuredClone(receipt);throw error;
  } finally {
    receipt.durationMs=Date.now()-started;publish();
  }
}
