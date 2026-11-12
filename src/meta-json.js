// Meta IDs exceed JavaScript's safe integer range. Preserve the original digits.
export function parseMetaJSON(text){return JSON.parse(text,(key,value,context)=>{
 if((key==='user_id'||key==='id')&&typeof value==='number'){
  if(context?.source&&/^\d+$/.test(context.source))return context.source;
  if(Number.isSafeInteger(value))return String(value);
  throw Error('unsafe-id');
 }
 return value;
});}
