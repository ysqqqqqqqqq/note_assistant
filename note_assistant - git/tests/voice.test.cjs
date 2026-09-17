const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const VoiceCore=require('../assets/voice-core.js');

test('WAV encoder writes mono PCM header and preserves all samples',async()=>{
  const samples=new Float32Array([0,0.5,-0.5,1,-1]);
  const blob=VoiceCore.wav([VoiceCore.pcm16(samples.slice(0,2)),VoiceCore.pcm16(samples.slice(2))],16000);
  const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'RIFF');
  assert.equal(new TextDecoder().decode(bytes.slice(8,12)),'WAVE');
  assert.equal(view.getUint32(24,true),16000);
  assert.equal(view.getUint32(40,true),samples.length*2);
  assert.equal(view.getInt16(44,true),0);
  assert.equal(view.getInt16(46,true),16384);
  assert.equal(view.getInt16(52,true),-32768);
});
test('long recording is divided before GLM 30-second limit without dropping PCM',()=>{
  assert.equal(VoiceCore.shouldFlush(21.9,0),false);
  assert.equal(VoiceCore.shouldFlush(22,0.005),true);
  assert.equal(VoiceCore.shouldFlush(22,0.2),false);
  assert.equal(VoiceCore.shouldFlush(26.5,0.2),true);
  assert.ok(VoiceCore.MAX_SEGMENT_SECONDS<30);
});
test('audio worklet flushes every captured sample, including the final short block',()=>{
  let Processor;
  class Base {constructor(){this.port={postMessage:(message)=>posted.push(message)};}}
  const posted=[];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/voice-capture-worklet.js'),'utf8'),{
    AudioWorkletProcessor:Base,Float32Array,registerProcessor:(_,value)=>{Processor=value;}
  });
  const processor=new Processor(),samples=Float32Array.from({length:5000},(_,i)=>i/5000);
  for(let i=0;i<samples.length;i+=128){
    const output=new Float32Array(128).fill(1);
    processor.process([[samples.slice(i,i+128)]],[[output]]);
    assert.ok(output.every(value=>value===0));
  }
  processor.port.onmessage({data:{type:'flush'}});
  const actual=posted.filter(item=>item.type==='samples').flatMap(item=>Array.from(item.samples));
  assert.equal(actual.length,samples.length);
  assert.equal(actual[4999],samples[4999]);
  assert.equal(posted.at(-1).type,'flushed');
});
test('mixed Chinese-English ASR text is returned unchanged using independent ASR config',async()=>{
  let request;
  const blob=VoiceCore.wav([VoiceCore.pcm16(new Float32Array(100))],16000);
  const mixed='我准备给 Note Assistant 增加 hybrid retrieval 和 rerank，然后用 embedding 做召回。';
  const result=await VoiceCore.transcribe(blob,{base:'https://open.bigmodel.cn/api/paas/v4',key:'fixture-key',model:'glm-asr-2512'},null,
    async(url,options)=>{request={url,options};return {ok:true,json:async()=>({text:mixed})};});
  assert.equal(result,mixed);
  assert.match(request.url,/\/audio\/transcriptions$/);
  assert.equal(request.options.headers.Authorization,'Bearer fixture-key');
  assert.equal(request.options.body.get('model'),'glm-asr-2512');
  assert.equal(request.options.body.get('file').type,'audio/wav');
  assert.equal(request.options.body.has('prompt'),false);
});
test('empty ASR result, API failure and cancellation remain retryable errors',async()=>{
  const blob=VoiceCore.wav([VoiceCore.pcm16(new Float32Array(100))],16000),config={base:'https://example.com/v1',key:'fixture',model:'asr-test'};
  await assert.rejects(VoiceCore.transcribe(blob,config,null,async()=>({ok:true,json:async()=>({text:'  '})})),error=>error.code==='empty');
  await assert.rejects(VoiceCore.transcribe(blob,config,null,async()=>({ok:false,status:429})),error=>error.status===429);
  const controller=new AbortController();controller.abort();
  await assert.rejects(VoiceCore.transcribe(blob,config,controller.signal,async(_,options)=>{
    assert.equal(options.signal.aborted,true);throw new DOMException('Aborted','AbortError');
  }),error=>error.code==='cancelled');
  assert.match(VoiceCore.asrError({status:429},'zh'),/频率、并发或额度/);
  assert.match(VoiceCore.asrError({status:429,retryAfterMs:5000},'zh'),/等待 5 秒/);
  assert.match(VoiceCore.asrError({status:429,providerCode:'1302'},'zh'),/服务码 1302/);
});
test('429 honors Retry-After for a bounded retry, but does not retry quota-like 429 without it',async()=>{
  const blob=VoiceCore.wav([VoiceCore.pcm16(new Float32Array(100))],16000),config={base:'https://example.com/v1',key:'fixture',model:'asr'};
  await assert.rejects(VoiceCore.transcribe(blob,config,null,async()=>({ok:false,status:429,headers:{get:()=> '12'}})),error=>error.status===429&&error.retryAfterMs===12000);
  await assert.rejects(VoiceCore.transcribe(blob,config,null,async()=>({ok:false,status:429,json:async()=>({error:{code:'1302',message:'do not display'}})})),error=>error.providerCode==='1302'&&!JSON.stringify(error).includes('do not display'));
  let count=0;const stages=[];
  const outcome=await VoiceCore.transcribeParts([{blob}],[],config,new AbortController().signal,(_,__,stage)=>stages.push(stage),async()=>{
    if(++count===1)throw {status:429,retryAfterMs:0};return '成功';
  });
  assert.equal(count,2);assert.equal(outcome.complete,true);assert.deepEqual(stages,['start','retry','success']);
  count=0;await VoiceCore.transcribeParts([{blob}],[],config,new AbortController().signal,null,async()=>{count++;throw {status:429};});
  assert.equal(count,1);
});
test('uploaded decoded audio is downmixed, split in order and uses the same WAV path',async()=>{
  const length=16000*55,channel=new Float32Array(length);channel[0]=.5;channel[length-1]=-.5;
  const parts=[];
  const count=await VoiceCore.splitAudioBuffer({length,sampleRate:16000,numberOfChannels:1,duration:55,getChannelData:()=>channel},part=>parts.push(part));
  assert.equal(count,3);assert.deepEqual(parts.map(p=>Math.round(p.seconds)),[26,26,3]);
  assert.ok(parts.every(p=>p.blob.type==='audio/wav'&&p.blob.size<25*1024*1024));
  const results=[];const outcome=await VoiceCore.transcribeParts(parts,results,{},new AbortController().signal,null,async(_,__,___)=>'中英混合 hybrid retrieval');
  assert.equal(outcome.complete,true);assert.equal(results.length,3);
});
test('upload conversion can be cancelled between parts without silently losing completed parts',async()=>{
  const rate=48000,channel=new Float32Array(rate*54),controller=new AbortController(),parts=[];
  await assert.rejects(VoiceCore.splitAudioBuffer({length:channel.length,sampleRate:rate,numberOfChannels:1,duration:54,getChannelData:()=>channel},part=>{
    parts.push(part);controller.abort();
  },controller.signal),error=>error.code==='cancelled');
  assert.equal(parts.length,1);
});
test('long-recording ASR keeps good segments, retries failed segment in order',async()=>{
  const parts=[{blob:1},{blob:2},{blob:3}],results=[];
  let calls=[];
  let outcome=await VoiceCore.transcribeParts(parts,results,{},new AbortController().signal,null,async blob=>{
    calls.push(blob);if(blob===2)throw {status:429};return blob===1?'开头 Note Assistant':'结尾 rerank';
  });
  assert.equal(outcome.complete,false);
  assert.deepEqual(calls,[1,2]);
  assert.equal(results[0],'开头 Note Assistant');
  assert.equal(results[2],undefined);
  calls=[];
  outcome=await VoiceCore.transcribeParts(parts,results,{},new AbortController().signal,null,async blob=>{
    calls.push(blob);return blob===2?'中间 hybrid retrieval':'结尾 rerank';
  });
  assert.deepEqual(calls,[2,3]);
  assert.equal(outcome.complete,true);
  assert.match(results.join(' '),/Note Assistant.*hybrid retrieval.*rerank/);
});
test('cancelled ASR preserves completed segments for later retry',async()=>{
  const controller=new AbortController(),results=[];
  const outcome=await VoiceCore.transcribeParts([{blob:1},{blob:2}],results,{},controller.signal,null,async blob=>{
    if(blob===1){controller.abort();return '已完成的片段';}return '不应调用';
  });
  assert.equal(outcome.cancelled,true);
  assert.equal(outcome.complete,false);
  assert.equal(results[0],'已完成的片段');
  assert.equal(results[1],undefined);
});
test('boundary text merge avoids exact repeated overlap but keeps technical English',()=>{
  assert.equal(VoiceCore.appendTranscript('我们要用 hybrid retrieval','hybrid retrieval 和 rerank'),'我们要用 hybrid retrieval\n和 rerank');
  assert.equal(VoiceCore.appendTranscript('下一版 Note Assistant','增加 embedding'),'下一版 Note Assistant\n增加 embedding');
  assert.equal(VoiceCore.appendToNote('已有笔记','Note Assistant 增加 rerank'),'已有笔记\n\nNote Assistant 增加 rerank');
  assert.equal(VoiceCore.appendToNote('','中英混合 transcription'),'中英混合 transcription');
});
test('permission, missing device and occupied mic have plain-language errors',()=>{
  for(const [name,pattern] of [['NotAllowedError',/权限/],['NotFoundError',/找不到麦克风/],['NotReadableError',/占用/]])
    assert.match(VoiceCore.microphoneError({name},'zh'),pattern);
  assert.match(VoiceCore.microphoneError({name:'CaptureSuspended'},'zh'),/浏览器暂停/);
});
test('voice integration keeps existing denoise, annotation, and note persistence paths',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const voice=fs.readFileSync(path.join(__dirname,'../assets/voice-note.js'),'utf8');
  const app=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
  assert.match(html,/id="voice-raw"/);assert.match(html,/id="note-input"/);
  assert.match(html,/class="settings-btn voice-header-button" id="voice-open"/);
  assert.match(html,/id="voice-upload"/);
  assert.match(html,/id="voice-audio-preview"[^>]*controls/);
  assert.match(html,/id="voice-mic-select"/);
  assert.match(html,/id="voice-input-level"/);
  assert.match(html,/id="asr-config"/);
  assert.doesNotMatch(voice,/loadSettings\(\)|glm-asr-2512|voice-asr-key/);
  assert.match(voice,/function playRecording\(\)[\s\S]*?audio\.play\(\)/);
  assert.match(voice,/deviceId=\{exact:chosen\}/);
  assert.match(voice,/MIC_KEY='note_voice_microphone'/);
  assert.match(voice,/localStorage\.setItem\(MIC_KEY,event\.target\.value\)/);
  assert.match(voice,/source\.connect\(node\);node\.connect\(context\.destination\)/);
  const asr=fs.readFileSync(path.join(__dirname,'../assets/asr-settings-ui.js'),'utf8');
  assert.match(asr,/ApiSession\.create\(localStorage,'note_asr_settings'\)/);
  assert.match(asr,/createStore\([^\n]+,'asr'\)/);
  assert.match(voice,/editor\.value=/);assert.doesNotMatch(voice,/_db\.run|ragRetrieveDetailed|callLLM\(/);
  assert.match(app,/async function textDenoise\(/);assert.match(app,/async function regenerateAnnotations\(/);
  assert.match(app,/async function saveNote\(/);
});
