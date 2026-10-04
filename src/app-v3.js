import './style.css';
import { readMediaMeta, analyzeFile, mergeProject, runSingleTool, extractFrame, extractAudioSamples } from './media.js';
import { transcribeAudio, resultToSrt } from './ai.js';
import {
  waveformDataURL, splitClipAt, saveProject, listProjects, loadProject, deleteProject,
  keywordSuggestions, autoShortsFromSrt, cleanAudio, normalizeAudio, reverseVideo, freezeEnd,
  applyLook, greenScreen, detectAndRemoveSilence, composeTwoVideos, thumbnailFromVideo,
  speakText, reduceVocals, privacyRegion, removeRanges, kenBurns
} from './advanced.js';
import { removeImageBackground } from './ai-vision.js';

const app=document.querySelector('#app');
const $=(s)=>document.querySelector(s);
const $$=(s)=>[...document.querySelectorAll(s)];

const TOOLS=[
  ['merge','Birleştir','Merge'],['trim','Kırp','Trim'],['compress','Sıkıştır','Compress'],
  ['convert','MP4 Dönüştür','Convert'],['crop','Crop / Resize','Crop / Resize'],
  ['gif','Video → GIF','Video → GIF'],['audio','Video → MP3','Video → MP3'],
  ['frame','Kare Çıkar','Extract Frame'],['transform','Döndür / Hız','Rotate / Speed'],
  ['captions','AI Altyazı','AI Captions'],['advanced','Advanced Lab','Advanced Lab'],
  ['batch','Toplu İşlem','Batch'],['thumbnail','Thumbnail','Thumbnail'],['projects','Projeler / Brand','Projects / Brand']
];

const defaults={
  lang:'tr',tool:'merge',ratio:'original',resolution:'720',fitMode:'fit',crf:25,
  transition:'none',transitionDuration:.45,smartMerge:true,musicVolume:.25,musicFade:1,musicDucking:true,
  watermarkPosition:'br',watermarkWidth:18,watermarkOpacity:.9
};
let settings={...defaults,...safeJson(localStorage.getItem('mergevid-settings'),{})};
let clips=[],singleFile=null,secondFile=null,musicFile=null,watermarkFile=null;
let overlays=[],selectedClipId=null,captionSrt='',captionResult=null;
let resultBlob=null,resultUrl=null,resultExt='mp4',busy=false,progress=0,stageText='';
let deferredInstall=null,history=[],redoStack=[],projectRows=[],batchFiles=[],batchResults=[];
let brand=safeJson(localStorage.getItem('mergevid-brand'),{name:'MergeVid',color:'#8dff70',font:'system-ui'});
let advAction='clean',previewUrl=null;

const qTool=new URLSearchParams(location.search).get('tool');
if(TOOLS.some(t=>t[0]===qTool))settings.tool=qTool;

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;render()});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

