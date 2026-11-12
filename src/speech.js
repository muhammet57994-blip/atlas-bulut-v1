import {reportError} from './log.js';
const MODEL='gemini-3.8-flash-lite-tts';
const STYLE='Speak in fluent, natural Istanbul Turkish with a rich, low-mid baritone voice. Calm, composed, reassuring and quietly confident, like a thoughtful personal assistant. Slightly slower conversational pace, short natural pauses, subtle human intonation and warm resonance. Keep the delivery effortless and attentive. Avoid a theatrical bass, robotic monotone, military commands, whispering, breathiness, and announcer-style emphasis.';
export async function generateSpeech(text,env,upstream,headers,requestId=''){
 const error=(message,status)=>new Response(JSON.stringify({error:message}),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
 if(typeof text!=='string'||!text.trim()||text.length>600)return error('Sesli yanıt en fazla 600 karakter olabilir.',400);
 if(!env.GEMINI_API_KEY)return error('Ses bağlantısı henüz kurulmadı.',503);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),40000);
 try{
  const response=await upstream('https://generativelanguage.googleapis.com/v1beta/interactions',{
   method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},redirect:'manual',signal:controller.signal,
   body:JSON.stringify({model:MODEL,store:false,input:[{type:'user_input',content:[{type:'text',text,annotations:[{type:'speech_metadata',style:STYLE}]}]}],response_format:{type:'audio'},generation_config:{speech_config:[{voice:'Algieba'}]}})
  });
  if(!response.ok)return error(response.status===429?'Ses hizmetinin hız veya kota sınırına ulaşıldı (429). Biraz bekleyip tekrar deneyin; günlük sınırsa kotanın yenilenmesi gerekir. Yanıtınız yazılı olarak hazır.':'Doğal ses şu anda hazırlanamadı. Yanıtı yazılı okuyabilirsiniz.',response.status===429?429:502);
  const reader=response.body?.getReader();if(!reader)return error('Ses alınamadı.',502);
  const chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>3*1024*1024){await reader.cancel();return error('Ses yanıtı çok uzun. Daha kısa bir yanıt isteyin.',502);}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const data=JSON.parse(new TextDecoder().decode(bytes));
  const audio=data.steps?.filter(s=>s.type==='model_output').flatMap(s=>s.content||[]).filter(c=>c.type==='audio').at(-1);
  if(typeof audio?.data!=='string'||audio.data.length>2800000)return error('Geçerli bir ses yanıtı alınamadı.',502);
  const binary=atob(audio.data);
  if(binary.length<44||binary.length>2*1024*1024||binary.slice(0,4)!=='RIFF'||binary.slice(8,12)!=='WAVE')return error('Ses biçimi desteklenmiyor.',502);
  const wav=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)wav[i]=binary.charCodeAt(i);
  return new Response(wav,{headers:{...headers,'Content-Type':'audio/wav'}});
 }catch(failure){reportError({stage:'model.speech',requestId,error:failure,meta:{provider:'gemini'}});return error('Ses alınamadı. Yanıtı yazılı okuyabilirsiniz.',controller.signal.aborted?504:502);}finally{clearTimeout(timer);}
}
