import { getFFmpeg, extractFrame } from './media.js';
import { fetchFile } from '@ffmpeg/util';

function ext(name,fallback='mp4'){
  const x=(name.split('.').pop()||fallback).replace(/[^a-z0-9]/gi,'').toLowerCase();
  return x||fallback;
}
async function del(ff,names){for(const n of names){try{await ff.deleteFile(n)}catch{}}}

export async function waveformDataURL(file,width=1200,height=160){
  const url=URL.createObjectURL(file);
  try{
    const ab=await file.arrayBuffer();
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const audio=await ctx.decodeAudioData(ab.slice(0));
    const data=audio.getChannelData(0);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const g=canvas.getContext('2d');g.clearRect(0,0,width,height);
    g.fillStyle='#0d1016';g.fillRect(0,0,width,height);
    const step=Math.max(1,Math.floor(data.length/width));
    g.strokeStyle='#8dff70';g.lineWidth=1;g.beginPath();
    for(let x=0;x<width;x++){
      let min=1,max=-1;const start=x*step;
      for(let j=0;j<step&&start+j<data.length;j++){const v=data[start+j];if(v<min)min=v;if(v>max)max=v}
      const y1=(1+min)*height/2,y2=(1+max)*height/2;
      g.moveTo(x,y1);g.lineTo(x,y2);
    }
    g.stroke();await ctx.close();
    return canvas.toDataURL('image/png');
  }catch{
    return '';
  }finally{URL.revokeObjectURL(url)}
}

export function splitClipAt(clip,time){
  const start=Number(clip.trimStart||0),end=Number(clip.trimEnd??clip.duration);
  const at=Math.max(start+.05,Math.min(end-.05,Number(time)));
  if(!(at>start&&at<end))throw new Error('Bölme noktası klibin içinde olmalı');
  const base={...clip};
  return [
    {...base,id:crypto.randomUUID(),trimEnd:at},
    {...base,id:crypto.randomUUID(),trimStart:at}
  ];
}

function dbOpen(){
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open('mergevid-db',1);
    r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('projects'))db.createObjectStore('projects',{keyPath:'id'})};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
export async function saveProject(name,clips,settings,brand={}){
  const db=await dbOpen();const tx=db.transaction('projects','readwrite');
  const serial=clips.map(c=>({...c,thumb:'',file:c.file}));
  const row={id:crypto.randomUUID(),name:name||'MergeVid Project',createdAt:Date.now(),clips:serial,settings,brand};
  tx.objectStore('projects').put(row);
  await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});
  db.close();return row.id;
}
export async function listProjects(){
  const db=await dbOpen();const tx=db.transaction('projects','readonly');const req=tx.objectStore('projects').getAll();
  const rows=await new Promise((res,rej)=>{req.onsuccess=()=>res(req.result||[]);req.onerror=()=>rej(req.error)});
  db.close();return rows.sort((a,b)=>b.createdAt-a.createdAt);
}
export async function loadProject(id){
  const db=await dbOpen();const tx=db.transaction('projects','readonly');const req=tx.objectStore('projects').get(id);
  const row=await new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error)});
  db.close();return row;
}
export async function deleteProject(id){
  const db=await dbOpen();const tx=db.transaction('projects','readwrite');tx.objectStore('projects').delete(id);
  await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});db.close();
}

export function keywordSuggestions(text){
  const stop=new Set('ve veya ile bir bu şu için gibi ama daha çok da de the a an and or to of in on is are video'.split(' '));
  const words=String(text||'').toLocaleLowerCase('tr').match(/[\p{L}\p{N}]{3,}/gu)||[];
  const count={};for(const w of words){if(!stop.has(w))count[w]=(count[w]||0)+1}
  return Object.entries(count).sort((a,b)=>b[1]-a[1]).slice(0,12).map(x=>x[0]);
}

export function autoShortsFromSrt(srt,max=5){
  const blocks=String(srt||'').trim().split(/\n\s*\n/);
  const items=[];
  for(const b of blocks){
    const lines=b.split('\n');const time=lines.find(x=>x.includes('-->'));if(!time)continue;
    const [a,z]=time.split('-->').map(x=>x.trim());
    const parse=(v)=>{const m=v.match(/(\d+):(\d+):(\d+)[,.](\d+)/);return m?+m[1]*3600 + +m[2]*60 + +m[3] + +m[4]/1000:0};
    const text=lines.filter(x=>!/^\d+$/.test(x.trim())&&!x.includes('-->')).join(' ').trim();
    if(text.length<12)continue;
    const score=(/[!?]/.test(text)?3:0)+Math.min(5,text.length/35)+(\b\d+\b/.test(text)?1:0);
    items.push({start:parse(a),end:parse(z),text,score});
  }
  items.sort((a,b)=>b.score-a.score);
  return items.slice(0,max).map(x=>({start:Math.max(0,x.start-1),end:x.end+2,text:x.text}));
}