function safeJson(v,f){try{return JSON.parse(v)||f}catch{return f}}
function t(tr,en){return settings.lang==='tr'?tr:en}
function saveSettings(){localStorage.setItem('mergevid-settings',JSON.stringify(settings))}
function saveBrand(){localStorage.setItem('mergevid-brand',JSON.stringify(brand))}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function fmtTime(sec){sec=Math.max(0,Math.round(Number(sec)||0));const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h?h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'):m+':'+String(s).padStart(2,'0')}
function fmtBytes(n){n=Number(n)||0;return n<1048576?(n/1024).toFixed(0)+' KB':(n/1048576).toFixed(n>104857600?0:1)+' MB'}
function clipDuration(c){const raw=c.kind==='image'?Number(c.imageDuration||3):Math.max(.1,Number(c.trimEnd??c.duration)-Number(c.trimStart||0));return raw/Math.max(.5,Math.min(2,Number(c.speed||1)))}
function totalDuration(){let s=clips.reduce((a,c)=>a+clipDuration(c),0);if(settings.transition!=='none'&&clips.length>1)s-=Number(settings.transitionDuration||.45)*(clips.length-1);return Math.max(0,s)}
function estimate(){const mbps=Number(settings.crf)<=22?7:Number(settings.crf)>=30?1.8:3.6;return totalDuration()*mbps*125000}
function setStage(s,p){if(s)stageText=s;if(Number.isFinite(p))progress=Math.max(0,Math.min(100,p));updateProgress()}
function onProgress(p){progress=Math.round((Number(p)||0)*100);updateProgress()}
function updateProgress(){const w=$('#progressWrap');if(!w)return;w.classList.toggle('show',busy||progress>0);$('#progressBar')&&( $('#progressBar').style.width=progress+'%');$('#progressPct')&&($('#progressPct').textContent=progress+'%');$('#progressText')&&($('#progressText').textContent=stageText||t('Hazırlanıyor…','Preparing…'))}
function clearResult(){if(resultUrl)URL.revokeObjectURL(resultUrl);resultUrl=null;resultBlob=null;resultExt='mp4';progress=0;stageText=''}
function setResult(blob,ext='mp4'){clearResult();resultBlob=blob;resultExt=ext;resultUrl=URL.createObjectURL(blob);progress=100;stageText=t('Tamamlandı','Done');render()}
function setTool(tool){settings.tool=tool;saveSettings();clearResult();const u=new URL(location.href);u.searchParams.set('tool',tool);history.replaceState({},'',u);render()}
function clipUrl(c){if(!c)return'';if(c.previewUrl)return c.previewUrl;c.previewUrl=URL.createObjectURL(c.file);return c.previewUrl}
function snapshot(){
  history.push(clips.map(c=>({...c,file:c.file,previewUrl:c.previewUrl})));if(history.length>30)history.shift();redoStack=[];
}
function undo(){if(!history.length)return;redoStack.push(clips.map(c=>({...c})));clips=history.pop();render()}
function redo(){if(!redoStack.length)return;history.push(clips.map(c=>({...c})));clips=redoStack.pop();render()}

function header(){
  return '<header class="topbar"><button class="brand plain" id="homeBtn"><span class="brandmark">▶</span><span>MergeVid</span></button>'+
  '<nav class="topnav"><button class="ghost" id="undoBtn" '+(!history.length?'disabled':'')+'>↶</button><button class="ghost" id="redoBtn" '+(!redoStack.length?'disabled':'')+'>↷</button>'+
  '<span class="privacy-pill">🔒 '+t('Dosyalar cihazında','Files stay on device')+'</span><button class="ghost" id="langBtn">'+(settings.lang==='tr'?'EN':'TR')+'</button>'+
  '<button class="ghost" id="installBtn">'+(deferredInstall?'⬇ '+t('Yükle','Install'):'PWA')+'</button></nav></header>';
}
function nav(){return '<div class="toolnav">'+TOOLS.map(([id,tr,en])=>'<button class="tooltab '+(settings.tool===id?'active':'')+'" data-tool="'+id+'">'+(settings.lang==='tr'?tr:en)+'</button>').join('')+'</div>'}
function hero(){
  return '<section class="hero compact"><div class="eyebrow">'+t('LOCAL VIDEO STUDIO · NO SIGNUP · NO FORCED WATERMARK','LOCAL VIDEO STUDIO · NO SIGNUP · NO FORCED WATERMARK')+'</div>'+
  '<h1>'+t('Tarayıcıda <span class="gradient">video stüdyosu.</span>','A <span class="gradient">video studio</span> in your browser.')+'</h1>'+
  '<p>'+t('Timeline, AI altyazı, split, efekt, ses, thumbnail, batch ve daha fazlası.','Timeline, AI captions, split, effects, audio, thumbnail, batch and more.')+'</p></section>';
}
function uploader(multiple=false,accept='video/*,image/*,.mkv,.mov,.m4v,.avi'){
  return '<div class="drop" id="drop"><div><div class="drop-icon">＋</div><h2>'+t('Dosya ekle','Add file')+'</h2><p>'+t('Galeriden seç veya sürükle-bırak.','Choose from gallery or drag & drop.')+'</p>'+
  '<div class="btnrow"><button class="primary" id="pickBtn">'+t('Dosya seç','Choose file')+'</button><button class="secondary" id="cameraBtn">📷 '+t('Kamera','Camera')+'</button></div>'+
  '<input id="fileInput" type="file" accept="'+accept+'" '+(multiple?'multiple':'')+' hidden><input id="cameraInput" type="file" accept="video/*" capture="environment" hidden></div></div>';
}
function select(id,label,opts,val=settings[id]){return '<label class="setting">'+label+'<select id="'+id+'">'+opts.map(([v,n])=>'<option value="'+v+'" '+(String(v)===String(val)?'selected':'')+'>'+n+'</option>').join('')+'</select></label>'}
function progressHtml(){return '<div id="progressWrap" class="progress-wrap '+(busy||progress>0?'show':'')+'"><div class="progress-top"><span id="progressText">'+esc(stageText||t('Hazırlanıyor…','Preparing…'))+'</span><span id="progressPct">'+progress+'%</span></div><div class="progress"><div id="progressBar" style="width:'+progress+'%"></div></div></div>'}
function resultHtml(){
  if(!resultBlob||!resultUrl)return '';
  let pv='';if(resultExt==='mp4')pv='<video src="'+resultUrl+'" controls playsinline></video>';else if(['gif','jpg','png'].includes(resultExt))pv='<img src="'+resultUrl+'" alt="output">';else if(resultExt==='mp3')pv='<audio src="'+resultUrl+'" controls></audio>';
  return '<div class="result show">'+pv+'<div class="btnrow"><button class="primary" id="downloadBtn">'+t('İndir','Download')+'</button><button class="secondary" id="shareBtn">↗ '+t('Paylaş','Share')+'</button></div></div>';
}
function templateButtons(){
  return '<div class="presetRow">'+[
    ['reels','9:16','1080','Reels'],['shorts','9:16','1080','Shorts'],['youtube','16:9','1080','YouTube'],['podcast','16:9','1080','Podcast'],['ad','4:5','1080','Product Ad']
  ].map(([id,r,res,n])=>'<button class="secondary preset" data-ratio="'+r+'" data-res="'+res+'">'+n+'</button>').join('')+'</div>';
}
function preview(){
  const c=clips.find(x=>x.id===selectedClipId)||clips[0];if(!c)return '<div class="previewStage emptyPreview">'+t('Bir klip seçince önizleme burada görünür.','Select a clip to preview it here.')+'</div>';
  selectedClipId=c.id;
  const media=c.kind==='image'?'<img src="'+clipUrl(c)+'" alt="">':'<video src="'+clipUrl(c)+'" controls playsinline></video>';
  const textPreview=(overlays.find(o=>o.kind==='text')?.text)||'';
  return '<div class="previewStage">'+media+'<div class="safeZone"></div>'+(textPreview?'<div class="liveText">'+esc(textPreview)+'</div>':'')+'</div>';
}
function timeline(){
  if(!clips.length)return '<div class="emptyHint">'+t('Timeline boş.','Timeline is empty.')+'</div>';
  return '<div class="timeline">'+clips.map((c,i)=>'<article class="clip '+(selectedClipId===c.id?'selected':'')+'" draggable="true" data-id="'+c.id+'">'+
    '<div class="cliptop"><span class="handle">⋮⋮</span>'+(c.thumb?'<img src="'+c.thumb+'" alt="">':'<div class="thumbph">🎞️</div>')+
    '<div class="clipname"><b>'+esc(c.file.name)+'</b><span>'+fmtTime(clipDuration(c))+' · '+c.width+'×'+c.height+' · '+fmtBytes(c.file.size)+'</span>'+
    (c.codec?'<span>'+esc(c.codec)+(c.fps?' · '+esc(c.fps)+' fps':'')+'</span>':'')+'</div><button class="iconbtn danger remove" data-id="'+c.id+'">×</button></div>'+
    (c.waveform?'<img class="waveform" src="'+c.waveform+'" alt="waveform">':'')+
    '<div class="clipcontrols">'+
      (c.kind==='video'?'<label>'+t('Başlangıç','Start')+'<input class="trimStart" data-id="'+c.id+'" type="number" min="0" max="'+c.duration+'" step=".1" value="'+Number(c.trimStart||0).toFixed(1)+'"></label>'+
      '<label>'+t('Bitiş','End')+'<input class="trimEnd" data-id="'+c.id+'" type="number" min=".1" max="'+c.duration+'" step=".1" value="'+Number(c.trimEnd??c.duration).toFixed(1)+'"></label>':
      '<label>'+t('Foto süre','Photo duration')+'<input class="imageDuration" data-id="'+c.id+'" type="number" min=".5" max="30" step=".5" value="'+Number(c.imageDuration||3)+'"></label>')+
      '<label>'+t('Ses','Volume')+'<input class="volume" data-id="'+c.id+'" type="number" min="0" max="2" step=".1" value="'+Number(c.volume??1)+'"></label>'+
      '<label>'+t('Hız','Speed')+'<select class="speed" data-id="'+c.id+'">'+[.5,.75,1,1.25,1.5,2].map(v=>'<option '+(Number(c.speed||1)===v?'selected':'')+'>'+v+'</option>').join('')+'</select></label>'+
      '<label>'+t('Döndür','Rotate')+'<select class="rotation" data-id="'+c.id+'">'+[0,90,180,270].map(v=>'<option '+(Number(c.rotation||0)===v?'selected':'')+'>'+v+'</option>').join('')+'</select></label>'+
      '<label>'+t('Flip','Flip')+'<select class="flip" data-id="'+c.id+'"><option value="none">'+t('Yok','None')+'</option><option value="h" '+(c.flip==='h'?'selected':'')+'>'+t('Yatay','Horizontal')+'</option><option value="v" '+(c.flip==='v'?'selected':'')+'>'+t('Dikey','Vertical')+'</option></select></label>'+
      '<label class="check"><input class="mute" data-id="'+c.id+'" type="checkbox" '+(c.mute?'checked':'')+'> '+t('Sessiz','Mute')+'</label>'+
    '</div><div class="btnrow clipActions">'+
      '<button class="secondary selectClip" data-id="'+c.id+'">▶ '+t('Önizle','Preview')+'</button>'+
      (c.kind==='video'?'<button class="secondary splitClip" data-id="'+c.id+'">✂ '+t('Ortadan böl','Split middle')+'</button><button class="secondary waveformBtn" data-id="'+c.id+'">〰 '+t('Waveform','Waveform')+'</button>':'')+
    '</div></article>').join('')+'</div>';
}
function mergeStudio(){
  return '<section class="workspace"><div class="maincol"><div class="card">'+uploader(true)+'</div><div class="card editorPreview">'+preview()+'</div>'+
  '<div class="sectionHead"><div><span class="kicker">TIMELINE</span><h2>'+t('Klipleri düzenle','Edit clips')+'</h2></div><div class="btnrow"><button class="secondary" id="titleCardBtn">T＋ '+t('Başlık kartı','Title card')+'</button><button class="secondary" id="scanBtn">⌁ Metadata</button></div></div>'+
  timeline()+'</div><aside class="card controls"><h3>'+t('Proje ayarları','Project settings')+'</h3>'+templateButtons()+
  select('ratio',t('Oran','Aspect ratio'),[['original',t('Orijinal','Original')],['16:9','16:9'],['9:16','9:16'],['1:1','1:1'],['4:5','4:5']])+
  select('resolution',t('Çözünürlük','Resolution'),[['480','480p'],['720','720p'],['1080','1080p'],['2160','4K / 2160p'],['original',t('Orijinal','Original')]])+
  select('fitMode',t('Kadraj','Frame'),[['fit','Fit'],['fill','Fill']])+select('crf',t('Kalite','Quality'),[['31',t('Küçük','Small')],['27',t('Hızlı','Fast')],['25',t('Dengeli','Balanced')],['21',t('Yüksek','High')]])+
  select('transition',t('Geçiş','Transition'),[['none',t('Yok','None')],['fade','Fade'],['dissolve','Dissolve'],['wipeleft','Wipe'],['slideleft','Slide'],['circleopen','Circle']])+
  '<label class="setting">'+t('Geçiş süresi','Transition duration')+'<input id="transitionDuration" type="range" min=".15" max="1.5" step=".05" value="'+settings.transitionDuration+'"><span>'+settings.transitionDuration+'s</span></label>'+
  '<label class="check big"><input id="smartMerge" type="checkbox" '+(settings.smartMerge?'checked':'')+'> '+t('Smart fast merge','Smart fast merge')+'</label>'+
  '<div class="divider"></div><h4>'+t('Metin / Sticker','Text / Sticker')+'</h4><input id="overlayText" placeholder="'+t('Videoya yazı…','Text on video…')+'"><div class="grid2"><input id="overlayStart" type="number" min="0" step=".1" value="0"><input id="overlayEnd" type="number" min=".1" step=".1" value="'+Math.max(1,totalDuration()).toFixed(1)+'"></div>'+
  '<div class="grid2"><input id="overlayColor" type="color" value="'+(brand.color||'#ffffff')+'">'+selectInline('overlayPosition',[['bottom',t('Alt','Bottom')],['center',t('Orta','Center')],['top',t('Üst','Top')]])+'</div><button class="secondary wide" id="addTextOverlay">T＋ '+t('Metin katmanı ekle','Add text layer')+'</button>'+
  '<label class="setting">'+t('Sticker / görsel','Sticker / image')+'<input id="stickerInput" type="file" accept="image/*"></label>'+
  '<div class="divider"></div><label class="setting">'+t('Arka plan müziği','Background music')+'<input id="musicInput" type="file" accept="audio/*"></label>'+
  '<label class="check big"><input id="musicDucking" type="checkbox" '+(settings.musicDucking?'checked':'')+'> '+t('Konuşmada müziği otomatik kıs','Auto duck music under speech')+'</label>'+
  '<label class="setting">'+t('Müzik seviyesi','Music volume')+'<input id="musicVolume" type="range" min="0" max="1" step=".05" value="'+settings.musicVolume+'"></label>'+
  '<label class="setting">'+t('Logo / watermark','Logo / watermark')+'<input id="watermarkInput" type="file" accept="image/*"></label>'+
  select('watermarkPosition',t('Watermark konumu','Watermark position'),[['br',t('Sağ alt','Bottom right')],['bl',t('Sol alt','Bottom left')],['tr',t('Sağ üst','Top right')],['tl',t('Sol üst','Top left')],['center',t('Orta','Center')]])+
  '<label class="setting">'+t('Watermark boyutu','Watermark size')+'<input id="watermarkWidth" type="range" min="5" max="50" step="1" value="'+settings.watermarkWidth+'"></label>'+
  '<label class="setting">'+t('Watermark opaklığı','Watermark opacity')+'<input id="watermarkOpacity" type="range" min=".1" max="1" step=".05" value="'+settings.watermarkOpacity+'"></label>'+
  '<div class="estimate"><span>'+t('Tahmini çıktı','Estimated output')+'</span><b>'+fmtBytes(estimate())+'</b></div><button class="primary wide" id="mergeBtn" '+(!clips.length||busy?'disabled':'')+'>'+t('Dışa aktar','Export')+'</button>'+progressHtml()+resultHtml()+'</aside></section>';
}
function selectInline(id,opts){return '<select id="'+id+'">'+opts.map(([v,n])=>'<option value="'+v+'">'+n+'</option>').join('')+'</select>'}

function singleTool(){
  const map={trim:['Video kırp','Trim video'],compress:['Video sıkıştır','Compress video'],convert:['MP4 dönüştür','Convert to MP4'],crop:['Crop / Resize','Crop / Resize'],gif:['Video → GIF','Video → GIF'],audio:['Video → MP3','Video → MP3'],frame:['Kare çıkar','Extract frame'],transform:['Döndür / Flip / Hız','Rotate / Flip / Speed']};
  const title=map[settings.tool]?.[settings.lang==='tr'?0:1]||'Tool';let opts='';
  if(settings.tool==='trim')opts='<div class="grid2"><label class="setting">'+t('Başlangıç','Start')+'<input id="singleStart" type="number" value="0" step=".1"></label><label class="setting">'+t('Bitiş','End')+'<input id="singleEnd" type="number" value="'+Number(singleFile?.duration||10).toFixed(1)+'" step=".1"></label></div>';
  if(settings.tool==='compress')opts=select('singleCrf',t('Sıkıştırma','Compression'),[['35',t('Çok küçük','Very small')],['31',t('Küçük','Small')],['28',t('Dengeli','Balanced')],['24',t('Kaliteli','Quality')]],31);
  if(settings.tool==='crop')opts=select('singleRatio',t('Oran','Ratio'),[['16:9','16:9'],['9:16','9:16'],['1:1','1:1'],['4:5','4:5']],'9:16')+select('singleFit',t('Kadraj','Frame'),[['fit','Fit'],['fill','Fill']],'fit');
  if(settings.tool==='frame')opts='<label class="setting">'+t('Saniye','Time')+'<input id="frameTime" type="number" value=".5" step=".1"></label>';
  if(settings.tool==='transform')opts='<div class="grid2"><label class="setting">'+t('Döndür','Rotate')+'<select id="singleRotation"><option>0</option><option>90</option><option>180</option><option>270</option></select></label><label class="setting">Flip<select id="singleFlip"><option value="none">'+t('Yok','None')+'</option><option value="h">'+t('Yatay','Horizontal')+'</option><option value="v">'+t('Dikey','Vertical')+'</option></select></label><label class="setting">'+t('Hız','Speed')+'<select id="singleSpeed"><option>.5</option><option>.75</option><option selected>1</option><option>1.25</option><option>1.5</option><option>2</option></select></label></div>';
  return '<section class="singleWrap"><div class="card"><span class="kicker">'+settings.tool.toUpperCase()+'</span><h2>'+title+'</h2>'+uploader(false)+selectedSingle()+opts+'<button class="primary wide" id="singleRun" '+(!singleFile||busy?'disabled':'')+'>'+t('İşlemi başlat','Run tool')+'</button>'+progressHtml()+resultHtml()+'</div></section>';
}
function selectedSingle(){return singleFile?'<div class="selectedFile"><b>'+esc(singleFile.file.name)+'</b><span>'+fmtTime(singleFile.duration)+' · '+singleFile.width+'×'+singleFile.height+' · '+fmtBytes(singleFile.file.size)+'</span></div>':''}

function parseSrt(srt){
  return String(srt||'').trim().split(/\n\s*\n/).map((b,i)=>{const l=b.split('\n');const ti=l.find(x=>x.includes('-->'));if(!ti)return null;const [a,z]=ti.split('-->').map(x=>x.trim());const ps=v=>{const m=v.match(/(\d+):(\d+):(\d+)[,.](\d+)/);return m?+m[1]*3600 + +m[2]*60 + +m[3] + +m[4]/1000:0};return {i,start:ps(a),end:ps(z),text:l.filter(x=>!/^\d+$/.test(x.trim())&&!x.includes('-->')).join(' ').trim()}}).filter(Boolean)
}
function captionsTool(){
  const blocks=parseSrt(captionSrt);
  return '<section class="singleWrap wideWrap"><div class="card"><span class="kicker">WHISPER · LOCAL AI</span><h2>'+t('AI Altyazı + Transcript Edit','AI Captions + Transcript Edit')+'</h2>'+
  uploader(false)+selectedSingle()+'<label class="setting">'+t('Dil','Language')+'<select id="captionLang"><option value="tr">Türkçe</option><option value="en">English</option></select></label>'+
  '<div class="btnrow"><button class="primary" id="captionRun" '+(!singleFile||busy?'disabled':'')+'>'+t('Altyazı oluştur','Generate captions')+'</button><button class="secondary" id="ttsBtn">🔊 '+t('Metni seslendir','Speak text')+'</button></div>'+progressHtml()+
  (captionSrt?'<div class="captionResult"><textarea id="captionText">'+esc(captionSrt)+'</textarea><div class="btnrow"><button class="secondary" id="downloadSrt">SRT '+t('indir','download')+'</button><button class="secondary" id="burnCaptions">'+t('Altyazıyı videoya göm','Burn captions')+'</button><button class="secondary" id="brollBtn">B-roll '+t('öner','suggest')+'</button><button class="secondary" id="shortsBtn">Auto Shorts</button></div>'+
  '<div id="captionBlocks">'+blocks.map(b=>'<label class="transcriptLine"><input type="checkbox" class="removeSentence" data-start="'+b.start+'" data-end="'+b.end+'"><span>'+fmtTime(b.start)+' — '+esc(b.text)+'</span></label>').join('')+'</div>'+
  '<button class="primary wide" id="applyTranscriptCuts">'+t('İşaretli cümleleri videodan sil','Remove selected sentences from video')+'</button><div id="aiSuggestions"></div></div>':'')+
  resultHtml()+'</div></section>';
}
function advancedTool(){
  const actions=[
    ['clean',t('Clean Audio','Clean Audio')],['normalize',t('Ses normalize','Normalize audio')],['silence',t('Sessizlikleri kes','Remove silence')],
    ['reverse',t('Videoyu ters çevir','Reverse video')],['freeze',t('Freeze frame','Freeze frame')],['look',t('Filtre / renk / blur','Filters / blur')],
    ['green',t('Green screen','Green screen')],['compose',t('PiP / Split-screen','PiP / Split-screen')],['privacy',t('Blur / Mosaic alanı','Blur / Mosaic region')],
    ['vocals',t('Vokal azalt','Reduce vocals')],['kenburns','Ken Burns'],['bgremove',t('AI arka plan kaldır (Beta)','AI background remove (Beta)')]
  ];
  let extras='';
  if(advAction==='freeze')extras='<label class="setting">'+t('Freeze saniye','Freeze seconds')+'<input id="freezeSeconds" type="number" value="2" min=".2" max="10" step=".2"></label>';
  if(advAction==='look')extras='<div class="grid2"><label class="setting">Brightness<input id="lookB" type="number" min="-1" max="1" step=".05" value="0"></label><label class="setting">Contrast<input id="lookC" type="number" min="0" max="3" step=".1" value="1"></label><label class="setting">Saturation<input id="lookS" type="number" min="0" max="3" step=".1" value="1"></label><label class="setting">Sharpen<input id="lookSharp" type="number" min="0" max="2" step=".1" value=".4"></label></div><label class="check"><input id="lookBlur" type="checkbox"> Blur</label><label class="check"><input id="lookPixel" type="checkbox"> Pixelate</label>';
  if(advAction==='compose')extras='<label class="setting">'+t('İkinci video','Second video')+'<input id="secondInput" type="file" accept="video/*"></label>'+select('composeMode',t('Düzen','Layout'),[['pip','Picture-in-Picture'],['side',t('Yan yana','Side by side')],['stack',t('Alt alta','Stacked')]],'pip');
  if(advAction==='privacy')extras='<div class="grid2"><input id="prX" type="number" value="100" placeholder="X"><input id="prY" type="number" value="100" placeholder="Y"><input id="prW" type="number" value="300" placeholder="W"><input id="prH" type="number" value="180" placeholder="H"></div>'+select('privacyMode',t('Efekt','Effect'),[['blur','Blur'],['pixelate','Mosaic']],'blur');
  return '<section class="singleWrap"><div class="card"><span class="kicker">ADVANCED LAB</span><h2>'+t('Gelişmiş araçlar','Advanced tools')+'</h2>'+uploader(false)+selectedSingle()+
  select('advAction',t('İşlem','Action'),actions,advAction)+extras+'<button class="primary wide" id="advRun" '+(!singleFile||busy?'disabled':'')+'>'+t('Çalıştır','Run')+'</button>'+progressHtml()+resultHtml()+'</div></section>';
}
function batchTool(){
  return '<section class="singleWrap wideWrap"><div class="card"><span class="kicker">BATCH</span><h2>'+t('Toplu dönüştür / sıkıştır','Batch convert / compress')+'</h2>'+
  '<input id="batchInput" type="file" accept="video/*,.mkv,.mov,.webm,.avi" multiple>'+select('batchMode',t('İşlem','Action'),[['convert','MP4'],['compress',t('Sıkıştır','Compress')]],'convert')+
  '<button class="primary wide" id="batchRun" '+(!batchFiles.length||busy?'disabled':'')+'>'+t('Tümünü işle','Process all')+'</button>'+progressHtml()+
  '<div class="batchList">'+batchFiles.map((f,i)=>'<div class="selectedFile"><b>'+esc(f.name)+'</b><span>'+fmtBytes(f.size)+'</span></div>').join('')+batchResults.map((r,i)=>'<button class="secondary batchDownload" data-i="'+i+'">'+esc(r.name)+' ↓</button>').join('')+'</div></div></section>';
}
function thumbnailTool(){
  return '<section class="singleWrap"><div class="card"><span class="kicker">THUMBNAIL MAKER</span><h2>'+t('YouTube / sosyal medya thumbnail','YouTube / social thumbnail')+'</h2>'+uploader(false)+selectedSingle()+
  '<div class="grid2"><label class="setting">'+t('Saniye','Time')+'<input id="thumbTime" type="number" value=".5" step=".1"></label><label class="setting">'+t('Yazı rengi','Text color')+'<input id="thumbColor" type="color" value="'+brand.color+'"></label></div>'+
  '<label class="setting">'+t('Başlık','Title')+'<input id="thumbText" value=""></label><button class="primary wide" id="thumbRun" '+(!singleFile||busy?'disabled':'')+'>'+t('Thumbnail oluştur','Create thumbnail')+'</button>'+progressHtml()+resultHtml()+'</div></section>';
}
function projectsTool(){
  return '<section class="singleWrap wideWrap"><div class="card"><span class="kicker">PROJECTS · BRAND KIT</span><h2>'+t('Projeler ve marka kiti','Projects and brand kit')+'</h2>'+
  '<div class="grid2"><label class="setting">'+t('Marka adı','Brand name')+'<input id="brandName" value="'+esc(brand.name)+'"></label><label class="setting">'+t('Marka rengi','Brand color')+'<input id="brandColor" type="color" value="'+brand.color+'"></label></div>'+
  '<label class="setting">'+t('Font','Font')+'<select id="brandFont"><option value="system-ui">System</option><option value="serif">Serif</option><option value="monospace">Mono</option></select></label><button class="secondary" id="saveBrand">'+t('Brand Kit kaydet','Save Brand Kit')+'</button>'+
  '<div class="divider"></div><div class="btnrow"><button class="primary" id="saveProjectBtn">'+t('Mevcut projeyi kaydet','Save current project')+'</button><button class="secondary" id="refreshProjects">'+t('Listeyi yenile','Refresh list')+'</button></div>'+
  '<div class="projectList">'+projectRows.map(p=>'<div class="projectRow"><div><b>'+esc(p.name)+'</b><span>'+new Date(p.createdAt).toLocaleString()+'</span></div><div class="btnrow"><button class="secondary loadProject" data-id="'+p.id+'">'+t('Aç','Open')+'</button><button class="iconbtn danger deleteProject" data-id="'+p.id+'">×</button></div></div>').join('')+'</div></div></section>';
}
function features(){return '<section class="features"><div class="feature"><b>🔒 '+t('Yerel','Local')+'</b><span>'+t('Dosyalar cihazında kalır.','Files stay on device.')+'</span></div><div class="feature"><b>✂ Timeline</b><span>Split · waveform · undo/redo</span></div><div class="feature"><b>🤖 AI</b><span>Captions · background beta · shorts</span></div><div class="feature"><b>📱 PWA</b><span>'+t('Telefon uyumlu.','Mobile friendly.')+'</span></div></section>'}

function bodyByTool(){if(settings.tool==='merge')return mergeStudio();if(settings.tool==='captions')return captionsTool();if(settings.tool==='advanced')return advancedTool();if(settings.tool==='batch')return batchTool();if(settings.tool==='thumbnail')return thumbnailTool();if(settings.tool==='projects')return projectsTool();return singleTool()}
function render(){app.innerHTML='<div class="shell">'+header()+nav()+hero()+bodyByTool()+features()+'<footer>MergeVid V3 · '+t('Tarayıcı tabanlı video stüdyosu','Browser-native video studio')+'</footer></div>';bind();updateProgress()}

function bind(){
  $('#homeBtn')?.addEventListener('click',()=>setTool('merge'));$('#undoBtn')?.addEventListener('click',undo);$('#redoBtn')?.addEventListener('click',redo);
  $('#langBtn')?.addEventListener('click',()=>{settings.lang=settings.lang==='tr'?'en':'tr';saveSettings();render()});
  $('#installBtn')?.addEventListener('click',async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;render()}});
  $$('.tooltab').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));bindResult();
  if(!['batch','projects'].includes(settings.tool))bindUploader();
  if(settings.tool==='merge')bindMerge();else if(settings.tool==='captions')bindCaptions();else if(settings.tool==='advanced')bindAdvanced();else if(settings.tool==='batch')bindBatch();else if(settings.tool==='thumbnail')bindThumbnail();else if(settings.tool==='projects')bindProjects();else bindSingle();
}
function bindUploader(){
  const input=$('#fileInput'),cam=$('#cameraInput'),drop=$('#drop');$('#pickBtn')?.addEventListener('click',()=>input.click());$('#cameraBtn')?.addEventListener('click',()=>cam.click());
  input?.addEventListener('change',e=>handleFiles([...e.target.files]));cam?.addEventListener('change',e=>handleFiles([...e.target.files]));
  drop?.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag')});drop?.addEventListener('dragleave',()=>drop.classList.remove('drag'));drop?.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag');handleFiles([...e.dataTransfer.files])});
}
async function handleFiles(files){
  const accepted=files.filter(f=>f.type.startsWith('video/')||f.type.startsWith('image/')||/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name));
  if(settings.tool==='merge'){snapshot();for(const file of accepted){try{const m=await readMediaMeta(file);const c={id:crypto.randomUUID(),file,...m,trimStart:0,trimEnd:m.duration,imageDuration:3,volume:1,mute:false,speed:1,rotation:0,flip:'none'};c.previewUrl=URL.createObjectURL(file);clips.push(c);selectedClipId=c.id}catch(e){alert(e.message)}}}
  else{const file=accepted.find(f=>f.type.startsWith('video/')||/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name));if(file)try{singleFile={file,...await readMediaMeta(file)}}catch(e){alert(e.message)}}
  clearResult();render();
}
function bindMerge(){
  ['ratio','resolution','fitMode','crf','transition','watermarkPosition'].forEach(id=>$('#'+id)?.addEventListener('change',e=>{settings[id]=e.target.value;saveSettings();render()}));
  $('#transitionDuration')?.addEventListener('input',e=>{settings.transitionDuration=Number(e.target.value);saveSettings()});$('#smartMerge')?.addEventListener('change',e=>{settings.smartMerge=e.target.checked;saveSettings()});
  $('#musicDucking')?.addEventListener('change',e=>{settings.musicDucking=e.target.checked;saveSettings()});$('#musicVolume')?.addEventListener('input',e=>{settings.musicVolume=Number(e.target.value);saveSettings()});
  $('#musicInput')?.addEventListener('change',e=>musicFile=e.target.files[0]||null);$('#watermarkInput')?.addEventListener('change',e=>{watermarkFile=e.target.files[0]||null;render()});
  $('#watermarkWidth')?.addEventListener('input',e=>{settings.watermarkWidth=Number(e.target.value);saveSettings()});$('#watermarkOpacity')?.addEventListener('input',e=>{settings.watermarkOpacity=Number(e.target.value);saveSettings()});
  $$('.preset').forEach(b=>b.onclick=()=>{settings.ratio=b.dataset.ratio;settings.resolution=b.dataset.res;saveSettings();render()});
  $('#scanBtn')?.addEventListener('click',scanMetadata);$('#titleCardBtn')?.addEventListener('click',addTitleCard);$('#mergeBtn')?.addEventListener('click',runMerge);$('#addTextOverlay')?.addEventListener('click',addTextOverlay);$('#stickerInput')?.addEventListener('change',addSticker);
  $$('.remove').forEach(b=>b.onclick=()=>{snapshot();clips=clips.filter(c=>c.id!==b.dataset.id);if(selectedClipId===b.dataset.id)selectedClipId=clips[0]?.id||null;render()});
  $$('.selectClip').forEach(b=>b.onclick=()=>{selectedClipId=b.dataset.id;render()});$$('.splitClip').forEach(b=>b.onclick=()=>splitMid(b.dataset.id));$$('.waveformBtn').forEach(b=>b.onclick=()=>makeWave(b.dataset.id));
  bindClipInputs();bindDrag();
}
function bindClipInputs(){
  const set=(el,key,cv=x=>x)=>el.addEventListener('change',()=>{const c=clips.find(x=>x.id===el.dataset.id);if(c){snapshot();c[key]=cv(el.type==='checkbox'?el.checked:el.value);render()}});
  $$('.trimStart').forEach(x=>set(x,'trimStart',Number));$$('.trimEnd').forEach(x=>set(x,'trimEnd',Number));$$('.imageDuration').forEach(x=>set(x,'imageDuration',Number));$$('.volume').forEach(x=>set(x,'volume',Number));$$('.speed').forEach(x=>set(x,'speed',Number));$$('.rotation').forEach(x=>set(x,'rotation',Number));$$('.flip').forEach(x=>set(x,'flip',String));$$('.mute').forEach(x=>set(x,'mute',Boolean));
}
function bindDrag(){let d=null;$$('.clip').forEach(el=>{el.addEventListener('dragstart',()=>d=el.dataset.id);el.addEventListener('dragover',e=>e.preventDefault());el.addEventListener('drop',e=>{e.preventDefault();const t=el.dataset.id;if(!d||d===t)return;snapshot();const a=clips.findIndex(c=>c.id===d),b=clips.findIndex(c=>c.id===t);const [m]=clips.splice(a,1);clips.splice(b,0,m);render()})})}
function splitMid(id){const i=clips.findIndex(c=>c.id===id),c=clips[i];if(!c||c.kind!=='video')return;snapshot();const at=(Number(c.trimStart||0)+Number(c.trimEnd??c.duration))/2;const parts=splitClipAt(c,at);parts.forEach(p=>p.previewUrl=c.previewUrl);clips.splice(i,1,...parts);selectedClipId=parts[0].id;render()}
async function makeWave(id){const c=clips.find(x=>x.id===id);if(!c)return;busy=true;setStage(t('Waveform oluşturuluyor…','Building waveform…'),10);render();c.waveform=await waveformDataURL(c.file);busy=false;render()}
async function scanMetadata(){busy=true;render();try{for(let i=0;i<clips.length;i++){if(clips[i].kind==='video'){setStage('Metadata '+(i+1)+'/'+clips.length,Math.round(i/clips.length*100));Object.assign(clips[i],await analyzeFile(clips[i].file,onProgress))}}}catch(e){alert(e.message)}busy=false;render()}
async function addTitleCard(){const text=prompt(t('Başlık metni','Title text'));if(!text)return;const file=await textOverlayFile(text,'center',brand.color,1280,720,true);const m=await readMediaMeta(file);snapshot();clips.push({id:crypto.randomUUID(),file,...m,imageDuration:2.5,volume:1,mute:false,speed:1,rotation:0,flip:'none'});render()}
async function textOverlayFile(text,pos,color,w=1280,h=720,solid=false){
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');if(solid){g.fillStyle='#0b0d12';g.fillRect(0,0,w,h)}else g.clearRect(0,0,w,h);
  g.font='900 72px '+brand.font;g.textAlign='center';g.textBaseline='middle';g.lineWidth=10;g.strokeStyle='rgba(0,0,0,.72)';g.fillStyle=color||'#fff';const y=pos==='top'?110:pos==='bottom'?h-110:h/2;g.strokeText(text,w/2,y,w*.88);g.fillText(text,w/2,y,w*.88);
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));return new File([blob],'overlay.png',{type:'image/png'});
}
async function addTextOverlay(){const text=$('#overlayText')?.value.trim();if(!text)return;const start=Number($('#overlayStart')?.value||0),end=Number($('#overlayEnd')?.value||totalDuration()),position=$('#overlayPosition')?.value||'bottom',color=$('#overlayColor')?.value||brand.color;const file=await textOverlayFile(text,position,color);overlays.push({kind:'text',text,file,start,end,position:'center',opacity:1});render()}
function addSticker(e){const f=e.target.files[0];if(f)overlays.push({kind:'sticker',file:f,start:0,end:totalDuration(),position:'br',opacity:1})}
async function runMerge(){if(!clips.length||busy)return;busy=true;clearResult();render();try{const out=await mergeProject(clips,{...settings,musicFile,watermarkFile,overlays},onProgress,s=>setStage(s,progress));busy=false;setResult(out.blob,'mp4')}catch(e){console.error(e);busy=false;alert(e.message);render()}}

