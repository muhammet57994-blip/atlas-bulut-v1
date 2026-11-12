/* A reusable, short-lived Live connection. No permanent API key enters the browser. */
class AtlasLiveAudio {
 constructor(){this.socket=null;this.pending=null;this.born=0;this.rendering=false;}
 close(){const socket=this.socket;this.socket=null;this.ready=null;if(socket){socket.onclose=null;socket.onerror=null;socket.onmessage=null;socket.close();}this.pending?.reject(new Error('Live ses bağlantısı kapandı. Yeniden başlatabilirsiniz.'));this.pending=null;}
 async connect(signal){
  if(this.socket?.readyState===1&&Date.now()-this.born<480000)return;
  this.close();
  const response=await fetch('/api/live/token',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}',signal});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Live ses başlatılamadı.');
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  const socket=new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token='+encodeURIComponent(data.token));
  this.socket=socket;this.born=Date.now();
  await new Promise((resolve,reject)=>{
   this.pending={reject};
   socket.onopen=()=>socket.send(JSON.stringify({setup:{model:data.model}}));
   socket.onerror=()=>this.close();socket.onclose=()=>this.close();
   socket.onmessage=async event=>{
    try{
     const raw=typeof event.data==='string'?event.data:await event.data.text();if(raw.length>3000000)throw Error('size');
     const message=JSON.parse(raw);if(this.socket!==socket)return;
     if(message.error)throw Error('provider');
     if(message.setupComplete){this.pending=null;resolve();return;}
     if(message.goAway)this.born=0;
     if(!this.pending?.chunks)return;
     for(const part of message.serverContent?.modelTurn?.parts||[]){
      const audio=part.inlineData;if(!audio)continue;
      if(!/^audio\/pcm;rate=24000$/.test(audio.mimeType)||audio.data.length>3000000)throw Error('audio');
      const binary=atob(audio.data);if(binary.length%2)throw Error('pcm');
      this.pending.size+=binary.length;if(this.pending.size>2*1024*1024)throw Error('size');
      const chunk=Uint8Array.from(binary,c=>c.charCodeAt(0));this.pending.chunks.push(chunk);
      this.pending.onChunk?.(chunk);
     }
     if(message.serverContent?.turnComplete){const p=this.pending;this.pending=null;if(!p.size){p.reject(new Error('Live ses üretilemedi. Yanıtı yazılı okuyabilirsiniz.'));return;}p.resolve(p);}
    }catch{this.close();}
   };
  });
 }
 async render(text,context,signal,onAudio){
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(this.rendering)throw new Error('Ses hazırlanıyor. Bitmesini bekleyin.');
  this.rendering=true;
  const outerSignal=signal,controller=new AbortController();
  const relay=()=>controller.abort();outerSignal.addEventListener('abort',relay,{once:true});signal=controller.signal;
  const timer=setTimeout(()=>controller.abort(),30000);
  const abort=()=>this.close();signal.addEventListener('abort',abort,{once:true});
  try{
   await this.connect(signal);if(signal.aborted)throw new DOMException('Aborted','AbortError');
   const result=await new Promise((resolve,reject)=>{this.pending={resolve,reject,chunks:[],size:0,onChunk:onAudio?chunk=>{if(signal.aborted)return;const buffer=context.createBuffer(1,chunk.length/2,24000),samples=buffer.getChannelData(0),view=new DataView(chunk.buffer);for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(i*2,true)/32768;onAudio(buffer);}:null};this.socket.send(JSON.stringify({clientContent:{turns:[{role:'user',parts:[{text:'Aşağıdaki metni aynen seslendir:\n'+text}]}],turnComplete:true}}));});
   const buffer=context.createBuffer(1,result.size/2,24000),samples=buffer.getChannelData(0);let offset=0;
   for(const chunk of result.chunks){const view=new DataView(chunk.buffer);for(let i=0;i<chunk.length;i+=2)samples[offset++]=view.getInt16(i,true)/32768;}
   return buffer;
  }finally{clearTimeout(timer);this.rendering=false;signal.removeEventListener('abort',abort);outerSignal.removeEventListener('abort',relay);}
 }
}
window.AtlasLiveAudio=AtlasLiveAudio;
