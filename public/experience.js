(()=>{
 const el=id=>document.getElementById(id),storageKey='atlas-experience-v1';
 const defaults={palette:'aurora',responseStyle:'brief',focus:'general',speechLength:600,density:'relaxed',favorites:['tasks','day','workshop']};
 const actions=[
  {id:'budget',title:'Bütçem',hint:'Aylık kategori limitleri ve kalanlar',command:'Bütçelerimi göster',icon:'₺'},
  {id:'waiting',title:'Beklediklerim',hint:'Beklenen yanıtlar ve teslimatlar',command:'Beklediklerimi göster',icon:'◌'},
  {id:'multi',title:'Birlikte yap',hint:'Bir konuşma, ayrı ayrı seçilen işlemler',command:'Birlikte yap bölümünü aç',icon:'✧'},
  {id:'replan',title:'Günümü toparla',hint:'İşlerini boş saatlere yerleştir',button:'voiceDayflow',icon:'◷'},
  {id:'bills',title:'Fatura ve abonelikler',hint:'Vadeler ve onaylı ödeme beyanları',command:'Faturalarımı göster',icon:'₺'},
  {id:'offline',title:'Çevrimdışı kayıtlar',hint:'Bu cihazdaki seçili kopyalar ve taslaklar',button:'voiceOffline',icon:'◇'},
  {id:'organize',title:'Kayıtları düzenle',hint:'Düzelt, arşivle ve geri al',button:'voiceOrganize',icon:'↶'},
  {id:'lists',title:'Listeler ve projeler',hint:'Ayrı listeler ve adım adım ilerleme',command:'Listelerimi göster',icon:'☷'},
  {id:'backup',title:'Yedekler',hint:'Kayıtlarını cihazına indir',command:'Yedeğimi indir',icon:'↓'},
  {id:'agenda',title:'Saatli ajanda',hint:'Randevular ve açık ekran uyarıları',command:'Ajandamı aç',icon:'◷'},
  {id:'focus',title:'Odak modu',hint:'Çalışma süresi ve mola',command:'Odak modunu aç',icon:'◉'},
  {id:'expenses',title:'Harcama defteri',hint:'Onaylı kayıtlar ve aylık toplamlar',command:'Harcamalarımı aç',icon:'₺'},
  {id:'tasks',title:'Yapılacaklar',hint:'Ortak görevlerin',button:'voiceTasks',icon:'✓'},
  {id:'day',title:'Günümü planla',hint:'Onayını bekleyen taslak',command:'Günümü planla',icon:'◷'},
  {id:'workshop',title:'Atölye',hint:'Projeler, rutinler, görseller',button:'voiceCompanion',icon:'✧'},
  {id:'notes',title:'Notlarım',hint:'Onayladığın notlar',button:'voiceNotes',icon:'≡'},
  {id:'plans',title:'Planlarım',hint:'Kayıtlı planlar ve ortak arama',button:'voicePlans',icon:'◇'},
  {id:'memory',title:'Hafızam',hint:'Hatırlamamı istediğin bilgiler',button:'voiceMemory',icon:'◈'},
  {id:'instagram',title:'Instagram',hint:'İstatistikler ve içerik takvimi',button:'voiceInstagram',icon:'◎'},
  {id:'resume',title:'Kaldığımız yer',hint:'Bir projeye devam et',command:'Nerede kalmıştık',icon:'↗'},
  {id:'visual',title:'Görsel yardımcı',hint:'Görsel seç ve konuş',command:'Şuna birlikte bakalım',icon:'▧'},
  {id:'routines',title:'Rutinlerim',hint:'Öğrettiğin özel komutlar',command:'Rutinlerimi göster',icon:'↻'},
  {id:'review',title:'Haftalık gelişim',hint:'Kayıtlardan değerlendirme taslağı',command:'Haftalık gelişimimi değerlendir',icon:'↗'},
  {id:'voice',title:'Ses ayarları',hint:'Hey Atlas ve açılış tercihleri',button:'voiceSettings',icon:'♫'}
 ];
 function validate(value){const p=value&&typeof value==='object'?value:{};return {palette:['aurora','violet','amber'].includes(p.palette)?p.palette:defaults.palette,responseStyle:['brief','balanced','detailed'].includes(p.responseStyle)?p.responseStyle:defaults.responseStyle,focus:['general','creator','technical'].includes(p.focus)?p.focus:defaults.focus,speechLength:[300,600].includes(p.speechLength)?p.speechLength:600,density:p.density==='compact'?'compact':'relaxed',favorites:Array.isArray(p.favorites)?[...new Set(p.favorites.filter(id=>actions.some(a=>a.id===id)))].slice(0,3):[...defaults.favorites]};}
 let prefs=validate(null),snapshot=null,captured=0,requestVersion=0,loading=false,actionBusy=false;
 try{prefs=validate(JSON.parse(window.localStorage?.getItem(storageKey)||'null'));}catch{}
 window.atlasPreferences=()=>({responseStyle:prefs.responseStyle,focus:prefs.focus});
 window.atlasSpeechText=text=>{const cap=prefs.speechLength;if(text.length<=cap)return text;let slice=text.slice(0,cap-20),cut=Math.max(slice.lastIndexOf('. '),slice.lastIndexOf('? '),slice.lastIndexOf('! '));if(cut>cap/2)slice=slice.slice(0,cut+1);else slice=slice.slice(0,Math.max(slice.lastIndexOf(' '),1));return slice+' Devamı ekranda.';};
 function element(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
 function store(){try{window.localStorage?.setItem(storageKey,JSON.stringify(prefs));el('customStatus').textContent='Tercihler bu cihazda hatırlanacak.';}catch{el('customStatus').textContent='Tercihler bu sekmede uygulandı; cihaz depolaması kullanılamıyor.';}apply();}
 function apply(){
  document.documentElement.dataset.palette=prefs.palette;document.documentElement.dataset.density=prefs.density;
  for(const [id,key] of [['personalPalette','palette'],['personalStyle','responseStyle'],['personalFocus','focus'],['personalSpeech','speechLength'],['personalDensity','density']])el(id).value=String(prefs[key]);
  el('focusLabel').textContent={general:'GÜNLÜK EŞLİKÇİN',creator:'ÜRETİM ARKADAŞIN',technical:'PROJE ARKADAŞIN'}[prefs.focus];
  el('favoriteDock').replaceChildren();for(const id of prefs.favorites){const a=actions.find(a=>a.id===id),b=element('button',a.icon+' '+a.title,'dock-action');b.addEventListener('click',()=>execute(a));el('favoriteDock').append(b);}
  renderActions(el('centerSearch').value);renderFavoriteSettings();
 }
 function renderFavoriteSettings(){el('favoriteSettings').replaceChildren();for(const a of actions){const b=element('button',a.title,'favorite-choice');b.type='button';b.setAttribute('aria-pressed',String(prefs.favorites.includes(a.id)));b.addEventListener('click',()=>{if(prefs.favorites.includes(a.id))prefs.favorites=prefs.favorites.filter(id=>id!==a.id);else if(prefs.favorites.length<3)prefs.favorites.push(a.id);else{el('customStatus').textContent='En fazla üç kısayol seçin. Önce birini kaldırın.';return;}store();});el('favoriteSettings').append(b);}}
 function renderActions(query=''){const needle=query.trim().toLocaleLowerCase('tr-TR');el('centerActions').replaceChildren();for(const a of actions.filter(a=>(a.title+' '+a.hint).toLocaleLowerCase('tr-TR').includes(needle))){const b=element('button',undefined,'center-action'),icon=element('span',a.icon,'center-action-icon'),text=element('span'),title=element('strong',a.title),hint=element('small',a.hint);text.append(title,hint);b.append(icon,text,element('span','↗'));b.addEventListener('click',()=>execute(a));el('centerActions').append(b);}el('actionEmpty').hidden=!!el('centerActions').children.length;}
 function closeCenter(){requestVersion++;loading=false;el('centerRefresh').disabled=false;el('centerDialog').close();endConversation();}
 async function execute(action){
  if(busy||actionBusy)return;closeCenter();el('toolsDialog').close();if(!loggedIn){showLogin();return;}if(action.button){el(action.button).click();return;}
  actionBusy=true;busy=true;const version=requestVersion;notice('Hazırlıyorum, Efendim.');try{const d=await api('chat',{messages:[{role:'user',text:action.command}]});if(version!==requestVersion||!loggedIn)return;addMessage('user',action.command);addMessage('model',d.text);notice(d.text);el('voiceTranscript').textContent=d.text;if(window.handleEveryday?.(d,{speak:conversation})){}else if(window.handleOffline?.(d)){}else if(window.handleDayflow?.(d)){}else if(window.handleOrganize?.(d)){}else if(window.handleDaily?.(d)){}else if(d.planDraft)window.showPlanDraft(d.planDraft);else if(!window.handleCompanion?.(d)){if(d.routineItems){el('workshopDialog').showModal();}await speak(d.text);}}
  catch(e){if(version===requestVersion){notice(e.message);if(e.status===401)showLogin();else if(e.data)window.handleEveryday?.(e.data);}}finally{actionBusy=false;busy=false;}
 }
 function renderSnapshot(data){
  snapshot=data;captured=Date.now();const c=data.center;el('centerDate').textContent=c.day+' · Türkiye saati';el('centerCounts').replaceChildren();for(const [value,label] of [[c.counts.openTasks,'açık görev'],[c.counts.overdueTasks,'geciken'],[c.counts.notes+c.counts.memories,'not ve hafıza'],[c.counts.routines,'özel rutin']]){const box=element('div',undefined,'center-stat');box.append(element('strong',String(value)),element('span',label));el('centerCounts').append(box);}
  el('centerPriorities').replaceChildren();for(const task of c.priorities){const row=element('article',undefined,'priority-row'),label=!task.due_date?'Tarihsiz':task.due_date<c.day?'Gecikmiş':task.due_date===c.day?'Bugün':task.due_date;row.append(element('span',label,'priority-date'),element('strong',task.title),element('small','Görev '+task.id));el('centerPriorities').append(row);}if(!c.priorities.length)el('centerPriorities').append(element('p','Açık işiniz yok, Efendim. Yeni bir görev ekleyebilir veya Atölye’de üretmeye başlayabilirsiniz.','center-empty'));
  el('centerRoutines').replaceChildren();for(const routine of c.routines){const b=element('button',undefined,'routine-shortcut');b.append(element('strong',routine.trigger),element('small',routine.topic));b.addEventListener('click',()=>execute({command:routine.trigger}));el('centerRoutines').append(b);}if(!c.routines.length)el('centerRoutines').append(element('p','Henüz rutin öğretilmedi. Atölye’den ilk özel komutunuzu hazırlayabilirsiniz.','center-empty'));
  el('centerPlans').replaceChildren();for(const plan of c.recentPlans){const b=element('button',undefined,'routine-shortcut');b.append(element('strong',plan.title),element('small',plan.plan_day+' · Plan '+plan.id));b.addEventListener('click',()=>execute({command:'Plan '+plan.id+' oku'}));el('centerPlans').append(b);}if(!c.recentPlans.length)el('centerPlans').append(element('p','Onayladığınız planlar burada görünecek.','center-empty'));
  el('centerStatus').textContent='Kayıtlar yenilendi. Bu özet için metin modeli çağrılmadı.';el('centerListen').disabled=false;
 }
 async function loadCenter(force=false){
  if(loading)return;if(!force&&snapshot&&Date.now()-captured<30000){el('centerStatus').textContent='Son 30 saniye içinde alınan görünüm. Güncel kayıtlar için Yenile’ye dokunun.';return;}
  loading=true;const version=++requestVersion;el('centerRefresh').disabled=true;el('centerStatus').textContent='Ortak kayıtlarınıza bakıyorum…';
  try{const d=await api('center',{});if(version===requestVersion)renderSnapshot(d);}catch(e){if(version===requestVersion)el('centerStatus').textContent=e.message;}finally{if(version===requestVersion){loading=false;el('centerRefresh').disabled=false;}}
 }
 function openCenter(){if(busy||actionBusy)return;endConversation();if(!loggedIn){showLogin();return;}el('centerDialog').showModal();loadCenter();}
 window.handleExperience=data=>{if(!data.center)return false;renderSnapshot(data);if(data.openCenter){endConversation();el('centerDialog').showModal();speak(data.text);return true;}return false;};
 window.clearExperience=()=>{requestVersion++;loading=false;snapshot=null;captured=0;for(const id of ['centerDialog','customDialog','toolsDialog'])el(id).close();for(const id of ['centerCounts','centerPriorities','centerRoutines','centerPlans'])el(id).replaceChildren();el('centerSearch').value='';el('centerDate').textContent='Ortak kayıtların';el('centerStatus').textContent='';el('centerListen').disabled=true;el('centerRefresh').disabled=false;};
 function openCustom(){if(busy||actionBusy)return;endConversation();el('toolsDialog').close();el('customDialog').showModal();}
 for(const id of ['voiceCenter','textCenter'])el(id).addEventListener('click',openCenter);
 for(const id of ['voiceCustomize','textCustomize'])el(id).addEventListener('click',openCustom);
 el('centerClose').addEventListener('click',closeCenter);el('centerDialog').addEventListener('cancel',e=>{e.preventDefault();closeCenter();});el('centerRefresh').addEventListener('click',()=>loadCenter(true));el('centerListen').addEventListener('click',()=>{if(snapshot){endConversation();speak(snapshot.text);}});el('centerSearch').addEventListener('input',()=>renderActions(el('centerSearch').value));
 el('voiceTools').addEventListener('click',()=>{if(busy||actionBusy)return;endConversation();el('toolsDialog').showModal();});el('toolsClose').addEventListener('click',()=>el('toolsDialog').close());
 for(const button of el('toolsDialog').querySelectorAll('button[data-tool-close]'))button.addEventListener('click',()=>el('toolsDialog').close());
 el('customClose').addEventListener('click',()=>el('customDialog').close());
 el('centerDismiss').addEventListener('click',closeCenter);el('customDismiss').addEventListener('click',()=>el('customDialog').close());el('toolsDismiss').addEventListener('click',()=>el('toolsDialog').close());
 for(const [id,key] of [['personalPalette','palette'],['personalStyle','responseStyle'],['personalFocus','focus'],['personalSpeech','speechLength'],['personalDensity','density']])el(id).addEventListener('change',()=>{prefs=validate({...prefs,[key]:key==='speechLength'?Number(el(id).value):el(id).value});store();});
 el('personalReset').addEventListener('click',()=>{prefs=validate(defaults);store();});
 function connection(){const offline=window.navigator?.onLine===false;el('offlineRibbon').hidden=!offline;if(offline)endConversation('İnternet bağlantısı kesildi. Tekrar bağlandığınızda devam edebilirsiniz.');}
 window.addEventListener('offline',connection);window.addEventListener('online',connection);window.addEventListener('pagehide',()=>{snapshot=null;captured=0;requestVersion++;});
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!document.querySelector('dialog[open]')){e.preventDefault();openCenter();el('centerSearch').focus();}});
 apply();connection();
})();

