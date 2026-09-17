/* Continuous PCM capture; segmentation happens in the UI thread without stopping the mic. */
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor(){
    super();this.buffer=new Float32Array(4096);this.used=0;
    this.port.onmessage=event=>{if(event.data&&event.data.type==='flush'){
      this.send();this.port.postMessage({type:'flushed'});
    }};
  }
  send(){
    if(!this.used)return;
    const samples=this.buffer.slice(0,this.used);this.used=0;
    this.port.postMessage({type:'samples',samples},[samples.buffer]);
  }
  process(inputs,outputs){
    // Keep the processing graph connected without feeding microphone audio
    // back to the speakers. A zero-gain downstream node may be optimized away.
    for(const output of outputs||[])for(const channel of output)channel.fill(0);
    const channels=inputs[0];
    if(!channels||!channels.length)return true;
    for(let i=0;i<channels[0].length;i++){
      let value=0;for(const channel of channels)value+=channel[i]||0;
      this.buffer[this.used++]=value/channels.length;
      if(this.used===this.buffer.length)this.send();
    }
    return true;
  }
}
registerProcessor('voice-capture-processor',VoiceCaptureProcessor);
