/* Audio format and multipart transcription transport. No language rewriting here. */
(function(root){
  const MAX_SEGMENT_SECONDS=27;
  const MAX_SEGMENT_BYTES=25*1024*1024;
  function formatDuration(seconds){
    const n=Math.max(0,Math.floor(Number(seconds)||0));
    return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  }
  function pcm16(samples){
    const result=new Uint8Array(samples.length*2),view=new DataView(result.buffer);
    for(let i=0;i<samples.length;i++){
      const value=Math.max(-1,Math.min(1,samples[i]));
      view.setInt16(i*2,value<0?Math.round(value*32768):Math.round(value*32767),true);
    }
    return result;
  }
  function wav(chunks,sampleRate){
    const length=chunks.reduce((n,c)=>n+c.length,0),buffer=new ArrayBuffer(44+length),view=new DataView(buffer),bytes=new Uint8Array(buffer);
    function word(at,value){for(let i=0;i<value.length;i++)view.setUint8(at+i,value.charCodeAt(i));}
    word(0,'RIFF');view.setUint32(4,36+length,true);word(8,'WAVE');word(12,'fmt ');
    view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
    view.setUint16(32,2,true);view.setUint16(34,16,true);
    word(36,'data');view.setUint32(40,length,true);
    let offset=44;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return new Blob([buffer],{type:'audio/wav'});
  }
  function appendTranscript(previous,next){
    const a=String(previous||'').trim(),b=String(next||'').trim();
    if(!a)return b;if(!b)return a;
    // Overlap removal is conservative: only exact repeated characters at a segment boundary.
    let common=0;for(let n=Math.min(40,a.length,b.length);n>=6;n--){if(a.slice(-n)===b.slice(0,n)){common=n;break;}}
    return a+'\n'+b.slice(common).trimStart();
  }
  function appendToNote(existing,transcript){
    const first=String(existing||'').trimEnd(),second=String(transcript||'').trim();
    return first?first+(second?'\n\n'+second:''):second;
  }
  function shouldFlush(seconds,rms){return seconds>=26.5||(seconds>=22&&rms<0.012);}
  async function splitAudioBuffer(buffer,onPart,signal){
    if(!buffer||!buffer.length||!buffer.sampleRate||!buffer.numberOfChannels)throw {code:'invalidAudio'};
    const rate=16000,step=26,channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
    const total=Math.ceil(buffer.duration/step);
    for(let index=0;index<total;index++){
      if(signal&&signal.aborted)throw {code:'cancelled'};
      const offset=index*step,count=Math.min(Math.ceil((buffer.duration-offset)*rate),step*rate),samples=new Float32Array(count);
      for(let i=0;i<count;i++){
        const position=(offset+i/rate)*buffer.sampleRate,left=Math.min(buffer.length-1,Math.floor(position)),right=Math.min(buffer.length-1,left+1),fraction=position-left;
        let sum=0;for(const channel of channels)sum+=channel[left]*(1-fraction)+channel[right]*fraction;
        samples[i]=sum/channels.length;
      }
      await onPart({index,blob:wav([pcm16(samples)],rate),seconds:count/rate,total});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    return total;
  }
  function microphoneError(error,lang){
    const en=lang==='en',name=error&&error.name;
    if(name==='NotAllowedError'||name==='SecurityError')return en?'Microphone access was denied. Allow it in the browser and retry.':'没有麦克风权限，请在浏览器地址栏允许麦克风后重试。';
    if(name==='NotFoundError'||name==='DevicesNotFoundError')return en?'No microphone was found. Check the device.':'找不到麦克风，请检查设备连接。';
    if(name==='NotReadableError'||name==='TrackStartError')return en?'The microphone may be in use by another app. Close it and retry.':'麦克风可能被其他程序占用，请关闭占用程序后重试。';
    if(name==='CaptureSuspended')return en?'The browser paused audio capture. Click Record again or try another browser.':'浏览器暂停了音频采集，请重新点击录音；仍无效时尝试其他浏览器。';
    if(name==='Unsupported')return en?'Recording requires a supported browser on localhost or HTTPS.':'此浏览器不支持录音，或页面不是 localhost/HTTPS。';
    return en?'Recording failed. Check your microphone and browser.':'录音失败，请检查麦克风和浏览器设置。';
  }
  function asrError(error,lang){
    const en=lang==='en',code=error&&error.code,status=error&&error.status;
    if(code==='cancelled')return en?'Transcription cancelled; the recording is still available.':'转写已取消，录音仍可重试。';
    if(code==='timeout')return en?'Transcription timed out. Retry this segment.':'转写超时，请重试该片段。';
    if(code==='empty')return en?'The service returned no text. Retry this segment.':'服务未返回文字，请重试该片段。';
    if(code==='invalidAudio')return en?'The audio segment is empty or damaged.':'音频片段为空或已损坏。';
    if(code==='tooLarge')return en?'This audio segment exceeds the service limit.':'音频片段超过服务限制。';
    if(status===401||status===403)return en?'ASR authentication failed. Check the API key.':'语音识别认证失败，请检查语音识别 API Key。';
    if(status===402)return en?'ASR quota is insufficient. Check your provider balance.':'语音识别额度不足，请检查服务商账户余额。';
    if(status===429){
      const wait=Number.isFinite(error.retryAfterMs)?Math.ceil(error.retryAfterMs/1000):null;
      const code=error.providerCode?` (${en?'provider code':'服务码'} ${error.providerCode})`:'';
      return (en?(wait!=null?`ASR is limited. Wait at least ${wait}s before retrying; check provider quota if it persists.`:'ASR is limited by rate, concurrency or quota. Check the provider console before retrying.'):
        (wait!=null?`语音识别请求受限，服务商建议至少等待 ${wait} 秒后重试；持续出现请检查额度。`:'语音识别请求受限，可能是频率、并发或额度限制，请检查服务商控制台。'))+code;
    }
    if(status===413)return en?'The audio is too large for the ASR service.':'音频超过语音识别服务的大小限制。';
    if(status===404||status===400||status===422)return en?'ASR rejected the audio or model. Check the ASR configuration.':'语音识别服务未接受音频或模型，请检查语音识别配置与接口兼容性。';
    if(status>=500)return en?'ASR service is temporarily unavailable. Retry later.':'语音识别服务暂时不可用，请稍后重试。';
    return en?'Transcription failed. Check your network and ASR settings, then retry.':'录音转写失败，请检查网络和语音识别设置后重试。';
  }
  async function transcribe(blob,config,signal,fetcher){
    if(!blob||blob.size<=44)throw {code:'invalidAudio'};
    if(blob.size>MAX_SEGMENT_BYTES)throw {code:'tooLarge'};
    if(!config||!config.key||!config.base||!config.model)throw {code:'config'};
    const form=new FormData();form.append('model',config.model);
    form.append('file',blob,'voice.wav');
    let response;
    try{
      const combined=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(90000)]);
      response=await (fetcher||fetch)(config.base.replace(/\/+$/,'')+'/audio/transcriptions',{
        method:'POST',headers:{Authorization:'Bearer '+config.key},body:form,signal:combined
      });
    }catch(error){throw {code:signal&&signal.aborted?'cancelled':error.name==='TimeoutError'?'timeout':'network'};}
    if(!response.ok){
      let retryAfterMs=null;
      if(response.status===429&&response.headers&&typeof response.headers.get==='function'){
        const raw=response.headers.get('Retry-After');
        if(raw!=null&&String(raw).trim()){
          const seconds=Number(raw),date=Date.parse(raw);
          retryAfterMs=Number.isFinite(seconds)&&seconds>=0?Math.ceil(seconds*1000):Number.isFinite(date)?Math.max(0,date-Date.now()):null;
        }
      }
      let providerCode=null;
      if(response.status===429){
        try{
          const body=await response.json(),value=body&&body.error&&body.error.code;
          if(value!=null&&/^[A-Za-z0-9_-]{1,32}$/.test(String(value)))providerCode=String(value);
        }catch(_){/* Never show an untrusted raw provider message or credentials. */}
      }
      throw {status:response.status,retryAfterMs,providerCode};
    }
    let data;try{data=await response.json();}catch(_){throw {code:'response'};}
    const value=typeof data.text==='string'?data.text:data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content;
    if(typeof value!=='string'||!value.trim())throw {code:'empty'};
    return value.trim();
  }
  async function transcribeParts(parts,results,config,signal,onProgress,recognize){
    results.length=parts.length;
    const errors=[];
    for(let i=0;i<parts.length;i++){
      if(signal&&signal.aborted)break;
      if(results[i])continue;
      if(onProgress)onProgress(i,parts.length,'start');
      try{
        for(let attempt=0;;attempt++){
          try{results[i]=await (recognize||transcribe)(parts[i].blob,config,signal);break;}
          catch(error){
            // Only auto-retry when the provider supplied a reasonable wait.
            // A quota-related 429 without Retry-After must not create a retry storm.
            if(error.status!==429||attempt>=2||!Number.isFinite(error.retryAfterMs)||error.retryAfterMs>30000||signal&&signal.aborted)throw error;
            if(onProgress)onProgress(i,parts.length,'retry',error.retryAfterMs);
            await new Promise((resolve,reject)=>{
              const timeout=setTimeout(()=>{if(signal)signal.removeEventListener('abort',cancel);resolve();},error.retryAfterMs);
              function cancel(){clearTimeout(timeout);reject({code:'cancelled'});}
              if(signal){if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});}
            });
          }
        }
        if(onProgress)onProgress(i,parts.length,'success');
      }catch(error){
        if(signal&&signal.aborted)break;
        errors.push({index:i,error});
        if(onProgress)onProgress(i,parts.length,'failed');
        if([401,402,403,404,429].includes(error.status)||error.code==='network'||error.code==='timeout')break;
      }
    }
    return {results,errors,cancelled:!!(signal&&signal.aborted),complete:results.length>0&&results.filter(Boolean).length===results.length};
  }
  root.VoiceCore={formatDuration,pcm16,wav,splitAudioBuffer,appendTranscript,appendToNote,shouldFlush,microphoneError,asrError,transcribe,transcribeParts,MAX_SEGMENT_SECONDS};
  if(typeof module!=='undefined')module.exports=root.VoiceCore;
})(typeof globalThis!=='undefined'?globalThis:this);
