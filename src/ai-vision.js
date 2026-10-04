let remover=null;

export async function removeImageBackground(blob,progressCallback){
  const { pipeline } = await import('@huggingface/transformers');
  if(!remover){
    remover=await pipeline('background-removal','onnx-community/modnet-webnn',{
      dtype:'fp32',
      progress_callback:(x)=>progressCallback?.(x)
    });
  }
  const url=URL.createObjectURL(blob);
  try{
    const output=await remover(url);
    if(!output?.[0])throw new Error('Arka plan modeli sonuç üretmedi');
    if(typeof output[0].toBlob==='function')return await output[0].toBlob();
    if(typeof output[0].toCanvas==='function'){
      const canvas=output[0].toCanvas();
      return await new Promise(r=>canvas.toBlob(r,'image/png'));
    }
    throw new Error('Arka plan sonucu dönüştürülemedi');
  }finally{URL.revokeObjectURL(url)}
}