function bindSingle(){$('#singleRun')?.addEventListener('click',runSingle)}
async function runSingle(){if(!singleFile||busy)return;busy=true;clearResult();render();try{if(settings.tool==='frame'){const b=await extractFrame(singleFile.file,Number($('#frameTime')?.value||.5));busy=false;setResult(b,'jpg');return}const opts={crf:Number($('#singleCrf')?.value||27),start:Number($('#singleStart')?.value||0),end:Number($('#singleEnd')?.value||singleFile.duration),duration:singleFile.duration,ratio:$('#singleRatio')?.value||'16:9',resolution:'720',fitMode:$('#singleFit')?.value||'fit',width:singleFile.width,height:singleFile.height,rotation:Number($('#singleRotation')?.value||0),flip:$('#singleFlip')?.value||'none',speed:Number($('#singleSpeed')?.value||1)};const out=await runSingleTool(singleFile.file,settings.tool,opts,onProgress,s=>setStage(s,progress));busy=false;setResult(out.blob,out.extension)}catch(e){busy=false;alert(e.message);render()}}

function bindCaptions(){
  $('#captionRun')?.addEventListener('click',runCaptions);$('#downloadSrt')?.addEventListener('click',()=>downloadBlob(new Blob([$('#captionText')?.value||captionSrt],{type:'text/plain'}),'mergevid-captions.srt'));
  $('#burnCaptions')?.addEventListener('click',burnCaptions);$('#brollBtn')?.addEventListener('click',showBroll);$('#shortsBtn')?.addEventListener('click',showShorts);$('#applyTranscriptCuts')?.addEventListener('click',applyTranscriptCuts);$('#ttsBtn')?.addEventListener('click',()=>speakText(captionSrt||t('Önce altyazı oluştur','Generate captions first'),settings.lang==='tr'?'tr-TR':'en-US'));
}
async function runCaptions(){if(!singleFile||busy)return;busy=true;captionSrt='';render();try{const samples=await extractAudioSamples(singleFile.file,onProgress,s=>setStage(s,progress));const lang=$('#captionLang')?.value||'tr';captionResult=await transcribeAudio(samples,lang,x=>{if(x?.progress!=null)setStage(t('AI modeli çalışıyor…','AI model running…'),Math.round(Number(x.progress)||10))});captionSrt=resultToSrt(captionResult);busy=false;progress=100;render()}catch(e){busy=false;alert(e.message);render()}}
async function burnCaptions(){if(!captionSrt)return;const arr=parseSrt($('#captionText')?.value||captionSrt).slice(0,80);const ovs=[];for(const x of arr){ovs.push({kind:'caption',text:x.text,file:await textOverlayFile(x.text,'bottom','#ffffff'),start:x.start,end:x.end,position:'center',opacity:1})}overlays=overlays.filter(o=>o.kind!=='caption').concat(ovs);alert(t('Altyazı katmanları projeye eklendi. Birleştir ekranından dışa aktar.','Caption layers added to project. Export from Merge.'));setTool('merge')}
function showBroll(){const txt=$('#captionText')?.value||captionSrt;const k=keywordSuggestions(txt);$('#aiSuggestions').innerHTML='<div class="suggestBox"><b>B-roll '+t('anahtar kelimeleri','keywords')+':</b><p>'+k.map(x=>'#'+esc(x)).join(' · ')+'</p><small>'+t('Bu sürüm stok medyayı otomatik indirmez; önerilen kelimelere göre kendi B-roll videonu ekleyebilirsin.','This version does not auto-download stock media; add your own B-roll using these suggestions.')+'</small></div>'}
function showShorts(){const s=autoShortsFromSrt($('#captionText')?.value||captionSrt);$('#aiSuggestions').innerHTML='<div class="suggestBox"><b>Auto Shorts</b>'+s.map((x,i)=>'<div class="shortCard"><span>'+fmtTime(x.start)+'–'+fmtTime(x.end)+' · '+esc(x.text)+'</span><button class="secondary shortUse" data-s="'+x.start+'" data-e="'+x.end+'">'+t('Kırp','Trim')+'</button></div>').join('')+'</div>';$$('.shortUse').forEach(b=>b.onclick=async()=>{if(!singleFile)return;busy=true;render();const out=await runSingleTool(singleFile.file,'trim',{start:Number(b.dataset.s),end:Number(b.dataset.e),duration:singleFile.duration,crf:25},onProgress,s=>setStage(s,progress));busy=false;setResult(out.blob,'mp4')})}
async function applyTranscriptCuts(){if(!singleFile)return;const ranges=$$('.removeSentence:checked').map(x=>({start:Number(x.dataset.start),end:Number(x.dataset.end)}));if(!ranges.length)return;busy=true;render();try{const b=await removeRanges(singleFile.file,ranges,onProgress,s=>setStage(s,progress));busy=false;setResult(b,'mp4')}catch(e){busy=false;alert(e.message);render()}}