async function ffBlob(file,args,output,mime,onProgress,onStage,onLog){
  const logs=[];const ff=await getFFmpeg(onProgress,(m)=>{logs.push(m);onLog?.(m)});
  const input='adv.'+ext(file.name);
  await ff.writeFile(input,await fetchFile(file));
  onStage?.('İşleniyor…');
  const code=await ff.exec(args(input,output,logs));
  if(code!==0){await del(ff,[input,output]);throw new Error('İşlem tamamlanamadı')}
  const bytes=await ff.readFile(output);const blob=new Blob([bytes.buffer],{type:mime});
  await del(ff,[input,output]);return blob;
}

export async function cleanAudio(file,onProgress,onStage){
  return ffBlob(file,(i,o)=>['-i',i,'-af','highpass=f=70,lowpass=f=14500,afftdn=nf=-25,loudnorm=I=-16:LRA=11:TP=-1.5','-c:v','copy','-c:a','aac','-b:a','160k',o],'clean.mp4','video/mp4',onProgress,onStage);
}
export async function normalizeAudio(file,onProgress,onStage){
  return ffBlob(file,(i,o)=>['-i',i,'-af','loudnorm=I=-16:LRA=11:TP=-1.5','-c:v','copy','-c:a','aac','-b:a','160k',o],'normalize.mp4','video/mp4',onProgress,onStage);
}
export async function reverseVideo(file,onProgress,onStage){
  return ffBlob(file,(i,o)=>['-i',i,'-vf','reverse','-af','areverse','-c:v','libx264','-preset','ultrafast','-crf','25','-c:a','aac',o],'reverse.mp4','video/mp4',onProgress,onStage);
}
export async function freezeEnd(file,seconds=2,onProgress,onStage){
  const d=Math.max(.2,Math.min(10,Number(seconds)||2));
  return ffBlob(file,(i,o)=>['-i',i,'-vf','tpad=stop_mode=clone:stop_duration='+d,'-af','apad=pad_dur='+d,'-shortest','-c:v','libx264','-preset','ultrafast','-crf','25','-c:a','aac',o],'freeze.mp4','video/mp4',onProgress,onStage);
}
export async function applyLook(file,opts={},onProgress,onStage){
  const b=Number(opts.brightness||0),c=Number(opts.contrast||1),s=Number(opts.saturation||1),sharp=Number(opts.sharpen||0);
  let vf='eq=brightness='+b+':contrast='+c+':saturation='+s;
  if(sharp>0)vf+=',unsharp=5:5:'+Math.min(2,sharp)+':5:5:0';
  if(opts.blur)vf+=',boxblur=6:2';
  if(opts.pixelate)vf+=',scale=iw/12:ih/12:flags=neighbor,scale=iw*12:ih*12:flags=neighbor';
  return ffBlob(file,(i,o)=>['-i',i,'-vf',vf,'-c:v','libx264','-preset','ultrafast','-crf','25','-c:a','copy',o],'look.mp4','video/mp4',onProgress,onStage);
}
export async function greenScreen(file,color='0x00FF00',onProgress,onStage){
  const col=String(color||'0x00FF00');
  return ffBlob(file,(i,o)=>['-i',i,'-filter_complex',
    '[0:v]chromakey='+col+':0.18:0.08[ck];color=c=black:s=1280x720[bg];[bg][ck]overlay=(W-w)/2:(H-h)/2:format=auto[v]',
    '-map','[v]','-map','0:a?','-c:v','libx264','-preset','ultrafast','-crf','25','-c:a','copy',o],'green.mp4','video/mp4',onProgress,onStage);
}

