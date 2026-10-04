import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg = null;
let loaded = false;
let progressHandler = null;
let logHandler = null;

export async function getFFmpeg(onProgress, onLog) {
  progressHandler = onProgress || progressHandler;
  logHandler = onLog || logHandler;
  if (loaded && ffmpeg) return ffmpeg;
  ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress }) => {
    if (progressHandler) progressHandler(Math.max(0, Math.min(1, progress || 0)));
  });
  ffmpeg.on('log', ({ message }) => {
    if (logHandler) logHandler(message || '');
  });
  const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(baseURL + '/ffmpeg-core.js', 'text/javascript'),
    wasmURL: await toBlobURL(baseURL + '/ffmpeg-core.wasm', 'application/wasm')
  });
  loaded = true;
  return ffmpeg;
}

export function readMediaMeta(file) {
  if (file.type.startsWith('image/')) return readImageMeta(file);
  return readVideoMeta(file);
}

function readImageMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        kind: 'image',
        duration: 3,
        width: img.naturalWidth || 1280,
        height: img.naturalHeight || 720,
        thumb: url,
        codec: 'image',
        bitrate: 0
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Görsel okunamadı'));
    };
    img.src = url;
  });
}

function readVideoMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      const finish = (thumb) => {
        URL.revokeObjectURL(url);
        resolve({ kind: 'video', duration, width, height, thumb, codec: '', bitrate: 0 });
      };
      if (!duration) return finish('');
      video.currentTime = Math.min(Math.max(duration * 0.2, 0.1), Math.max(duration - 0.05, 0.1));
      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 180;
          canvas.height = 110;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL('image/jpeg', 0.74));
        } catch {
          finish('');
        }
      };
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Video okunamadı'));
    };
    video.src = url;
  });
}

