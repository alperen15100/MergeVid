import './style.css';
import { readMediaMeta, analyzeFile, mergeProject, runSingleTool, extractFrame, extractAudioSamples } from './media.js';
import { transcribeAudio, resultToSrt } from './ai.js';

const app=document.querySelector('#app');
const $=(s)=>document.querySelector(s);
const $$=(s)=>[...document.querySelectorAll(s)];

const tools=[
  ['merge','Birleştir','Merge'],
  ['trim','Kırp','Trim'],
  ['compress','Sıkıştır','Compress'],
  ['convert','MP4 Dönüştür','Convert'],
  ['crop','Crop / Resize','Crop / Resize'],
  ['gif','Video → GIF','Video → GIF'],
  ['audio','Video → MP3','Video → MP3'],
  ['frame','Kare Çıkar','Extract Frame'],
  ['transform','Döndür / Hız','Rotate / Speed'],
  ['captions','AI Altyazı','AI Captions']
];

const defaults={
  lang:'tr',ratio:'original',resolution:'720',fitMode:'fit',crf:25,
  transition:'none',transitionDuration:0.45,smartMerge:true,
  musicVolume:0.25,musicFade:1,
  watermarkPosition:'br',watermarkWidth:18,watermarkOpacity:0.9
};
let settings={...defaults,...loadSettings()};
let clips=[];
let singleFile=null;
let musicFile=null;
let watermarkFile=null;
let resultBlob=null;
let resultUrl=null;
let resultExt='mp4';
let busy=false;
let deferredInstall=null;
let captionSrt='';
let stageText='';
let progress=0;

const qTool=new URLSearchParams(location.search).get('tool');
if(tools.some(t=>t[0]===qTool)) settings.tool=qTool;
if(!settings.tool) settings.tool='merge';

window.addEventListener('beforeinstallprompt',(e)=>{e.preventDefault();deferredInstall=e;render();});
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