export async function detectAndRemoveSilence(file,onProgress,onStage){
  const logs=[];const ff=await getFFmpeg(onProgress,(m)=>logs.push(m));
  const input='silence.'+ext(file.name);await ff.writeFile(input,await fetchFile(file));
  onStage?.('Sessizlikler analiz ediliyor…');
  await ff.exec(['-i',input,'-af','silencedetect=noise=-42dB:d=0.65','-f','null','-']);
  const starts=[],ends=[];
  for(const l of logs){
    const s=l.match(/silence_start:\s*([\d.]+)/);if(s)starts.push(Number(s[1]));
    const e=l.match(/silence_end:\s*([\d.]+)/);if(e)ends.push(Number(e[1]));
  }
  if(!starts.length){await del(ff,[input]);throw new Error('Uzun sessizlik bulunamadı')}
  const meta=document.createElement('video');const url=URL.createObjectURL(file);
  const duration=await new Promise((res,rej)=>{meta.onloadedmetadata=()=>res(meta.duration);meta.onerror=rej;meta.src=url});
  URL.revokeObjectURL(url);
  const cuts=[];for(let i=0;i<starts.length;i++)cuts.push([starts[i],ends[i]??duration]);
  const keeps=[];let p=0;for(const [a,b] of cuts){if(a-p>.15)keeps.push([p,Math.max(p,a-.12)]);p=Math.min(duration,b+.12)}if(duration-p>.15)keeps.push([p,duration]);
  if(!keeps.length){await del(ff,[input]);throw new Error('Korunacak konuşma bölümü bulunamadı')}
  const filter=[];keeps.forEach(([a,b],i)=>{filter.push('[0:v]trim=start='+a+':end='+b+',setpts=PTS-STARTPTS[v'+i+']');filter.push('[0:a]atrim=start='+a+':end='+b+',asetpts=PTS-STARTPTS[a'+i+']')});
  let concat='';for(let i=0;i<keeps.length;i++)concat+='[v'+i+'][a'+i+']';
  filter.push(concat+'concat=n='+keeps.length+':v=1:a=1[v][a]');
  const output='nosilence.mp4';onStage?.('Sessizlikler kaldırılıyor…');
  const code=await ff.exec(['-i',input,'-filter_complex',filter.join(';'),'-map','[v]','-map','[a]','-c:v','libx264','-preset','ultrafast','-crf','25','-c:a','aac',output]);
  if(code!==0){await del(ff,[input,output]);throw new Error('Sessizlik kaldırma başarısız')}
  const bytes=await ff.readFile(output);const blob=new Blob([bytes.buffer],{type:'video/mp4'});await del(ff,[input,output]);return blob;
}

export async function composeTwoVideos(a,b,mode='pip',onProgress,onStage){
  const ff=await getFFmpeg(onProgress);const ia='a.'+ext(a.name),ib='b.'+ext(b.name),o='compose.mp4';
  await ff.writeFile(ia,await fetchFile(a));await ff.writeFile(ib,await fetchFile(b));onStage?.('Videolar birleştiriliyor…');
  let fc;
  if(mode==='side')fc='[0:v]scale=640:720:force_original_aspect_ratio=decrease,pad=640:720:(ow-iw)/2:(oh-ih)/2[left];[1:v]scale=640:720:force_original_aspect_ratio=decrease,pad=640:720:(ow-iw)/2:(oh-ih)/2[right];[left][right]hstack=2[v]';
  else if(mode==='stack')fc='[0:v]scale=1280:360:force_original_aspect_ratio=decrease,pad=1280:360:(ow-iw)/2:(oh-ih)/2[top];[1:v]scale=1280:360:force_original_aspect_ratio=decrease,pad=1280:360:(ow-iw)/2:(oh-ih)/2[bot];[top][bot]vstack=2[v]';
  else fc='[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[base];[1:v]scale=360:-1[pip];[base][pip]overlay=W-w-28:28[v]';
  const code=await ff.exec(['-i',ia,'-i',ib,'-filter_complex',fc,'-map','[v]','-map','0:a?','-shortest','-c:v','libx264','-preset','ultrafast','-crf','25','-c:a','aac',o]);
  if(code!==0){await del(ff,[ia,ib,o]);throw new Error('Kompozisyon başarısız')}
  const bytes=await ff.readFile(o);const blob=new Blob([bytes.buffer],{type:'video/mp4'});await del(ff,[ia,ib,o]);return blob;
}

