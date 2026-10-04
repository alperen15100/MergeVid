let transcriber = null;

async function createPipeline(progressCallback) {
  const { pipeline } = await import('@huggingface/transformers');
  const model = 'onnx-community/whisper-tiny';
  const opts = {
    device: navigator.gpu ? 'webgpu' : 'wasm',
    progress_callback: (x) => progressCallback?.(x)
  };
  try {
    return await pipeline('automatic-speech-recognition', model, opts);
  } catch (e) {
    if (opts.device === 'webgpu') {
      return await pipeline('automatic-speech-recognition', model, {
        device: 'wasm',
        progress_callback: (x) => progressCallback?.(x)
      });
    }
    throw e;
  }
}

export async function transcribeAudio(samples, language='tr', progressCallback) {
  if (!transcriber) transcriber = await createPipeline(progressCallback);
  const result = await transcriber(samples, {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
    language: language === 'tr' ? 'turkish' : 'english',
    task: 'transcribe'
  });
  return result;
}

function stamp(sec) {
  const ms=Math.max(0,Math.round((Number(sec)||0)*1000));
  const h=Math.floor(ms/3600000);
  const m=Math.floor((ms%3600000)/60000);
  const s=Math.floor((ms%60000)/1000);
  const x=ms%1000;
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+','+String(x).padStart(3,'0');
}

export function resultToSrt(result) {
  const chunks=result?.chunks || [];
  if (!chunks.length) {
    return '1\n00:00:00,000 --> 00:00:10,000\n'+(result?.text || '').trim()+'\n';
  }
  return chunks.map((c,i)=>{
    const ts=c.timestamp || [0,0];
    const start=Number(ts[0]||0);
    const end=Number(ts[1] ?? start+4);
    return (i+1)+'\n'+stamp(start)+' --> '+stamp(end)+'\n'+String(c.text||'').trim()+'\n';
  }).join('\n');
}
