(() => {
  'use strict';
  const MAX_BYTES = 4 * 1024 * 1024;
  const scope = 'current_personal_records_including_archives_and_bill_payment_declarations_budgets_and_waiting';
  const excluded = ['credentials','sessions','instagram_connection_and_statistics','change_history','task_completion_history','device_preferences','offline_device_cache','multi_action_receipts'];
  const schema = {
    memories: ['id','text','created_at'],
    notes: ['id','text','created_at','archived_at','revision'],
    tasks: ['id','title','due_date','done','created_at','recurrence','completed_at'],
    plans: ['id','kind','title','plan_day','text','created_at'],
    routines: ['id','trigger','topic','steps','created_at'],
    agenda: ['id','title','task_id','starts_at','ends_at','created_at','archived_at','revision'],
    expenses: ['id','title','amount_minor','currency','category','spent_day','created_at','archived_at','revision'],
    focus: ['id','title','task_id','planned_seconds','elapsed_seconds','status','started_at_ms','started_day','last_started_at_ms','finished_at_ms','revision'],
    contentCalendar: ['id','title','due_date','format','published','created_at'],
    lists: ['id','title','kind','revision','archived','created_at','updated_at','items'],
    billPlans: ['id','title','amount_minor','currency','recurrence','start_date','anchor_day','anchor_month','revision','archived','created_at','updated_at'],
    billPayments: ['id','bill_id','due_date','title','amount_minor','planned_amount_minor','currency','paid_date','expense_id','created_at'],
    budgets: ['id','month','category','amount_minor','currency','archived','revision','created_at','updated_at'],
    waiting: ['id','who','what','kind','followup_date','last_contact_date','status','archived','revision','created_at','updated_at']
  };
  const limits = {memories:30,notes:100,tasks:100,plans:50,routines:30,agenda:200,expenses:500,focus:200,contentCalendar:100,lists:30,billPlans:100,billPayments:2000,budgets:100,waiting:200};
  const integerFields = new Set(['amount_minor','planned_amount_minor','anchor_day','anchor_month','elapsed_seconds','ends_at','expense_id','last_started_at_ms','planned_seconds','revision','started_at_ms','starts_at','task_id']);
  const stringIdGroups = new Set(['memories','routines','contentCalendar','lists','billPlans','billPayments','budgets','waiting']);
  const nullableFields = {notes:new Set(['archived_at']),tasks:new Set(['completed_at']),agenda:new Set(['archived_at','task_id']),expenses:new Set(['archived_at']),focus:new Set(['finished_at_ms','last_started_at_ms','task_id'])};
  const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
  const safeTree = (value, depth=0) => {
    if (depth > 12) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isSafeInteger(value);
    if (Array.isArray(value)) return value.every(item => safeTree(item,depth+1));
    if (typeof value !== 'object') return false;
    return Object.values(value).every(item => safeTree(item,depth+1));
  };
  function validateText(text, declaredSize) {
    if (typeof text !== 'string') return {ok:false,error:'Dosya metni okunamadı.'};
    const byteLength = new TextEncoder().encode(text).byteLength;
    if ((Number.isFinite(declaredSize) && declaredSize > MAX_BYTES) || byteLength > MAX_BYTES) return {ok:false,error:'Dosya 4 MiB sınırını aşıyor.'};
    let doc;
    try { doc=JSON.parse(text); } catch { return {ok:false,error:'Dosya geçerli JSON değil.'}; }
    const topKeys=['application','formatVersion','exportedAt','timezone','scope','excluded','restoreSupported','counts','data'];
    if (!exactKeys(doc,topKeys) || doc.application!=='ATLAS' || doc.formatVersion!==1 || doc.timezone!=='Europe/Istanbul' || doc.scope!==scope || doc.restoreSupported!==false) return {ok:false,error:'Bu dosya desteklenen ATLAS JSON yedeği biçiminde değil.'};
    if (typeof doc.exportedAt!=='string' || !Number.isFinite(Date.parse(doc.exportedAt)) || !Array.isArray(doc.excluded) || JSON.stringify(doc.excluded)!==JSON.stringify(excluded)) return {ok:false,error:'Yedek üst bilgileri doğrulanamadı.'};
    const groups=Object.keys(schema);
    if (!exactKeys(doc.data,groups) || !exactKeys(doc.counts,groups) || !safeTree(doc.data)) return {ok:false,error:'Yedekte eksik, desteklenmeyen veya güvenli olmayan alan var.'};
    const counts={};
    for (const group of groups) {
      const rows=doc.data[group];
      if (!Array.isArray(rows) || rows.length>limits[group]) return {ok:false,error:'“'+group+'” grubunun biçimi veya kayıt sayısı desteklenmiyor.'};
      const fields=schema[group],ids=new Set();
      for (const row of rows) {
        if (!exactKeys(row,fields)) return {ok:false,error:'“'+group+'” grubunda beklenmeyen alan veya eksik bilgi var.'};
        for (const [key,value] of Object.entries(row)) {
          if (value===null && nullableFields[group]?.has(key)) continue;
          if (key==='items' || key==='steps') continue;
          if (key==='id') { if (stringIdGroups.has(group) ? typeof value!=='string' : !Number.isSafeInteger(value)) return {ok:false,error:'“'+group+'” grubunda kayıt numarası doğrulanamadı.'}; }
          else if (integerFields.has(key)) { if (!Number.isSafeInteger(value)) return {ok:false,error:'“'+group+'” grubunda sayısal alan doğrulanamadı.'}; }
          else if (['done','published','archived'].includes(key)) { if (typeof value!=='boolean') return {ok:false,error:'“'+group+'” grubunda durum alanı doğrulanamadı.'}; }
          else if (typeof value!=='string') return {ok:false,error:'“'+group+'” grubunda metin alanı doğrulanamadı.'};
        }
        if (ids.has(row.id)) return {ok:false,error:'“'+group+'” grubunda yinelenen kayıt numarası var.'};
        ids.add(row.id);
        if (group==='routines' && (!Array.isArray(row.steps) || row.steps.length>12 || !row.steps.every(step=>typeof step==='string'&&step.length<=500))) return {ok:false,error:'Rutin adımlarının biçimi desteklenmiyor.'};
        if (group==='lists' && (!Array.isArray(row.items) || row.items.length>100 || !row.items.every(item=>exactKeys(item,['id','title','quantity','status','archived']) && typeof item.id==='string' && typeof item.title==='string' && typeof item.quantity==='string' && ['todo','doing','done'].includes(item.status) && typeof item.archived==='boolean'))) return {ok:false,error:'Liste maddelerinin biçimi desteklenmiyor.'};
      }
      if (!Number.isSafeInteger(doc.counts[group]) || doc.counts[group]!==rows.length) return {ok:false,error:'Yedek kayıt sayıları içerikle uyuşmuyor.'};
      counts[group]=rows.length;
    }
    const billIds=new Set(doc.data.billPlans.map(row=>row.id)),expenseIds=new Set(doc.data.expenses.map(row=>row.id));
    if (doc.data.billPayments.some(row=>!billIds.has(row.bill_id)||!expenseIds.has(row.expense_id))) return {ok:false,error:'Fatura ödeme bağlantıları yedek içindeki kayıtlarla uyuşmuyor.'};
    return {ok:true,exportedAt:doc.exportedAt,counts,recordTotal:Object.values(counts).reduce((sum,count)=>sum+count,0)};
  }
  window.AtlasBackupPreview=Object.freeze({validateText,maxBytes:MAX_BYTES});
})();