export async function thumbnailFromVideo(file,time,text='',opts={}){
  const frame=await extractFrame(file,time);const bmp=await createImageBitmap(frame);
  const c=document.createElement('canvas');c.width=1280;c.height=720;const g=c.getContext('2d');
  g.fillStyle='#000';g.fillRect(0,0,c.width,c.height);
  const sc=Math.max(c.width/bmp.width,c.height/bmp.height);const w=bmp.width*sc,h=bmp.height*sc;
  g.drawImage(bmp,(c.width-w)/2,(c.height-h)/2,w,h);
  if(opts.overlay!==false){const grad=g.createLinearGradient(0,360,0,720);grad.addColorStop(0,'transparent');grad.addColorStop(1,'rgba(0,0,0,.75)');g.fillStyle=grad;g.fillRect(0,0,1280,720)}
  if(text){g.font='900 72px system-ui';g.textAlign='center';g.textBaseline='middle';g.lineWidth=10;g.strokeStyle='rgba(0,0,0,.8)';g.fillStyle=opts.color||'#ffffff';g.strokeText(text,640,570,1120);g.fillText(text,640,570,1120)}
  return new Promise(r=>c.toBlob(r,'image/jpeg',.92));
}

export function speakText(text,lang='tr-TR'){
  if(!('speechSynthesis'in window))throw new Error('Bu tarayıcı seslendirmeyi desteklemiyor');
  speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(String(text||''));u.lang=lang;u.rate=1;speechSynthesis.speak(u);
}


export async function reduceVocals(file,onProgress,onStage){
  return ffBlob(file,(i,o)=>['-i',i,'-af','pan=stereo|c0=c0-c1|c1=c1-c0,loudnorm=I=-16:LRA=11:TP=-1.5','-c:v','copy','-c:a','aac','-b:a','160k',o],'vocal-reduced.mp4','video/mp4',onProgress,onStage);
}

export async function privacyRegion(file,opts={},onProgress,onStage){
  const x=Math.max(0,Number(opts.x||0)),y=Math.max(0,Number(opts.y||0));
  const w=Math.max(20,Number(opts.w||240)),h=Math.max(20,Number(opts.h||160));
  const mode=opts.mode==='pixelate'?'pixel':'blur';
  const vf=mode==='pixel'
    ? '[0:v]split[base][tmp];[tmp]crop='+w+':'+h+':'+x+':'+y+',scale=iw/12:ih/12:flags=neighbor,scale='+w+':'+h+':flags=neighbor[fx];[base][fx]overlay='+x+':'+y
    : '[0:v]split[base][tmp];[tmp]crop='+w+':'+h+':'+x+':'+y+',boxblur=12:2[fx];[base][fx]overlay='+x+':'+y;
  return ffBlob(file,(i,o)=>['-i',i,'-filter_complex',vf,'-c:v','libx264','-preset','ultrafast','-crf','25','-c:a','copy',o],'privacy.mp4','video/mp4',onProgress,onStage);
}

export async function removeRanges(file,ranges,onProgress,onStage){
  const valid=(ranges||[]).filter(r=>Number(r.end)>Number(r.start)).sort((a,b)=>a.start-b.start);
  if(!valid.length)throw new Error('Silinecek metin aralığı seçilmedi');
  const meta=document.createElement('video');const url=URL.createObjectURL(file);
  const duration=await new Promise((res,rej)=>{meta.onloadedmetadata=()=>res(meta.duration);meta.onerror=rej;meta.src=url});
  URL.revokeObjectURL(url);
  const keeps=[];let p=0;
  for(const r of valid){const a=Math.max(0,Number(r.start)),b=Math.min(duration,Number(r.end));if(a-p>.05)keeps.push([p,a]);p=Math.max(p,b)}
  if(duration-p>.05)keeps.push([p,duration]);
  if(!keeps.length)throw new Error('Tüm video silinmiş olur');
  const ff=await getFFmpeg(onProgress);const input='transcript.'+ext(file.name),output='transcript-edit.mp4';
  await ff.writeFile(input,await fetchFile(file));onStage?.('Metne göre video kesiliyor…');
  const filter=[];keeps.forEach(([a,b],i)=>{filter.push('[0:v]trim=start='+a+':end='+b+',setpts=PTS-STARTPTS[v'+i+']');filter.push('[0:a]atrim=start='+a+':end='+b+',asetpts=PTS-STARTPTS[a'+i+']')});
  let seq='';for(let i=0;i<keeps.length;i++)seq+='[v'+i+'][a'+i+']';filter.push(seq+'concat=n='+keeps.length+':v=1:a=1[v][a]');
  const code=await ff.exec(['-i',input,'-filter_complex',filter.join(';'),'-map','[v]','-map','[a]','-c:v','libx264','-preset','ultrafast','-crf','25','-c:a','aac',output]);
  if(code!==0){await del(ff,[input,output]);throw new Error('Metin tabanlı kesme başarısız')}
  const bytes=await ff.readFile(output);const blob=new Blob([bytes.buffer],{type:'video/mp4'});await del(ff,[input,output]);return blob;
}