function bindAdvanced(){
  $('#advAction')?.addEventListener('change',e=>{advAction=e.target.value;render()});$('#secondInput')?.addEventListener('change',e=>secondFile=e.target.files[0]||null);$('#advRun')?.addEventListener('click',runAdvanced)
}
async function runAdvanced(){if(!singleFile||busy)return;busy=true;clearResult();render();try{let b,ext='mp4';
  if(advAction==='clean')b=await cleanAudio(singleFile.file,onProgress,s=>setStage(s,progress));
  else if(advAction==='normalize')b=await normalizeAudio(singleFile.file,onProgress,s=>setStage(s,progress));
  else if(advAction==='silence')b=await detectAndRemoveSilence(singleFile.file,onProgress,s=>setStage(s,progress));
  else if(advAction==='reverse')b=await reverseVideo(singleFile.file,onProgress,s=>setStage(s,progress));
  else if(advAction==='freeze')b=await freezeEnd(singleFile.file,Number($('#freezeSeconds')?.value||2),onProgress,s=>setStage(s,progress));
  else if(advAction==='look')b=await applyLook(singleFile.file,{brightness:Number($('#lookB')?.value||0),contrast:Number($('#lookC')?.value||1),saturation:Number($('#lookS')?.value||1),sharpen:Number($('#lookSharp')?.value||0),blur:$('#lookBlur')?.checked,pixelate:$('#lookPixel')?.checked},onProgress,s=>setStage(s,progress));
  else if(advAction==='green')b=await greenScreen(singleFile.file,'0x00FF00',onProgress,s=>setStage(s,progress));
  else if(advAction==='compose'){if(!secondFile)throw new Error(t('İkinci video seç','Choose a second video'));b=await composeTwoVideos(singleFile.file,secondFile,$('#composeMode')?.value||'pip',onProgress,s=>setStage(s,progress))}
  else if(advAction==='privacy')b=await privacyRegion(singleFile.file,{x:$('#prX')?.value,y:$('#prY')?.value,w:$('#prW')?.value,h:$('#prH')?.value,mode:$('#privacyMode')?.value},onProgress,s=>setStage(s,progress));
  else if(advAction==='vocals')b=await reduceVocals(singleFile.file,onProgress,s=>setStage(s,progress));
  else if(advAction==='kenburns')b=await kenBurns(singleFile.file,onProgress,s=>setStage(s,progress));
  else if(advAction==='bgremove'){const frame=await extractFrame(singleFile.file,.5);b=await removeImageBackground(frame,x=>x?.progress!=null&&setStage(t('AI model indiriliyor…','Downloading AI model…'),Math.round(Number(x.progress)||10)));ext='png'}
  busy=false;setResult(b,ext)
 }catch(e){busy=false;alert(e.message);render()}}