function safeExt(name, fallback) {
  const ext = (name.split('.').pop() || fallback || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return ext || fallback || 'bin';
}

async function cleanup(names) {
  for (const name of names) {
    try { await ffmpeg.deleteFile(name); } catch {}
  }
}

async function hasAudio(inputName, index) {
  if (!ffmpeg.ffprobe) return true;
  const out = 'probe_' + index + '.json';
  try {
    const code = await ffmpeg.ffprobe(['-v','quiet','-print_format','json','-show_streams',inputName,'-o',out]);
    if (code !== 0) return true;
    const bytes = await ffmpeg.readFile(out);
    const json = JSON.parse(new TextDecoder().decode(bytes));
    return (json.streams || []).some((s) => s.codec_type === 'audio');
  } catch {
    return true;
  } finally {
    await cleanup([out]);
  }
}

export async function analyzeFile(file, onProgress) {
  await getFFmpeg(onProgress);
  const ext = safeExt(file.name, 'mp4');
  const input = 'analyze.' + ext;
  const out = 'analyze.json';
  await ffmpeg.writeFile(input, await fetchFile(file));
  try {
    if (!ffmpeg.ffprobe) return { codec:'', audioCodec:'', bitrate:0, fps:'' };
    await ffmpeg.ffprobe(['-v','quiet','-print_format','json','-show_streams','-show_format',input,'-o',out]);
    const data = JSON.parse(new TextDecoder().decode(await ffmpeg.readFile(out)));
    const video = (data.streams || []).find((s) => s.codec_type === 'video') || {};
    const audio = (data.streams || []).find((s) => s.codec_type === 'audio') || {};
    return {
      codec: video.codec_name || '',
      audioCodec: audio.codec_name || '',
      bitrate: Number(data.format?.bit_rate || video.bit_rate || 0),
      fps: video.avg_frame_rate || '',
      format: data.format?.format_name || ''
    };
  } finally {
    await cleanup([input,out]);
  }
}

function dimsFor(settings, first) {
  const qualityBase = settings.resolution === '1080' ? 1080 : settings.resolution === '480' ? 480 : 720;
  const ratio = settings.ratio || 'original';
  if (ratio === '16:9') return [qualityBase === 1080 ? 1920 : qualityBase === 480 ? 854 : 1280, qualityBase];
  if (ratio === '9:16') return [qualityBase, qualityBase === 1080 ? 1920 : qualityBase === 480 ? 854 : 1280];
  if (ratio === '1:1') return [qualityBase, qualityBase];
  if (ratio === '4:5') return [qualityBase, Math.round(qualityBase * 1.25 / 2) * 2];
  let w = first?.width || 1280;
  let h = first?.height || 720;
  if (settings.resolution !== 'original') {
    const portrait = h > w;
    if (portrait) return [qualityBase, qualityBase === 1080 ? 1920 : qualityBase === 480 ? 854 : 1280];
    return [qualityBase === 1080 ? 1920 : qualityBase === 480 ? 854 : 1280, qualityBase];
  }
  w = Math.max(2, w - (w % 2));
  h = Math.max(2, h - (h % 2));
  return [w,h];
}

function videoFilter(clip, w, h, fitMode) {
  const filters = [];
  if (fitMode === 'fill') {
    filters.push('scale=' + w + ':' + h + ':force_original_aspect_ratio=increase');
    filters.push('crop=' + w + ':' + h);
  } else {
    filters.push('scale=' + w + ':' + h + ':force_original_aspect_ratio=decrease');
    filters.push('pad=' + w + ':' + h + ':(ow-iw)/2:(oh-ih)/2:color=black');
  }
  if (clip.rotation === 90) filters.push('transpose=1');
  if (clip.rotation === 180) filters.push('hflip,vflip');
  if (clip.rotation === 270) filters.push('transpose=2');
  if (clip.flip === 'h') filters.push('hflip');
  if (clip.flip === 'v') filters.push('vflip');
  const speed = Math.max(0.5, Math.min(2, Number(clip.speed || 1)));
  if (speed !== 1) filters.push('setpts=PTS/' + speed);
  filters.push('setsar=1');
  filters.push('fps=30');
  filters.push('format=yuv420p');
  return filters.join(',');
}

function audioFilter(clip) {
  const speed = Math.max(0.5, Math.min(2, Number(clip.speed || 1)));
  const vol = clip.mute ? 0 : Math.max(0, Math.min(2, Number(clip.volume ?? 1)));
  const parts = ['volume=' + vol];
  if (speed !== 1) parts.push('atempo=' + speed);
  parts.push('aresample=48000');
  return parts.join(',');
}

function clipOutputDuration(clip) {
  const raw = clip.kind === 'image'
    ? Number(clip.imageDuration || clip.duration || 3)
    : Math.max(0.1, Number(clip.trimEnd ?? clip.duration) - Number(clip.trimStart || 0));
  return raw / Math.max(0.5, Math.min(2, Number(clip.speed || 1)));
}

function simpleForSmart(clip) {
  if (clip.kind !== 'video') return false;
  const untouchedEnd = Math.abs(Number(clip.trimEnd ?? clip.duration) - Number(clip.duration)) < 0.05;
  return Number(clip.trimStart || 0) < 0.05 && untouchedEnd && !clip.mute &&
    Math.abs(Number(clip.volume ?? 1) - 1) < 0.01 && Number(clip.speed || 1) === 1 &&
    Number(clip.rotation || 0) === 0 && (!clip.flip || clip.flip === 'none');
}

async function trySmartConcat(clips) {
  if (clips.length < 2 || !clips.every(simpleForSmart)) return null;
  const sameDims = clips.every((c) => c.width === clips[0].width && c.height === clips[0].height);
  const sameExt = clips.every((c) => safeExt(c.file.name,'mp4') === safeExt(clips[0].file.name,'mp4'));
  if (!sameDims || !sameExt) return null;
  const written = [];
  try {
    for (let i=0;i<clips.length;i++) {
      const name = 'fast_' + i + '.' + safeExt(clips[i].file.name,'mp4');
      await ffmpeg.writeFile(name, await fetchFile(clips[i].file));
      written.push(name);
    }
    const list = written.map((n) => "file '" + n + "'").join('\n');
    await ffmpeg.writeFile('fast.txt', new TextEncoder().encode(list));
    const code = await ffmpeg.exec(['-f','concat','-safe','0','-i','fast.txt','-c','copy','-movflags','+faststart','fast-output.mp4']);
    if (code !== 0) return null;
    const bytes = await ffmpeg.readFile('fast-output.mp4');
    return new Blob([bytes.buffer], { type:'video/mp4' });
  } catch {
    return null;
  } finally {
    await cleanup([...written,'fast.txt','fast-output.mp4']);
  }
}

export async function mergeProject(clips, settings, onProgress, onStage) {
  await getFFmpeg(onProgress);
  if (settings.smartMerge) {
    onStage?.('Akıllı hızlı birleştirme deneniyor…');
    const fast = await trySmartConcat(clips);
    if (fast) return { blob: fast, duration: clips.reduce((a,c)=>a+clipOutputDuration(c),0), fast:true };
  }

  const [w,h] = dimsFor(settings, clips[0]);
  const crf = String(settings.crf || 25);
  const normalized = [];
  const durations = [];
  const tempInputs = [];

  for (let i=0;i<clips.length;i++) {
    const clip = clips[i];
    onStage?.('Klip ' + (i+1) + '/' + clips.length + ' hazırlanıyor…');
    const ext = safeExt(clip.file.name, clip.kind === 'image' ? 'png' : 'mp4');
    const inputName = 'input_' + i + '.' + ext;
    const outputName = 'norm_' + i + '.mp4';
    tempInputs.push(inputName);
    await ffmpeg.writeFile(inputName, await fetchFile(clip.file));

    const dur = clipOutputDuration(clip);
    durations.push(dur);
    const vf = videoFilter(clip,w,h,settings.fitMode || 'fit');
    let args;

    if (clip.kind === 'image') {
      args = [
        '-loop','1','-i',inputName,
        '-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000',
        '-t',String(dur),
        '-map','0:v:0','-map','1:a:0',
        '-vf',vf,
        '-c:v','libx264','-preset','ultrafast','-crf',crf,
        '-c:a','aac','-b:a','128k','-ar','48000','-ac','2',
        '-shortest','-movflags','+faststart',outputName
      ];
    } else {
      const audio = await hasAudio(inputName,i);
      const start = Math.max(0,Number(clip.trimStart || 0));
      const rawDur = Math.max(0.1, Number(clip.trimEnd ?? clip.duration) - start);
      if (audio) {
        args = [
          '-ss',String(start),'-t',String(rawDur),'-i',inputName,
          '-map','0:v:0','-map','0:a:0',
          '-vf',vf,'-af',audioFilter(clip),
          '-c:v','libx264','-preset','ultrafast','-crf',crf,
          '-c:a','aac','-b:a','128k','-ar','48000','-ac','2',
          '-movflags','+faststart',outputName
        ];
      } else {
        args = [
          '-ss',String(start),'-t',String(rawDur),'-i',inputName,
          '-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000',
          '-map','0:v:0','-map','1:a:0',
          '-vf',vf,'-af',audioFilter(clip),
          '-c:v','libx264','-preset','ultrafast','-crf',crf,
          '-c:a','aac','-b:a','128k','-ar','48000','-ac','2',
          '-shortest','-movflags','+faststart',outputName
        ];
      }
    }

    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error(clip.file.name + ' dönüştürülemedi');
    normalized.push(outputName);
    await cleanup([inputName]);
  }

  let merged = 'merged.mp4';
  const transition = settings.transition || 'none';
  const td = Math.max(0.15, Math.min(1.5, Number(settings.transitionDuration || 0.45)));

  if (transition !== 'none' && normalized.length > 1) {
    onStage?.('Geçiş efektleri uygulanıyor…');
    const args = [];
    normalized.forEach((n) => args.push('-i',n));
    const filters = [];
    let vPrev='0:v';
    let aPrev='0:a';
    let previousDuration=durations[0];
    for (let i=1;i<normalized.length;i++) {
      const vOut='v'+i;
      const aOut='a'+i;
      const offset=Math.max(0.01,previousDuration-td);
      filters.push('['+vPrev+']['+i+':v]xfade=transition='+transition+':duration='+td+':offset='+offset+'['+vOut+']');
      filters.push('['+aPrev+']['+i+':a]acrossfade=d='+td+':c1=tri:c2=tri['+aOut+']');
      vPrev=vOut;
      aPrev=aOut;
      previousDuration=previousDuration+durations[i]-td;
    }
    args.push('-filter_complex',filters.join(';'),'-map','['+vPrev+']','-map','['+aPrev+']',
      '-c:v','libx264','-preset','ultrafast','-crf',crf,'-c:a','aac','-b:a','128k','-movflags','+faststart',merged);
    const code=await ffmpeg.exec(args);
    if (code!==0) throw new Error('Geçiş efekti uygulanamadı');
  } else {
    onStage?.('Klipler birleştiriliyor…');
    const list=normalized.map((n)=>"file '"+n+"'").join('\n');
    await ffmpeg.writeFile('concat.txt',new TextEncoder().encode(list));
    const code=await ffmpeg.exec(['-f','concat','-safe','0','-i','concat.txt','-c','copy','-movflags','+faststart',merged]);
    if (code!==0) throw new Error('Birleştirme başarısız');
  }

  let totalDuration = durations.reduce((a,b)=>a+b,0) - (transition!=='none' ? td*(durations.length-1) : 0);

  if (settings.musicFile) {
    onStage?.('Arka plan müziği ekleniyor…');
    const ext=safeExt(settings.musicFile.name,'mp3');
    const music='music.'+ext;
    await ffmpeg.writeFile(music,await fetchFile(settings.musicFile));
    const mixed='mixed.mp4';
    const vol=Math.max(0,Math.min(2,Number(settings.musicVolume ?? 0.25)));
    const fade=Math.max(0,Math.min(4,Number(settings.musicFade ?? 1)));
    const outStart=Math.max(0,totalDuration-fade);
    const af='[1:a]volume='+vol+',afade=t=in:st=0:d='+fade+',afade=t=out:st='+outStart+':d='+fade+'[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]';
    const code=await ffmpeg.exec(['-i',merged,'-stream_loop','-1','-i',music,'-filter_complex',af,'-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','160k','-t',String(totalDuration),mixed]);
    if (code===0) {
      await cleanup([merged]);
      merged=mixed;
    }
    await cleanup([music]);
  }

  if (settings.watermarkFile) {
    onStage?.('Logo / watermark uygulanıyor…');
    const ext=safeExt(settings.watermarkFile.name,'png');
    const wm='watermark.'+ext;
    await ffmpeg.writeFile(wm,await fetchFile(settings.watermarkFile));
    const watermarked='watermarked.mp4';
    const code=await ffmpeg.exec([
      '-i',merged,'-i',wm,
      '-filter_complex','[1:v]scale=180:-1[wm];[0:v][wm]overlay=W-w-24:H-h-24:format=auto[v]',
      '-map','[v]','-map','0:a?','-c:v','libx264','-preset','ultrafast','-crf',crf,'-c:a','copy','-movflags','+faststart',watermarked
    ]);
    if (code===0) {
      await cleanup([merged]);
      merged=watermarked;
    }
    await cleanup([wm]);
  }

  const bytes=await ffmpeg.readFile(merged);
  const blob=new Blob([bytes.buffer],{type:'video/mp4'});
  await cleanup([...normalized,'concat.txt',merged]);
  return { blob, duration:totalDuration, fast:false, width:w, height:h };
}

export async function runSingleTool(file, tool, options={}, onProgress, onStage) {
  await getFFmpeg(onProgress);
  const ext=safeExt(file.name,'mp4');
  const input='single.'+ext;
  await ffmpeg.writeFile(input,await fetchFile(file));
  const crf=String(options.crf || 27);
  let output='tool-output.mp4';
  let mime='video/mp4';
  let args=[];

  if (tool==='convert') {
    args=['-i',input,'-c:v','libx264','-preset','ultrafast','-crf',crf,'-c:a','aac','-b:a','128k','-movflags','+faststart',output];
  } else if (tool==='trim') {
    const start=Math.max(0,Number(options.start || 0));
    const end=Math.max(start+0.1,Number(options.end || options.duration || start+5));
    args=['-ss',String(start),'-to',String(end),'-i',input,'-c:v','libx264','-preset','ultrafast','-crf',crf,'-c:a','aac','-movflags','+faststart',output];
  } else if (tool==='compress') {
    args=['-i',input,'-c:v','libx264','-preset','ultrafast','-crf',String(options.crf || 31),'-c:a','aac','-b:a','96k','-movflags','+faststart',output];
  } else if (tool==='crop') {
    const fake={width:options.width||1280,height:options.height||720};
    const [w,h]=dimsFor(options,fake);
    const vf=(options.fitMode==='fill'
      ? 'scale='+w+':'+h+':force_original_aspect_ratio=increase,crop='+w+':'+h
      : 'scale='+w+':'+h+':force_original_aspect_ratio=decrease,pad='+w+':'+h+':(ow-iw)/2:(oh-ih)/2:color=black')+',setsar=1';
    args=['-i',input,'-vf',vf,'-c:v','libx264','-preset','ultrafast','-crf',crf,'-c:a','aac','-movflags','+faststart',output];
  } else if (tool==='gif') {
    output='tool-output.gif';
    mime='image/gif';
    args=['-i',input,'-vf','fps=12,scale=640:-1:flags=lanczos','-loop','0',output];
  } else if (tool==='audio') {
    output='tool-output.mp3';
    mime='audio/mpeg';
    args=['-i',input,'-vn','-c:a','libmp3lame','-q:a','2',output];
  } else if (tool==='transform') {
    const vf=[];
    const rot=Number(options.rotation || 0);
    if(rot===90)vf.push('transpose=1');
    if(rot===180)vf.push('hflip,vflip');
    if(rot===270)vf.push('transpose=2');
    if(options.flip==='h')vf.push('hflip');
    if(options.flip==='v')vf.push('vflip');
    const speed=Math.max(0.5,Math.min(2,Number(options.speed||1)));
    if(speed!==1)vf.push('setpts=PTS/'+speed);
    const af=speed!==1?'atempo='+speed:'anull';
    args=['-i',input,'-vf',vf.length?vf.join(','):'null','-af',af,'-c:v','libx264','-preset','ultrafast','-crf',crf,'-c:a','aac','-movflags','+faststart',output];
  } else {
    throw new Error('Bilinmeyen araç');
  }

  onStage?.('İşleniyor…');
  const code=await ffmpeg.exec(args);
  if(code!==0){
    await cleanup([input,output]);
    throw new Error('İşlem tamamlanamadı');
  }
  const bytes=await ffmpeg.readFile(output);
  const blob=new Blob([bytes.buffer],{type:mime});
  await cleanup([input,output]);
  return {blob,mime,extension:output.split('.').pop()};
}

export async function extractFrame(file, time=0.5) {
  const url=URL.createObjectURL(file);
  try {
    const video=document.createElement('video');
    video.muted=true;
    video.playsInline=true;
    video.preload='auto';
    await new Promise((resolve,reject)=>{
      video.onloadedmetadata=resolve;
      video.onerror=reject;
      video.src=url;
    });
    video.currentTime=Math.max(0,Math.min(Number(time||0),Math.max(0,video.duration-0.05)));
    await new Promise((resolve)=>{video.onseeked=resolve;});
    const canvas=document.createElement('canvas');
    canvas.width=video.videoWidth||1280;
    canvas.height=video.videoHeight||720;
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    const blob=await new Promise((resolve)=>canvas.toBlob(resolve,'image/jpeg',0.92));
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function extractAudioSamples(file, onProgress, onStage) {
  await getFFmpeg(onProgress);
  onStage?.('AI için ses hazırlanıyor…');
  const ext=safeExt(file.name,'mp4');
  const input='ai-input.'+ext;
  const wav='ai-audio.wav';
  await ffmpeg.writeFile(input,await fetchFile(file));
  const code=await ffmpeg.exec(['-i',input,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',wav]);
  if(code!==0){
    await cleanup([input,wav]);
    throw new Error('Ses çıkarılamadı');
  }
  const bytes=await ffmpeg.readFile(wav);
  const ab=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  const ctx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});
  const audio=await ctx.decodeAudioData(ab);
  const samples=new Float32Array(audio.getChannelData(0));
  await ctx.close();
  await cleanup([input,wav]);
  return samples;
}
