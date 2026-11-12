export const MEMORY_LIMIT=30;
export function memoryCommand(text){
 const value=text.trim();
 const prefix=value.match(/^bunu\s+hatırla\s*[:,.!—-]?\s+(.+)$/iu);
 const suffix=value.match(/^(.+?)[.!;,]?\s+bunu\s+hatırla[.!]?$/iu);
 if(/^bunu\s+hatırla[.!]?$/iu.test(value))return {text:''};
 if(!prefix&&!suffix)return null;
 return {text:(prefix?.[1]||suffix[1]).trim()};
}
export async function memories(db){
 if(!db)throw new Error('Memory unavailable');
 const result=await db.prepare('SELECT id, text, created_at FROM atlas_memories ORDER BY created_at DESC, id DESC LIMIT 30').all();
 return result.results;
}
export async function remember(db,command){
 const parsed=typeof command==='string'&&memoryCommand(command);
 if(!parsed?.text||parsed.text.length>400)return {status:400,error:'“Bunu hatırla: …” diyerek en fazla 400 karakterlik bilgiyi belirtin.'};
 const existing=await db.prepare('SELECT id, text, created_at FROM atlas_memories WHERE text = ?').bind(parsed.text).first();
 if(existing)return {status:200,item:existing,alreadySaved:true};
 const item={id:crypto.randomUUID(),text:parsed.text,created_at:new Date().toISOString()};
 await db.prepare('INSERT OR IGNORE INTO atlas_memories (id, text, created_at) SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM atlas_memories) < 30').bind(item.id,item.text,item.created_at).run();
 const saved=await db.prepare('SELECT id, text, created_at FROM atlas_memories WHERE text = ?').bind(parsed.text).first();
 return saved?{status:200,item:saved}:{status:409,error:'Hafıza dolu (30 kayıt). Önce bir kaydı gözden geçirip silebilirsiniz.'};
}