function bindBatch(){$('#batchInput')?.addEventListener('change',e=>{batchFiles=[...e.target.files];batchResults=[];render()});$('#batchRun')?.addEventListener('click',runBatch);$$('.batchDownload').forEach(b=>b.onclick=()=>downloadBlob(batchResults[Number(b.dataset.i)].blob,batchResults[Number(b.dataset.i)].name))}
async function runBatch(){if(!batchFiles.length||busy)return;busy=true;batchResults=[];render();const mode=$('#batchMode')?.value||'convert';try{for(let i=0;i<batchFiles.length;i++){setStage((i+1)+'/'+batchFiles.length,Math.round(i/batchFiles.length*100));const o=await runSingleTool(batchFiles[i],mode,{crf:mode==='compress'?31:27},onProgress,s=>setStage(s,progress));batchResults.push({blob:o.blob,name:batchFiles[i].name.replace(/\.[^.]+$/,mode==='compress'?'-compressed.mp4':'.mp4')})}}catch(e){alert(e.message)}busy=false;progress=100;render()}
function bindThumbnail(){$('#thumbRun')?.addEventListener('click',async()=>{if(!singleFile)return;busy=true;render();try{const b=await thumbnailFromVideo(singleFile.file,Number($('#thumbTime')?.value||.5),$('#thumbText')?.value||'',{color:$('#thumbColor')?.value||brand.color});busy=false;setResult(b,'jpg')}catch(e){busy=false;alert(e.message);render()}})}
async function refreshProjects(){projectRows=await listProjects();render()}
function bindProjects(){
  $('#saveBrand')?.addEventListener('click',()=>{brand.name=$('#brandName')?.value||'MergeVid';brand.color=$('#brandColor')?.value||'#8dff70';brand.font=$('#brandFont')?.value||'system-ui';saveBrand();alert(t('Brand Kit kaydedildi','Brand Kit saved'))});
  $('#saveProjectBtn')?.addEventListener('click',async()=>{if(!clips.length)return alert(t('Önce bir proje oluştur','Create a project first'));const name=prompt(t('Proje adı','Project name'),'MergeVid '+new Date().toLocaleDateString());if(!name)return;await saveProject(name,clips,settings,brand);await refreshProjects()});
  $('#refreshProjects')?.addEventListener('click',refreshProjects);
  $$('.loadProject').forEach(b=>b.onclick=async()=>{const p=await loadProject(b.dataset.id);if(!p)return;clips=p.clips.map(c=>({...c,previewUrl:URL.createObjectURL(c.file)}));settings={...settings,...p.settings};brand=p.brand||brand;selectedClipId=clips[0]?.id||null;setTool('merge')});
  $$('.deleteProject').forEach(b=>b.onclick=async()=>{await deleteProject(b.dataset.id);await refreshProjects()});
}
function bindResult(){$('#downloadBtn')?.addEventListener('click',()=>resultBlob&&downloadBlob(resultBlob,'mergevid-'+settings.tool+'-'+Date.now()+'.'+resultExt));$('#shareBtn')?.addEventListener('click',shareResult)}
function downloadBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),5000)}
async function shareResult(){if(!resultBlob)return;const f=new File([resultBlob],'mergevid-output.'+resultExt,{type:resultBlob.type||'application/octet-stream'});if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[f]}))){try{return await navigator.share({files:[f],title:'MergeVid'})}catch{}}downloadBlob(resultBlob,f.name)}

render();