function loadSettings(){
  try{return JSON.parse(localStorage.getItem('mergevid-settings')||'{}')}catch{return{}}
}
function saveSettings(){
  const safe={...settings};
  localStorage.setItem('mergevid-settings',JSON.stringify(safe));
}
function t(tr,en){return settings.lang==='tr'?tr:en;}
function fmtTime(sec){
  sec=Math.max(0,Math.round(Number(sec)||0));
  const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
  return h? h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0') : m+':'+String(s).padStart(2,'0');
}
function fmtBytes(n){
  n=Number(n)||0;
  if(n<1024*1024)return Math.max(0,n/1024).toFixed(0)+' KB';
  return (n/1024/1024).toFixed(n>100*1024*1024?0:1)+' MB';
}
function esc(s){
  return String(s??'').replace(/[&<>'"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function clipDuration(c){
  const raw=c.kind==='image'?Number(c.imageDuration||c.duration||3):Math.max(.1,Number(c.trimEnd??c.duration)-Number(c.trimStart||0));
  return raw/Math.max(.5,Math.min(2,Number(c.speed||1)));
}
function totalDuration(){
  const sum=clips.reduce((a,c)=>a+clipDuration(c),0);
  if(settings.transition!=='none'&&clips.length>1)return Math.max(.1,sum-Number(settings.transitionDuration||.45)*(clips.length-1));
  return sum;
}
function estimatedBytes(){
  const mbps=Number(settings.crf)<=22?7:Number(settings.crf)>=30?1.8:3.6;
  return totalDuration()*mbps*1000000/8;
}
function setStage(text,pct){
  stageText=text||stageText;
  if(Number.isFinite(pct))progress=Math.max(0,Math.min(100,pct));
  updateProgress();
}
function onProgress(p){progress=Math.round(p*100);updateProgress();}
function updateProgress(){
  const box=$('#progressWrap');
  if(!box)return;
  box.classList.toggle('show',busy||progress>0);
  const bar=$('#progressBar');if(bar)bar.style.width=progress+'%';
  const pct=$('#progressPct');if(pct)pct.textContent=progress+'%';
  const txt=$('#progressText');if(txt)txt.textContent=stageText||t('Hazırlanıyor…','Preparing…');
}
function clearResult(){
  if(resultUrl)URL.revokeObjectURL(resultUrl);
  resultUrl=null;resultBlob=null;resultExt='mp4';progress=0;stageText='';
}
function setResult(blob,ext){
  clearResult();
  resultBlob=blob;resultExt=ext||'mp4';resultUrl=URL.createObjectURL(blob);progress=100;stageText=t('Tamamlandı','Done');
  render();
}
function setTool(tool){
  settings.tool=tool;saveSettings();clearResult();
  const u=new URL(location.href);u.searchParams.set('tool',tool);history.replaceState({},'',u);
  render();
}
function header(){
  return '<header class="topbar"><button class="brand plain" id="homeBtn"><span class="brandmark">▶</span><span>MergeVid</span></button>'+
    '<nav class="topnav"><span class="privacy-pill">🔒 '+t('Dosyalar cihazında','Files stay on device')+'</span>'+
    '<button class="ghost" id="langBtn">'+(settings.lang==='tr'?'EN':'TR')+'</button>'+
    '<button class="ghost" id="installBtn">'+(deferredInstall?'⬇ '+t('Yükle','Install'):'PWA')+'</button></nav></header>';
}
function toolNav(){
  return '<div class="toolnav">'+tools.map(([id,tr,en])=>'<button class="tooltab '+(settings.tool===id?'active':'')+'" data-tool="'+id+'">'+(settings.lang==='tr'?tr:en)+'</button>').join('')+'</div>';
}
function hero(){
  return '<section class="hero compact"><div class="eyebrow">'+t('SUNUCUYA YÜKLEME YOK · ÜYE OLMA YOK · ZORUNLU WATERMARK YOK','NO UPLOADS · NO SIGNUP · NO FORCED WATERMARK')+'</div>'+
    '<h1>'+t('Tarayıcıda <span class="gradient">video stüdyosu.</span>','A <span class="gradient">video studio</span> in your browser.')+'</h1>'+
    '<p>'+t('Birleştir, kırp, sıkıştır, dönüştür, sosyal medya boyutlarına getir, GIF/MP3 oluştur ve AI altyazı çıkar.','Merge, trim, compress, convert, resize, create GIF/MP3 and generate AI captions.')+'</p></section>';
}
function uploader(multiple=true){
  return '<div class="drop" id="drop"><div><div class="drop-icon">＋</div><h2>'+t('Video veya görsel ekle','Add video or image')+'</h2>'+
    '<p>'+t('Galeriden seç, sürükle-bırak veya kamerayı aç.','Choose from gallery, drag & drop, or use camera.')+'</p>'+
    '<div class="btnrow"><button class="primary" id="pickBtn">'+t('Dosya seç','Choose files')+'</button><button class="secondary" id="cameraBtn">📷 '+t('Kamera','Camera')+'</button></div>'+
    '<input id="fileInput" type="file" accept="video/*,image/*,.mkv,.mov,.m4v,.avi" '+(multiple?'multiple':'')+' hidden>'+
    '<input id="cameraInput" type="file" accept="video/*" capture="environment" hidden></div></div>';
}
function timeline(){
  if(!clips.length)return '<div class="emptyHint">'+t('Timeline için en az bir dosya ekle.','Add a file to start the timeline.')+'</div>';
  return '<div class="timeline">'+clips.map((c,i)=>'<article class="clip" draggable="true" data-id="'+c.id+'">'+
    '<div class="cliptop"><span class="handle">⋮⋮</span>'+(c.thumb?'<img src="'+c.thumb+'" alt="">':'<div class="thumbph">🎞️</div>')+
    '<div class="clipname"><b>'+esc(c.file.name)+'</b><span>'+fmtTime(clipDuration(c))+' · '+c.width+'×'+c.height+' · '+fmtBytes(c.file.size)+'</span>'+
    (c.codec?'<span>'+esc(c.codec)+(c.audioCodec?' / '+esc(c.audioCodec):'')+(c.fps?' · '+esc(c.fps)+' fps':'')+'</span>':'')+'</div>'+
    '<button class="iconbtn danger remove" data-id="'+c.id+'">×</button></div>'+
    '<div class="clipcontrols">'+
      (c.kind==='video'?'<label>'+t('Başlangıç','Start')+'<input class="num trimStart" data-id="'+c.id+'" type="number" min="0" max="'+c.duration+'" step=".1" value="'+Number(c.trimStart||0).toFixed(1)+'"></label>'+
      '<label>'+t('Bitiş','End')+'<input class="num trimEnd" data-id="'+c.id+'" type="number" min=".1" max="'+c.duration+'" step=".1" value="'+Number(c.trimEnd??c.duration).toFixed(1)+'"></label>':
      '<label>'+t('Foto süre','Photo duration')+'<input class="num imageDuration" data-id="'+c.id+'" type="number" min=".5" max="30" step=".5" value="'+Number(c.imageDuration||3)+'"></label>')+
      '<label>'+t('Ses','Volume')+'<input class="num volume" data-id="'+c.id+'" type="number" min="0" max="2" step=".1" value="'+Number(c.volume??1)+'"></label>'+
      '<label>'+t('Hız','Speed')+'<select class="speed" data-id="'+c.id+'">'+[.5,.75,1,1.25,1.5,2].map(x=>'<option '+(Number(c.speed||1)===x?'selected':'')+' value="'+x+'">'+x+'×</option>').join('')+'</select></label>'+
      '<label>'+t('Döndür','Rotate')+'<select class="rotation" data-id="'+c.id+'">'+[0,90,180,270].map(x=>'<option '+(Number(c.rotation||0)===x?'selected':'')+' value="'+x+'">'+x+'°</option>').join('')+'</select></label>'+
      '<label>'+t('Çevir','Flip')+'<select class="flip" data-id="'+c.id+'"><option value="none">'+t('Yok','None')+'</option><option '+(c.flip==='h'?'selected':'')+' value="h">'+t('Yatay','Horizontal')+'</option><option '+(c.flip==='v'?'selected':'')+' value="v">'+t('Dikey','Vertical')+'</option></select></label>'+
      '<label class="check"><input class="mute" data-id="'+c.id+'" type="checkbox" '+(c.mute?'checked':'')+'> '+t('Sessiz','Mute')+'</label>'+
    '</div></article>').join('')+'</div>';
}
function mergeStudio(){
  return '<section class="workspace"><div class="maincol"><div class="card">'+uploader(true)+'</div>'+
    '<div class="sectionHead"><div><span class="kicker">TIMELINE</span><h2>'+t('Klipleri sürükleyip sırala','Drag clips to reorder')+'</h2></div>'+
    '<div class="btnrow"><button class="secondary" id="titleCardBtn">T＋ '+t('Başlık kartı','Title card')+'</button><button class="secondary" id="scanBtn">⌁ '+t('Metadata tara','Scan metadata')+'</button></div></div>'+timeline()+'</div>'+
    '<aside class="card controls"><h3>'+t('Proje ayarları','Project settings')+'</h3>'+
      selectSetting('ratio',t('Oran','Aspect ratio'),[['original',t('Orijinal','Original')],['16:9','16:9 YouTube'],['9:16','9:16 Reels / TikTok'],['1:1','1:1 Square'],['4:5','4:5 Feed']])+
      selectSetting('resolution',t('Çözünürlük','Resolution'),[['480','480p'],['720','720p'],['1080','1080p'],['original',t('Orijinal','Original')]])+
      selectSetting('fitMode',t('Kadraj','Frame'),[['fit',t('Fit · tamamı görünsün','Fit · show all')],['fill',t('Fill · ekranı doldur','Fill · crop to fill')]])+
      selectSetting('crf',t('Kalite / sıkıştırma','Quality / compression'),[['31',t('Küçük dosya','Small file')],['27',t('Hızlı','Fast')],['25',t('Dengeli','Balanced')],['21',t('Yüksek kalite','High quality')]])+
      selectSetting('transition',t('Geçiş','Transition'),[['none',t('Yok','None')],['fade','Fade'],['dissolve','Dissolve'],['wipeleft','Wipe'],['slideleft','Slide'],['circleopen','Circle']])+
      '<label class="setting">'+t('Geçiş süresi','Transition duration')+'<input id="transitionDuration" type="range" min=".15" max="1.5" step=".05" value="'+settings.transitionDuration+'"><span id="transitionValue">'+settings.transitionDuration+'s</span></label>'+
      '<label class="check big"><input id="smartMerge" type="checkbox" '+(settings.smartMerge?'checked':'')+'> '+t('Akıllı hızlı birleştirme (uygunsa yeniden encode etme)','Smart fast merge (avoid re-encode when possible)')+'</label>'+
      '<div class="divider"></div><label class="setting">'+t('Arka plan müziği','Background music')+'<input id="musicInput" type="file" accept="audio/*"></label>'+
      '<label class="setting">'+t('Müzik seviyesi','Music volume')+'<input id="musicVolume" type="range" min="0" max="1" step=".05" value="'+settings.musicVolume+'"></label>'+
      '<label class="setting">'+t('Müzik fade','Music fade')+'<input id="musicFade" type="range" min="0" max="4" step=".5" value="'+settings.musicFade+'"></label>'+
      '<label class="setting">'+t('Logo / watermark (isteğe bağlı)','Logo / watermark (optional)')+'<input id="watermarkInput" type="file" accept="image/*"></label>'+
      (watermarkFile?'<div class="selectedFile watermarkSelected"><b>✓ '+esc(watermarkFile.name)+'</b><span>'+t('Watermark dışa aktarımda uygulanacak','Watermark will be applied on export')+'</span></div>':'')+
      selectSetting('watermarkPosition',t('Watermark konumu','Watermark position'),[['br',t('Sağ alt','Bottom right')],['bl',t('Sol alt','Bottom left')],['tr',t('Sağ üst','Top right')],['tl',t('Sol üst','Top left')],['center',t('Orta','Center')]])+
      '<label class="setting">'+t('Watermark boyutu','Watermark size')+'<input id="watermarkWidth" type="range" min="5" max="50" step="1" value="'+settings.watermarkWidth+'"><span id="watermarkWidthValue">'+settings.watermarkWidth+'%</span></label>'+
      '<label class="setting">'+t('Watermark opaklığı','Watermark opacity')+'<input id="watermarkOpacity" type="range" min=".1" max="1" step=".05" value="'+settings.watermarkOpacity+'"><span id="watermarkOpacityValue">'+Math.round(settings.watermarkOpacity*100)+'%</span></label>'+
      '<div class="estimate"><span>'+t('Tahmini çıktı','Estimated output')+'</span><b>'+fmtBytes(estimatedBytes())+'</b></div>'+
      '<button class="primary wide" id="mergeBtn" '+(clips.length<1||busy?'disabled':'')+'>'+t('Projeyi dışa aktar','Export project')+'</button>'+
      progressHtml()+resultHtml()+
    '</aside></section>';
}
function selectSetting(id,label,options){
  return '<label class="setting">'+label+'<select id="'+id+'">'+options.map(([v,n])=>'<option value="'+v+'" '+(String(settings[id])===String(v)?'selected':'')+'>'+n+'</option>').join('')+'</select></label>';
}
function singleTool(){
  const map={
    trim:[t('Video kırp','Trim video'),t('Başlangıç ve bitiş saniyesini seç.','Choose start and end seconds.')],
    compress:[t('Video sıkıştır','Compress video'),t('Dosya boyutunu düşür.','Reduce file size.')],
    convert:[t('MP4 dönüştür','Convert to MP4'),t('MOV, WebM, MKV ve diğer formatları MP4 yap.','Convert common formats to MP4.')],
    crop:[t('Crop / Resize','Crop / Resize'),t('Reels, TikTok, YouTube ve feed boyutları.','Resize for Reels, TikTok, YouTube and feeds.')],
    gif:[t('Video → GIF','Video → GIF'),t('Videodan döngülü GIF oluştur.','Create an animated GIF.')],
    audio:[t('Video → MP3','Video → MP3'),t('Videonun sesini MP3 olarak çıkar.','Extract MP3 audio.')],
    frame:[t('Kare çıkar','Extract frame'),t('İstediğin saniyeyi JPG olarak kaydet.','Save a frame as JPG.')],
    transform:[t('Döndür / Flip / Hız','Rotate / Flip / Speed'),t('Tek videoya dönüşüm uygula.','Transform a single video.')]
  };
  const [title,desc]=map[settings.tool]||map.convert;
  let opts='';
  if(settings.tool==='trim')opts='<div class="grid2"><label class="setting">'+t('Başlangıç (sn)','Start (s)')+'<input id="singleStart" type="number" min="0" step=".1" value="0"></label><label class="setting">'+t('Bitiş (sn)','End (s)')+'<input id="singleEnd" type="number" min=".1" step=".1" value="'+Number(singleFile?.duration||10).toFixed(1)+'"></label></div>';
  if(settings.tool==='compress')opts=selectSetting('singleCrf',t('Sıkıştırma','Compression'),[['35',t('Çok küçük','Very small')],['31',t('Küçük','Small')],['28',t('Dengeli','Balanced')],['24',t('Kaliteli','Quality')]]);
  if(settings.tool==='crop')opts=selectSetting('singleRatio',t('Oran','Aspect ratio'),[['16:9','16:9'],['9:16','9:16'],['1:1','1:1'],['4:5','4:5']])+selectSetting('singleFit',t('Kadraj','Frame'),[['fit','Fit'],['fill','Fill']]);
  if(settings.tool==='frame')opts='<label class="setting">'+t('Saniye','Time')+'<input id="frameTime" type="number" min="0" step=".1" value="0.5"></label>';
  if(settings.tool==='transform')opts='<div class="grid2"><label class="setting">'+t('Döndür','Rotate')+'<select id="singleRotation"><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label><label class="setting">'+t('Flip','Flip')+'<select id="singleFlip"><option value="none">'+t('Yok','None')+'</option><option value="h">'+t('Yatay','Horizontal')+'</option><option value="v">'+t('Dikey','Vertical')+'</option></select></label><label class="setting">'+t('Hız','Speed')+'<select id="singleSpeed"><option>.5</option><option>.75</option><option selected>1</option><option>1.25</option><option>1.5</option><option>2</option></select></label></div>';
  return '<section class="singleWrap"><div class="card"><span class="kicker">'+settings.tool.toUpperCase()+'</span><h2>'+title+'</h2><p class="muted">'+desc+'</p>'+uploader(false)+
    (singleFile?'<div class="selectedFile"><b>'+esc(singleFile.file.name)+'</b><span>'+fmtTime(singleFile.duration)+' · '+singleFile.width+'×'+singleFile.height+' · '+fmtBytes(singleFile.file.size)+'</span></div>':'')+
    opts+'<button class="primary wide" id="singleRun" '+(!singleFile||busy?'disabled':'')+'>'+t('İşlemi başlat','Run tool')+'</button>'+progressHtml()+resultHtml()+'</div></section>';
}
function captionsTool(){
  return '<section class="singleWrap"><div class="card"><span class="kicker">WHISPER · LOCAL AI</span><h2>'+t('AI otomatik altyazı','AI auto captions')+'</h2>'+
    '<p class="muted">'+t('Whisper Tiny modeli cihazında çalışır. İlk kullanımda AI modeli indirilir; video sunucuya gönderilmez.','Whisper Tiny runs on your device. The model downloads on first use; your video is not uploaded.')+'</p>'+uploader(false)+
    (singleFile?'<div class="selectedFile"><b>'+esc(singleFile.file.name)+'</b><span>'+fmtTime(singleFile.duration)+' · '+fmtBytes(singleFile.file.size)+'</span></div>':'')+
    '<label class="setting">'+t('Konuşma dili','Speech language')+'<select id="captionLang"><option value="tr">Türkçe</option><option value="en">English</option></select></label>'+
    '<button class="primary wide" id="captionRun" '+(!singleFile||busy?'disabled':'')+'>'+t('AI altyazı oluştur','Generate AI captions')+'</button>'+progressHtml()+
    (captionSrt?'<div class="captionResult"><textarea readonly>'+esc(captionSrt)+'</textarea><button class="secondary wide" id="downloadSrt">SRT '+t('indir','download')+'</button></div>':'')+
    '</div></section>';
}
function progressHtml(){
  return '<div id="progressWrap" class="progress-wrap '+(busy||progress>0?'show':'')+'"><div class="progress-top"><span id="progressText">'+esc(stageText||t('Hazırlanıyor…','Preparing…'))+'</span><span id="progressPct">'+progress+'%</span></div><div class="progress"><div id="progressBar" style="width:'+progress+'%"></div></div></div>';
}
function resultHtml(){
  if(!resultBlob||!resultUrl)return '<div id="resultBox"></div>';
  const preview=resultExt==='mp4'?'<video src="'+resultUrl+'" controls playsinline></video>':resultExt==='gif'||resultExt==='jpg'?'<img src="'+resultUrl+'" alt="output">':resultExt==='mp3'?'<audio src="'+resultUrl+'" controls></audio>':'';
  return '<div class="result show">'+preview+'<div class="btnrow"><button class="primary" id="downloadBtn">'+t('İndir','Download')+'</button><button class="secondary" id="shareBtn">↗ '+t('Paylaş','Share')+'</button></div></div>';
}
function featureStrip(){
  return '<section class="features"><div class="feature"><b>🔒 '+t('Yerel işleme','Local processing')+'</b><span>'+t('Dosyalar sunucuya çıkmaz.','Files never leave your device.')+'</span></div>'+
  '<div class="feature"><b>🚫 '+t('Üyelik yok','No signup')+'</b><span>'+t('Hesap açmadan kullan.','Use it without an account.')+'</span></div>'+
  '<div class="feature"><b>✨ '+t('Watermark yok','No forced watermark')+'</b><span>'+t('Çıktına logo basmayız.','We do not stamp your output.')+'</span></div>'+
  '<div class="feature"><b>📱 PWA</b><span>'+t('Telefona uygulama gibi ekle.','Install like an app.')+'</span></div></section>';
}
function render(){
  app.innerHTML='<div class="shell">'+header()+toolNav()+hero()+
    (settings.tool==='merge'?mergeStudio():settings.tool==='captions'?captionsTool():singleTool())+
    featureStrip()+'<footer>MergeVid V2 · '+t('Tarayıcı içinde çalışan video toolkit.','A browser-native video toolkit.')+'</footer></div>';
  bind();
  updateProgress();
}
function bind(){
  $('#homeBtn')?.addEventListener('click',()=>setTool('merge'));
  $('#langBtn')?.addEventListener('click',()=>{settings.lang=settings.lang==='tr'?'en':'tr';saveSettings();render();});
  $('#installBtn')?.addEventListener('click',async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;render();}});
  $$('.tooltab').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
  bindUploader();
  bindResult();
  if(settings.tool==='merge')bindMerge();
  else if(settings.tool==='captions')bindCaptions();
  else bindSingle();
}
function bindUploader(){
  const pick=$('#pickBtn'),input=$('#fileInput'),camera=$('#cameraBtn'),cameraInput=$('#cameraInput'),drop=$('#drop');
  pick?.addEventListener('click',()=>input.click());
  camera?.addEventListener('click',()=>cameraInput.click());
  input?.addEventListener('change',(e)=>handleFiles([...e.target.files]));
  cameraInput?.addEventListener('change',(e)=>handleFiles([...e.target.files]));
  drop?.addEventListener('dragover',(e)=>{e.preventDefault();drop.classList.add('drag')});
  drop?.addEventListener('dragleave',()=>drop.classList.remove('drag'));
  drop?.addEventListener('drop',(e)=>{e.preventDefault();drop.classList.remove('drag');handleFiles([...e.dataTransfer.files])});
}
async function handleFiles(files){
  const accepted=files.filter(f=>f.type.startsWith('video/')||f.type.startsWith('image/')||/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name));
  if(settings.tool==='merge'){
    for(const file of accepted){
      try{
        const meta=await readMediaMeta(file);
        clips.push({id:crypto.randomUUID(),file,...meta,trimStart:0,trimEnd:meta.duration,imageDuration:3,volume:1,mute:false,speed:1,rotation:0,flip:'none'});
      }catch(e){alert(e.message)}
    }
  }else{
    const file=accepted.find(f=>f.type.startsWith('video/')||/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name));
    if(file){
      try{singleFile={file,...await readMediaMeta(file)}}catch(e){alert(e.message)}
    }
  }
  clearResult();render();
}
function bindMerge(){
  ['ratio','resolution','fitMode','crf','transition','watermarkPosition'].forEach(id=>$('#'+id)?.addEventListener('change',(e)=>{settings[id]=e.target.value;saveSettings();render();}));
  $('#transitionDuration')?.addEventListener('input',(e)=>{settings.transitionDuration=Number(e.target.value);$('#transitionValue').textContent=e.target.value+'s';saveSettings();});
  $('#smartMerge')?.addEventListener('change',(e)=>{settings.smartMerge=e.target.checked;saveSettings();});
  $('#musicVolume')?.addEventListener('input',(e)=>{settings.musicVolume=Number(e.target.value);saveSettings();});
  $('#musicFade')?.addEventListener('input',(e)=>{settings.musicFade=Number(e.target.value);saveSettings();});
  $('#musicInput')?.addEventListener('change',(e)=>{musicFile=e.target.files[0]||null;});
  $('#watermarkInput')?.addEventListener('change',(e)=>{watermarkFile=e.target.files[0]||null;clearResult();render();});
  $('#watermarkWidth')?.addEventListener('input',(e)=>{settings.watermarkWidth=Number(e.target.value);$('#watermarkWidthValue').textContent=e.target.value+'%';saveSettings();});
  $('#watermarkOpacity')?.addEventListener('input',(e)=>{settings.watermarkOpacity=Number(e.target.value);$('#watermarkOpacityValue').textContent=Math.round(Number(e.target.value)*100)+'%';saveSettings();});
  $('#titleCardBtn')?.addEventListener('click',addTitleCard);
  $('#scanBtn')?.addEventListener('click',scanMetadata);
  $('#mergeBtn')?.addEventListener('click',runMerge);
  $$('.remove').forEach(b=>b.onclick=()=>{clips=clips.filter(c=>c.id!==b.dataset.id);clearResult();render();});
  bindClipInputs();
  bindDrag();
}
function bindClipInputs(){
  const update=(el,key,convert=(x)=>x)=>el.addEventListener('change',()=>{const c=clips.find(x=>x.id===el.dataset.id);if(c){c[key]=convert(el.type==='checkbox'?el.checked:el.value);clearResult();render();}});
  $$('.trimStart').forEach(x=>update(x,'trimStart',Number));
  $$('.trimEnd').forEach(x=>update(x,'trimEnd',Number));
  $$('.imageDuration').forEach(x=>update(x,'imageDuration',Number));
  $$('.volume').forEach(x=>update(x,'volume',Number));
  $$('.speed').forEach(x=>update(x,'speed',Number));
  $$('.rotation').forEach(x=>update(x,'rotation',Number));
  $$('.flip').forEach(x=>update(x,'flip',String));
  $$('.mute').forEach(x=>update(x,'mute',Boolean));
}
function bindDrag(){
  let dragging=null;
  $$('.clip').forEach(el=>{
    el.addEventListener('dragstart',()=>{dragging=el.dataset.id;el.classList.add('dragging')});
    el.addEventListener('dragend',()=>el.classList.remove('dragging'));
    el.addEventListener('dragover',(e)=>e.preventDefault());
    el.addEventListener('drop',(e)=>{e.preventDefault();const target=el.dataset.id;if(!dragging||dragging===target)return;const a=clips.findIndex(c=>c.id===dragging),b=clips.findIndex(c=>c.id===target);const [m]=clips.splice(a,1);clips.splice(b,0,m);render();});
  });
}
async function addTitleCard(){
  const text=prompt(t('Başlık metni','Title text'));
  if(!text)return;
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
  const ctx=canvas.getContext('2d');
  const g=ctx.createLinearGradient(0,0,1280,720);g.addColorStop(0,'#0b0d12');g.addColorStop(1,'#17252a');ctx.fillStyle=g;ctx.fillRect(0,0,1280,720);
  ctx.fillStyle='#8dff70';ctx.font='700 76px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
  const words=text.split(' ');let lines=[],line='';
  for(const word of words){const test=(line+' '+word).trim();if(ctx.measureText(test).width>1050&&line){lines.push(line);line=word}else line=test}if(line)lines.push(line);
  lines.slice(0,4).forEach((l,i)=>ctx.fillText(l,640,360+(i-(lines.length-1)/2)*90));
  const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
  const file=new File([blob],'title-card.png',{type:'image/png'});
  const meta=await readMediaMeta(file);
  clips.push({id:crypto.randomUUID(),file,...meta,imageDuration:2.5,volume:1,mute:false,speed:1,rotation:0,flip:'none'});
  render();
}
async function scanMetadata(){
  if(!clips.length)return;
  busy=true;setStage(t('Metadata taranıyor…','Scanning metadata…'),1);render();
  try{
    for(let i=0;i<clips.length;i++){
      if(clips[i].kind!=='video')continue;
      setStage(t('Metadata ','Metadata ')+(i+1)+'/'+clips.length,Math.round(i/clips.length*100));
      const m=await analyzeFile(clips[i].file,onProgress);
      Object.assign(clips[i],m);
    }
    setStage(t('Metadata hazır','Metadata ready'),100);
  }catch(e){alert(e.message)}finally{busy=false;render()}
}
async function runMerge(){
  if(!clips.length||busy)return;
  busy=true;clearResult();setStage(t('Video motoru hazırlanıyor…','Preparing video engine…'),1);render();
  try{
    const out=await mergeProject(clips,{...settings,musicFile,watermarkFile},onProgress,(s)=>setStage(s,progress));
    setResult(out.blob,'mp4');
  }catch(e){console.error(e);alert(t('Hata: ','Error: ')+e.message);busy=false;render();return}
  busy=false;render();
}
function bindSingle(){
  $('#singleRun')?.addEventListener('click',runSingle);
}
async function runSingle(){
  if(!singleFile||busy)return;
  busy=true;clearResult();setStage(t('Hazırlanıyor…','Preparing…'),1);render();
  try{
    if(settings.tool==='frame'){
      const blob=await extractFrame(singleFile.file,Number($('#frameTime')?.value||.5));
      busy=false;setResult(blob,'jpg');return;
    }
    const opts={
      crf:Number($('#singleCrf')?.value||27),
      start:Number($('#singleStart')?.value||0),
      end:Number($('#singleEnd')?.value||singleFile.duration),
      duration:singleFile.duration,
      ratio:$('#singleRatio')?.value||'16:9',
      resolution:'720',
      fitMode:$('#singleFit')?.value||'fit',
      width:singleFile.width,height:singleFile.height,
      rotation:Number($('#singleRotation')?.value||0),
      flip:$('#singleFlip')?.value||'none',
      speed:Number($('#singleSpeed')?.value||1)
    };
    const out=await runSingleTool(singleFile.file,settings.tool,opts,onProgress,(s)=>setStage(s,progress));
    busy=false;setResult(out.blob,out.extension);return;
  }catch(e){console.error(e);alert(t('Hata: ','Error: ')+e.message)}
  busy=false;render();
}
function bindCaptions(){
  $('#captionRun')?.addEventListener('click',runCaptions);
  $('#downloadSrt')?.addEventListener('click',()=>downloadBlob(new Blob([captionSrt],{type:'text/plain'}),'mergevid-captions.srt'));
}
async function runCaptions(){
  if(!singleFile||busy)return;
  busy=true;captionSrt='';setStage(t('Ses hazırlanıyor…','Preparing audio…'),1);render();
  try{
    const samples=await extractAudioSamples(singleFile.file,onProgress,(s)=>setStage(s,progress));
    setStage(t('Whisper AI modeli çalışıyor… İlk sefer uzun sürebilir.','Running Whisper AI… First run may take longer.'),10);
    const lang=$('#captionLang')?.value||'tr';
    const result=await transcribeAudio(samples,lang,(x)=>{
      if(x?.progress!=null)setStage(t('AI modeli indiriliyor / çalışıyor…','Downloading / running AI model…'),Math.round(Number(x.progress)||10));
    });
    captionSrt=resultToSrt(result);progress=100;stageText=t('Altyazı hazır','Captions ready');
  }catch(e){console.error(e);alert(t('AI altyazı hatası: ','AI caption error: ')+e.message)}
  busy=false;render();
}
function bindResult(){
  $('#downloadBtn')?.addEventListener('click',()=>{
    if(!resultBlob)return;
    downloadBlob(resultBlob,'mergevid-'+settings.tool+'-'+new Date().toISOString().slice(0,10)+'.'+resultExt);
  });
  $('#shareBtn')?.addEventListener('click',shareResult);
}
function downloadBlob(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}
async function shareResult(){
  if(!resultBlob)return;
  const file=new File([resultBlob],'mergevid-output.'+resultExt,{type:resultBlob.type||'application/octet-stream'});
  if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){
    try{await navigator.share({title:'MergeVid',files:[file]});return}catch{}
  }
  downloadBlob(resultBlob,file.name);
}

render();
