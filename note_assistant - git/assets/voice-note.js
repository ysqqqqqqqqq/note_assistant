/* Voice is an input path into the existing note editor, not a separate note type. */
(function(){
  const DB='note_voice_temporary',STORE='parts',MIC_KEY='note_voice_microphone',MAX_RECORD_SECONDS=2*60*60;
  const L={
    zh:{idle:'未录音',starting:'正在请求麦克风…',uploading:'正在读取音频…',recording:'正在录音',paused:'已暂停',ready:'音频已就绪',transcribing:'正在转写',complete:'转写完成',failed:'转写失败',start:'🎙 开始录音',pause:'暂停',resume:'继续',finish:'完成',cancel:'取消',play:'▶ 试听',stopPlay:'停止试听',transcribe:'转为文字',retry:'重新转写',stopTranscribe:'取消转写',delete:'删除音频',raw:'原始转写（可编辑）',insert:'追加到笔记正文',empty:'音频内容为空，请重新选择或录制。',saved:'已追加到笔记正文；可继续使用文本降噪、生成批注和保存笔记。',noConfig:'尚未配置语音识别 API，请先前往设置完成配置。',permission:'没有麦克风权限，请在浏览器地址栏允许麦克风后重试。',device:'找不到麦克风，请检查设备连接。',busy:'麦克风可能被其他程序占用，请关闭占用程序后重试。',unsupported:'此浏览器不支持录音，或页面不是 localhost/HTTPS。',recordError:'录音失败，请检查麦克风和浏览器设置。',playError:'试听失败，请尝试播放器上的播放按钮并检查系统音量。',silent:'这段录音几乎没有声音，请检查麦克风输入设备、系统音量或重新录制。',storage:'临时音频保存失败，可能是浏览器空间不足；请结束录音并检查站点存储。',limit:'录音已达到 2 小时上限，已自动结束。',badPart:'第 {n} 段失败：{error}',partial:'已保留成功片段；可重新转写失败片段。',cancelled:'转写已取消，音频仍在，可继续转写。',recordConfirm:'已有一段音频。新的录音或上传会删除旧音频，继续吗？',appendConfirm:'当前笔记已有内容。将转写文字追加到末尾，继续吗？',badFormat:'不支持此格式。请选择 mp3、wav、m4a、mp4、webm 或 ogg 文件。',badFile:'无法读取或解码该音频，请检查文件是否损坏或尝试转换格式。',tooLarge:'文件超过 80 MB，或音频超过 90 分钟；请先压缩或拆分后上传。'},
    en:{idle:'Not recording',starting:'Requesting microphone…',uploading:'Reading audio…',recording:'Recording',paused:'Paused',ready:'Audio ready',transcribing:'Transcribing',complete:'Transcription complete',failed:'Transcription failed',start:'🎙 Start recording',pause:'Pause',resume:'Resume',finish:'Finish',cancel:'Cancel',play:'▶ Listen',stopPlay:'Stop playback',transcribe:'Transcribe',retry:'Retry transcription',stopTranscribe:'Cancel transcription',delete:'Delete audio',raw:'Original transcript (editable)',insert:'Append to note',empty:'The audio is empty.',saved:'Appended to the note. Use Clean text, Generate annotations and Save note.',noConfig:'Speech recognition API is not configured. Open Settings to finish setup.',permission:'Microphone access was denied. Allow it in the browser and retry.',device:'No microphone was found. Check the device.',busy:'The microphone may be in use by another app.',unsupported:'Recording requires a supported browser on localhost or HTTPS.',recordError:'Recording failed. Check your microphone and browser.',playError:'Playback failed. Try the audio controls and check system volume.',silent:'This recording is nearly silent. Check the microphone input device or record again.',storage:'Temporary audio could not be saved. Check browser storage.',limit:'The two-hour recording limit was reached.',badPart:'Segment {n} failed: {error}',partial:'Successful segments were kept. Retry failed segments.',cancelled:'Transcription cancelled. The audio is still available.',recordConfirm:'New audio will delete the previous audio. Continue?',appendConfirm:'Append the transcript to the current note?',badFormat:'Unsupported format. Select mp3, wav, m4a, mp4, webm or ogg.',badFile:'Cannot decode the audio. Check the file or convert it.',tooLarge:'File exceeds 80 MB or 90 minutes. Compress or split it first.'}
  };
  const text=key=>(L[typeof _lang!=='undefined'&&_lang==='en'?'en':'zh'][key]||key);
  function openDB(){return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'key'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });}
  async function transaction(mode,operation){
    const db=await openDB();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);
      let value;try{value=operation(store);}catch(error){tx.abort();db.close();reject(error);return;}
      tx.oncomplete=()=>{db.close();resolve(value&&value.result);};
      tx.onerror=()=>{db.close();reject(tx.error);};tx.onabort=()=>{db.close();reject(tx.error||new Error('Temporary audio transaction aborted'));};
    });
  }
  const temp={
    put(part){return transaction('readwrite',store=>store.put(part));},
    async list(session){const db=await openDB();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly'),request=tx.objectStore(STORE).getAll();
      request.onsuccess=()=>resolve((request.result||[]).filter(p=>p.session===session).sort((a,b)=>a.index-b.index));
      request.onerror=()=>reject(request.error);tx.oncomplete=()=>db.close();tx.onabort=()=>{db.close();reject(tx.error);};
    });},
    async remove(session){const parts=await this.list(session);await transaction('readwrite',store=>parts.forEach(part=>store.delete(part.key)));},
    async sweep(maxAgeMs){const db=await openDB();const all=await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly'),request=tx.objectStore(STORE).getAll();
      request.onsuccess=()=>resolve(request.result||[]);request.onerror=()=>reject(request.error);
      tx.oncomplete=()=>db.close();tx.onabort=()=>{db.close();reject(tx.error);};
    });
      const expired=all.filter(part=>!part.createdAt||Date.now()-part.createdAt>maxAgeMs);
      if(expired.length)await transaction('readwrite',store=>expired.forEach(part=>store.delete(part.key)));
    }
  };
  let startupCleanup=Promise.resolve();
  const voice={state:'idle',session:null,context:null,stream:null,node:null,captureActive:false,sampleRate:0,samples:0,
    pcm:[],pcmBytes:0,partIndex:0,writeChain:Promise.resolve(),writeError:null,results:[],abort:null,
    playingAudio:null,audioUrl:null,previewParts:[],previewIndex:0,signalPeak:0,level:0,micCount:0,micLabel:'',noSignalWarning:false,timer:null,file:null,importController:null};
  function element(id){return document.getElementById(id);}
  function setMessage(value){element('voice-message').textContent=value||'';}
  function render(){
    const s=voice.state,preparing=s==='starting'||s==='uploading',hasAudio=!!voice.session&&!preparing,active=s==='recording'||s==='paused',transcribing=s==='transcribing';
    element('voice-open').textContent=s==='recording'?'● 录音中':s==='paused'?'Ⅱ 已暂停':'🎙 录音';
    element('voice-open').classList.toggle('voice-header-active',active);
    element('voice-open').setAttribute('aria-label',s==='recording'?'正在录音，打开录音面板':s==='paused'?'录音已暂停，打开录音面板':'录音 / 上传音频');
    element('voice-state').textContent=text(s);element('voice-duration').textContent=VoiceCore.formatDuration(voice.samples/(voice.sampleRate||1));
    element('voice-start').textContent=text('start');element('voice-start').disabled=s==='starting'||s==='uploading'||active||transcribing;
    element('voice-upload-trigger').disabled=s==='starting'||s==='uploading'||active||transcribing;
    element('voice-mic-row').hidden=!voice.micCount||s==='uploading';
    element('voice-mic-select').disabled=active||preparing||transcribing;
    element('voice-mic-current').hidden=!active||!voice.micLabel;
    element('voice-mic-current').textContent=voice.micLabel?(typeof _lang!=='undefined'&&_lang==='en'?'Using: ':'当前使用：')+voice.micLabel:'';
    element('voice-input-monitor').hidden=!active;
    element('voice-input-level').value=s==='paused'?0:Math.min(1,voice.level*12);
    element('voice-input-hint').textContent=s==='paused'?'已暂停':!voice.samples?'检测中…':voice.level<0.002?'几乎没有输入':'有输入信号';
    element('voice-file-details').hidden=!voice.file;
    element('voice-file-details').textContent=voice.file?voice.file.name+' · '+(voice.file.size/1024/1024).toFixed(1)+' MB'+(voice.file.duration?' · '+VoiceCore.formatDuration(voice.file.duration):''):'';
    element('voice-pause').hidden=!active;element('voice-pause').textContent=text(s==='paused'?'resume':'pause');
    element('voice-finish').hidden=!active;element('voice-finish').textContent=text('finish');
    element('voice-cancel').hidden=!active&&s!=='uploading';element('voice-cancel').textContent=text('cancel');
    element('voice-play').hidden=!hasAudio||active||transcribing;element('voice-play').textContent=text(voice.playingAudio?'stopPlay':'play');
    element('voice-transcribe').hidden=!hasAudio||active||transcribing||s==='complete'||!!voice.writeError;
    element('voice-transcribe').textContent=text(s==='failed'?'retry':'transcribe');
    element('voice-stop-transcribe').hidden=!transcribing;element('voice-stop-transcribe').textContent=text('stopTranscribe');
    element('voice-delete').hidden=!hasAudio||active||transcribing;element('voice-delete').textContent=text('delete');
    element('voice-audio-preview').hidden=!voice.previewParts.length||active||preparing;
    element('voice-raw-label').textContent=text('raw');element('voice-insert').textContent=text('insert');
    const complete=voice.results.length>0&&voice.results.filter(Boolean).length===voice.results.length;
    element('voice-raw-area').hidden=!voice.results.some(Boolean);
    element('voice-raw').readOnly=transcribing||!complete;
    element('voice-insert').disabled=!complete||transcribing;
    element('voice-settings').hidden=!!AsrSettings.config();
    element('voice-panel').classList.toggle('is-recording',s==='recording');
    element('voice-panel').classList.toggle('is-paused',s==='paused');
  }
  function addSamples(samples){
    if(!voice.captureActive)return;
    for(const sample of samples)voice.signalPeak=Math.max(voice.signalPeak,Math.abs(sample));
    const pcm=VoiceCore.pcm16(samples),maxSamples=Math.floor(voice.sampleRate*26.5);
    voice.pcm.push(pcm);voice.pcmBytes+=pcm.length;voice.samples+=samples.length;
    const seconds=voice.pcmBytes/2/voice.sampleRate;
    let rms=0;for(const v of samples)rms+=v*v;rms=Math.sqrt(rms/Math.max(1,samples.length));
    voice.level=rms;
    if(voice.samples/voice.sampleRate>2&&voice.signalPeak<0.003&&!voice.noSignalWarning){
      voice.noSignalWarning=true;
      setMessage((typeof _lang!=='undefined'&&_lang==='en'?'The selected microphone has almost no input: ':'当前麦克风几乎无声：')+
        (voice.micLabel||'')+(typeof _lang!=='undefined'&&_lang==='en'?'. Stop recording and choose another microphone.':'。请结束录音后换选麦克风。'));
    }else if(voice.signalPeak>=0.005&&voice.noSignalWarning){voice.noSignalWarning=false;setMessage('');}
    if(VoiceCore.shouldFlush(seconds,rms)||voice.pcmBytes/2>=maxSamples)queuePart();
    if(voice.samples/voice.sampleRate>=MAX_RECORD_SECONDS){setMessage(text('limit'));finishRecording();}
  }
  function queuePart(){
    if(!voice.pcmBytes)return;
    const chunks=voice.pcm,seconds=voice.pcmBytes/2/voice.sampleRate,index=voice.partIndex++,session=voice.session,rate=voice.sampleRate;
    voice.pcm=[];voice.pcmBytes=0;voice.file=null;
    voice.writeChain=voice.writeChain.then(()=>temp.put({key:session+':'+index,session,index,blob:VoiceCore.wav(chunks,rate),seconds,createdAt:Date.now()}))
      .catch(error=>{voice.writeError=error;setMessage(text('storage'));});
  }
  async function stopCapture(flush){
    const stream=voice.stream,node=voice.node,context=voice.context;
    if(!context)return;
    if(stream)stream.getTracks().forEach(track=>track.stop());
    if(flush&&node){
      try{if(context.state==='suspended')await context.resume();
        await Promise.race([new Promise(resolve=>{
          const prior=node.port.onmessage;node.port.onmessage=event=>{
            if(event.data&&event.data.type==='flushed'){node.port.onmessage=prior;resolve();}
            else if(prior)prior(event);
          };node.port.postMessage({type:'flush'});
        }),new Promise(resolve=>setTimeout(resolve,1200))]);
      }catch(_){}
    }
    voice.captureActive=false;
    if(node)node.port.onmessage=null;
    try{await context.close();}catch(_){}
    voice.stream=null;voice.context=null;voice.node=null;
    clearInterval(voice.timer);voice.timer=null;
  }
  async function releaseAudio(){
    voice.previewParts=[];stopPlayback();const session=voice.session;voice.session=null;
    try{await voice.writeChain;}catch(_){/* Still remove already committed parts after a failed write. */}
    if(session)await temp.remove(session);
    voice.pcm=[];voice.pcmBytes=0;
  }
  async function refreshMicrophones(){
    if(!navigator.mediaDevices||!navigator.mediaDevices.enumerateDevices)return;
    try{
      const select=element('voice-mic-select');let remembered='';
      try{remembered=localStorage.getItem(MIC_KEY)||'';}catch(_){}
      const chosen=select.value||remembered;
      const devices=(await navigator.mediaDevices.enumerateDevices()).filter(device=>device.kind==='audioinput');
      select.replaceChildren(new Option('系统默认麦克风',''));
      devices.forEach((device,index)=>{if(device.deviceId)select.add(new Option(device.label||'麦克风 '+(index+1),device.deviceId));});
      select.value=Array.from(select.options).some(option=>option.value===chosen)?chosen:'';
      voice.micCount=devices.length;render();
    }catch(_){/* Device enumeration is optional; default microphone still works. */}
  }
  async function startRecording(){
    await startupCleanup;
    if(voice.session){if(!confirm(text('recordConfirm')))return;await releaseAudio();}
    voice.results=[];element('voice-raw').value='';voice.samples=0;voice.partIndex=0;voice.signalPeak=0;voice.level=0;voice.micLabel='';voice.noSignalWarning=false;voice.writeError=null;voice.writeChain=Promise.resolve();
    voice.state='starting';setMessage('');render();
    try{
      if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.AudioWorkletNode||!window.AudioContext)throw {name:'Unsupported'};
      const chosen=element('voice-mic-select').value;
      const constraints={channelCount:1,echoCancellation:true,noiseSuppression:true};
      if(chosen)constraints.deviceId={exact:chosen};
      const stream=await navigator.mediaDevices.getUserMedia({audio:constraints,video:false});
      voice.stream=stream;voice.session=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+'-'+Math.random());
      voice.micLabel=stream.getAudioTracks()[0]?.label||'';
      let context;try{context=new AudioContext({sampleRate:16000});}catch(_){context=new AudioContext();}
      voice.context=context;voice.sampleRate=context.sampleRate;
      await context.audioWorklet.addModule('./assets/voice-capture-worklet.js');
      const source=context.createMediaStreamSource(stream),node=new AudioWorkletNode(context,'voice-capture-processor',
        {numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
      source.connect(node);node.connect(context.destination);
      voice.node=node;node.port.onmessage=event=>{if(event.data&&event.data.type==='samples')addSamples(event.data.samples);};
      if(context.state!=='running'){
        const resumed=await Promise.race([context.resume().then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),2500))]);
        if(!resumed||context.state!=='running')throw {name:'CaptureSuspended'};
      }
      voice.captureActive=true;voice.state='recording';voice.timer=setInterval(render,250);render();
      refreshMicrophones();
    }catch(error){await stopCapture(false);voice.session=null;voice.state='idle';setMessage(VoiceCore.microphoneError(error,typeof _lang!=='undefined'?_lang:'zh'));render();}
  }
  async function pauseRecording(){
    if(voice.state==='recording'){await voice.context.suspend();voice.state='paused';}
    else if(voice.state==='paused'){await voice.context.resume();voice.state='recording';}
    render();
  }
  async function finishRecording(){
    if(voice.state!=='recording'&&voice.state!=='paused')return;
    voice.state='starting';render();await stopCapture(true);queuePart();await voice.writeChain;
    if(voice.writeError){voice.state='failed';setMessage(text('storage'));}
    else if(voice.samples/voice.sampleRate<0.25){await releaseAudio();voice.state='idle';setMessage(text('empty')+(typeof _lang!=='undefined'&&_lang==='en'?' Check the selected microphone and browser permission.':' 请检查所选麦克风和浏览器权限。'));}
    else{await preparePreview();voice.state='ready';if(voice.signalPeak<0.005)setMessage(text('silent'));}
    render();
  }
  async function cancelRecording(){
    if(voice.state==='uploading'){
      if(voice.importController)voice.importController.abort();voice.importController=null;
      await releaseAudio();voice.state='idle';voice.samples=0;voice.file=null;setMessage('');render();return;
    }
    if(voice.state!=='recording'&&voice.state!=='paused')return;
    voice.state='starting';voice.captureActive=false;await stopCapture(false);await releaseAudio();voice.state='idle';voice.samples=0;
    setMessage('');render();
  }
  async function uploadAudio(file){
    if(!file)return;
    if(!/\.(mp3|wav|m4a|mp4|webm|ogg)$/i.test(file.name)){setMessage(text('badFormat'));return;}
    if(!file.size){setMessage(text('empty'));return;}
    if(file.size>80*1024*1024){setMessage(text('tooLarge'));return;}
    await startupCleanup;
    if(voice.session){if(!confirm(text('recordConfirm')))return;await releaseAudio();}
    voice.results=[];element('voice-raw').value='';voice.writeError=null;voice.writeChain=Promise.resolve();
    voice.session=crypto.randomUUID?crypto.randomUUID():String(Date.now())+'-'+Math.random();
    const session=voice.session,controller=new AbortController();voice.importController=controller;
    voice.file={name:file.name,size:file.size,duration:0};voice.samples=0;voice.sampleRate=16000;voice.state='uploading';setMessage('');render();
    let context;
    try{
      context=new AudioContext();
      const decoded=await context.decodeAudioData(await file.arrayBuffer());
      if(controller.signal.aborted||voice.session!==session)return;
      if(!decoded.duration||decoded.duration>90*60)throw {code:decoded.duration?'tooLarge':'invalidAudio'};
      voice.file.duration=decoded.duration;voice.samples=Math.round(decoded.duration*16000);render();
      await VoiceCore.splitAudioBuffer(decoded,async part=>{
        if(controller.signal.aborted||voice.session!==session)throw {code:'cancelled'};
        voice.writeChain=voice.writeChain.then(()=>temp.put({key:session+':'+part.index,session,index:part.index,blob:part.blob,seconds:part.seconds,createdAt:Date.now()}));
        await voice.writeChain;
        setMessage(text('uploading')+' '+(part.index+1)+'/'+part.total);
      },controller.signal);
      if(controller.signal.aborted||voice.session!==session)return;
      await preparePreview();voice.state='ready';setMessage('');render();
    }catch(error){
      if(voice.session===session){await releaseAudio();voice.file=null;voice.samples=0;voice.state='idle';
        setMessage(error.code==='tooLarge'?text('tooLarge'):error.code==='cancelled'?'':error.name==='QuotaExceededError'?text('storage'):text('badFile'));render();}
    }finally{if(context)await context.close().catch(()=>{});if(voice.importController===controller)voice.importController=null;}
  }
  function previewPart(index){
    const audio=element('voice-audio-preview');
    audio.pause();if(voice.audioUrl)URL.revokeObjectURL(voice.audioUrl);
    voice.audioUrl=null;voice.previewIndex=index;
    if(index<voice.previewParts.length){
      voice.audioUrl=URL.createObjectURL(voice.previewParts[index].blob);
      audio.src=voice.audioUrl;audio.load();
    }else{audio.removeAttribute('src');audio.load();}
  }
  async function preparePreview(){
    const session=voice.session,parts=await temp.list(session);
    if(session!==voice.session)return;
    voice.previewParts=parts;previewPart(0);render();
  }
  function stopPlayback(){
    const audio=element('voice-audio-preview');audio.pause();voice.playingAudio=null;
    if(voice.previewParts.length)previewPart(0);
    else previewPart(voice.previewParts.length);
    render();
  }
  function playRecording(){
    const audio=element('voice-audio-preview');
    if(!voice.previewParts.length){setMessage(text('empty'));return;}
    if(!audio.paused){audio.pause();voice.playingAudio=null;render();return;}
    // The source is loaded when recording finishes. play() therefore runs inside
    // this click gesture, rather than after an IndexedDB await (autoplay blocked).
    audio.play().catch(()=>{voice.playingAudio=null;setMessage(text('playError'));render();});
  }
  function currentConfig(){return AsrSettings.config();}
  function renderTranscript(){
    const complete=voice.results.length&&voice.results.filter(Boolean).length===voice.results.length,current=element('voice-raw');
    const lines=Array.from({length:voice.results.length},(_,i)=>voice.results[i]||'['+(typeof _lang!=='undefined'&&_lang==='en'?'Segment ':'第 ')+(i+1)+(typeof _lang!=='undefined'&&_lang==='en'?' failed':' 段转写失败')+']');
    current.value=lines.reduce((a,b)=>VoiceCore.appendTranscript(a,b),'');
    current.readOnly=!complete;render();
  }
  async function transcribeRecording(){
    if(!voice.session||voice.state==='transcribing')return;
    const config=currentConfig();if(!config){setMessage(text('noConfig'));render();element('voice-settings').hidden=false;return;}
    const parts=await temp.list(voice.session);if(!parts.length){voice.state='failed';setMessage(text('empty'));render();return;}
    voice.abort=new AbortController();voice.state='transcribing';setMessage('');render();
    const outcome=await VoiceCore.transcribeParts(parts,voice.results,config,AbortSignal.any([voice.abort.signal,AsrSettings.signal()]),(index,total,stage,waitMs)=>{
      if(stage==='start')setMessage(text('transcribing')+' '+(index+1)+'/'+total);
      else if(stage==='retry')setMessage((typeof _lang!=='undefined'&&_lang==='en'?'Limited; waiting ':'请求受限，等待 ')+Math.ceil(waitMs/1000)+(typeof _lang!=='undefined'&&_lang==='en'?'s before retry…':' 秒后重试…'));
      else if(stage==='success')renderTranscript();
    });
    voice.abort=null;
    voice.state=outcome.complete?'complete':outcome.cancelled?'ready':'failed';
    renderTranscript();
    if(outcome.complete)AsrSettings.report(true);
    else if(outcome.errors.length)AsrSettings.report(false,VoiceCore.asrError(outcome.errors[0].error,typeof _lang!=='undefined'?_lang:'zh'));
    if(outcome.cancelled)setMessage(text('cancelled'));
    else if(voice.state==='complete')setMessage('');
    else if(outcome.errors.length){const first=outcome.errors[0];setMessage(text('badPart').replace('{n}',outcome.errors.map(item=>item.index+1).join(', '))
      .replace('{error}',VoiceCore.asrError(first.error,typeof _lang!=='undefined'?_lang:'zh'))+(voice.results.some(Boolean)?' '+text('partial'):''));}
  }
  function insertTranscript(){
    if(!voice.results.length||voice.results.filter(Boolean).length!==voice.results.length)return;
    const raw=element('voice-raw').value.trim();if(!raw)return;
    const editor=element('note-input');if(editor.value.trim()&&!confirm(text('appendConfirm')))return;
    editor.value=VoiceCore.appendToNote(editor.value,raw);
    editor.dispatchEvent(new Event('input',{bubbles:true}));editor.focus();
    releaseAudio().catch(error=>console.warn('[Voice] temporary cleanup failed',error));
    voice.state='complete';setMessage(text('saved'));render();
  }
  async function deleteRecording(){
    if(voice.abort)voice.abort.abort();await releaseAudio();voice.results=[];voice.samples=0;voice.state='idle';
    element('voice-raw').value='';voice.file=null;setMessage('');render();
  }
  window.addEventListener('DOMContentLoaded',()=>{
    startupCleanup=temp.sweep(12*60*60*1000).catch(error=>console.warn('[Voice] stale temporary audio cleanup failed',error));
    element('voice-open').addEventListener('click',()=>{element('voice-panel').hidden=false;element('voice-panel').classList.add('open');render();refreshMicrophones();});
    if(navigator.mediaDevices&&navigator.mediaDevices.addEventListener)navigator.mediaDevices.addEventListener('devicechange',refreshMicrophones);
    element('voice-close').addEventListener('click',()=>{element('voice-panel').classList.remove('open');element('voice-panel').hidden=true;});
    element('voice-panel').addEventListener('click',event=>{if(event.target===element('voice-panel'))element('voice-close').click();});
    element('voice-start').addEventListener('click',startRecording);
    element('voice-mic-select').addEventListener('change',event=>{
      try{if(event.target.value)localStorage.setItem(MIC_KEY,event.target.value);else localStorage.removeItem(MIC_KEY);}catch(_){}
    });
    element('voice-upload-trigger').addEventListener('click',()=>element('voice-upload').click());
    element('voice-upload').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';uploadAudio(file).catch(()=>setMessage(text('badFile')));});
    element('voice-settings').addEventListener('click',()=>{element('voice-close').click();if(!element('settingsModal').classList.contains('open'))toggleSettings();element('asr-config').scrollIntoView({block:'center'});});
    element('voice-pause').addEventListener('click',()=>pauseRecording().catch(()=>setMessage(text('recordError'))));
    element('voice-finish').addEventListener('click',finishRecording);
    element('voice-cancel').addEventListener('click',cancelRecording);
    element('voice-play').addEventListener('click',playRecording);
    const preview=element('voice-audio-preview');
    preview.addEventListener('play',()=>{voice.playingAudio=preview;render();});
    preview.addEventListener('pause',()=>{voice.playingAudio=null;render();});
    preview.addEventListener('ended',()=>{
      if(voice.previewIndex+1<voice.previewParts.length){
        previewPart(voice.previewIndex+1);
        preview.play().catch(()=>{setMessage(text('playError'));render();});
      }else stopPlayback();
    });
    preview.addEventListener('error',()=>{if(voice.previewParts.length)setMessage(text('playError'));});
    element('voice-transcribe').addEventListener('click',()=>transcribeRecording().catch(error=>{voice.state='failed';setMessage(VoiceCore.asrError(error,typeof _lang!=='undefined'?_lang:'zh'));render();}));
    element('voice-stop-transcribe').addEventListener('click',()=>{if(voice.abort)voice.abort.abort();});
    element('voice-delete').addEventListener('click',deleteRecording);
    element('voice-insert').addEventListener('click',insertTranscript);
    window.addEventListener('pagehide',()=>{if(voice.abort)voice.abort.abort();
      if(voice.importController)voice.importController.abort();
      if(voice.stream)voice.stream.getTracks().forEach(track=>track.stop());
      if(voice.session)temp.remove(voice.session).catch(()=>{});
    });
    render();
  });
})();
