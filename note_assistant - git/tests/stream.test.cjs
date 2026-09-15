const test=require('node:test');
const assert=require('node:assert/strict');
const {readCompletionStream}=require('../assets/stream.js');
function response(text){const bytes=new TextEncoder().encode(text);let i=0;return new Response(new ReadableStream({pull(c){if(i===bytes.length)c.close();else c.enqueue(bytes.slice(i,i+=1));}}),{headers:{'content-type':'text/event-stream'}});}
test('SSE survives byte-split Chinese, CRLF, comments, usage and DONE',async()=>{
 const pieces=[];
 const r=await readCompletionStream(response(': hello\r\n\r\ndata: {"choices":[{"delta":{"content":"缓存"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"十分钟 [S1]"},"finish_reason":"stop"}]}\r\n\r\ndata: {"choices":[],"usage":{}}\r\n\r\ndata: [DONE]\r\n\r\n'),d=>pieces.push(d));
 assert.equal(r,'缓存十分钟 [S1]');assert.deepEqual(pieces,['缓存','十分钟 [S1]']);
});
test('premature EOF retains partial text and fails',async()=>{let partial='';await assert.rejects(readCompletionStream(response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),d=>partial+=d),/interrupted/);assert.equal(partial,'partial');});
test('provider errors and token truncation are not success',async()=>{
 await assert.rejects(readCompletionStream(response('data: {"error":{"message":"private"}}\n\n'),()=>{}),/provider error/);
 await assert.rejects(readCompletionStream(response('data: {"choices":[{"delta":{"content":"x"},"finish_reason":"length"}]}\n\n'),()=>{}),/limit/);
});
test('JSON-only compatible providers work without repeat request',async()=>{let got='';const r=await readCompletionStream(new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}),{headers:{'content-type':'application/json'}}),d=>got+=d);assert.equal(r,'ok');assert.equal(got,'ok');});
