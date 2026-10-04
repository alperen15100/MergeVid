import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve('dist');
const base='/MergeVid/';
const tools=[
  ['merge-video-online','merge','Merge Video Online','Combine multiple videos into one MP4 directly in your browser.'],
  ['video-birlestirme','merge','Video Birleştirme','Videoları ücretsiz birleştir; dosyalar cihazında kalsın.'],
  ['trim-video-online','trim','Trim Video Online','Cut the beginning or end of a video locally in your browser.'],
  ['video-kirpma','trim','Video Kırpma','Videonun başlangıç ve bitişini tarayıcıda kırp.'],
  ['compress-video-online','compress','Compress Video Online','Reduce video file size without uploading it.'],
  ['video-sikistirma','compress','Video Sıkıştırma','Video boyutunu cihazında küçült.'],
  ['convert-video-to-mp4','convert','Convert Video to MP4','Convert MOV, WebM and MKV to MP4 locally.'],
  ['mov-to-mp4','convert','MOV to MP4','Convert MOV files to MP4 in your browser.'],
  ['webm-to-mp4','convert','WebM to MP4','Convert WebM files to MP4 without uploading.'],
  ['mkv-to-mp4','convert','MKV to MP4','Convert MKV video to MP4 locally.'],
  ['crop-video-online','crop','Crop Video Online','Resize or crop video for social media.'],
  ['resize-video','crop','Resize Video','Resize video to 16:9, 9:16, 1:1 or 4:5.'],
  ['video-to-gif','gif','Video to GIF','Create an animated GIF from a video.'],
  ['video-to-mp3','audio','Video to MP3','Extract MP3 audio from a video in your browser.'],
  ['extract-frame-from-video','frame','Extract Frame from Video','Save a video frame as a JPG image.'],
  ['rotate-video','transform','Rotate Video','Rotate video 90, 180 or 270 degrees.'],
  ['flip-video','transform','Flip Video','Flip a video horizontally or vertically.'],
  ['change-video-speed','transform','Change Video Speed','Speed up or slow down a video.'],
  ['auto-captions-video','captions','Auto Captions for Video','Generate local AI captions with Whisper in your browser.']
];

const devices=[
  ['iphone','on iPhone'],
  ['android','on Android'],
  ['windows','on Windows'],
  ['mac','on Mac']
];

function esc(s){return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function page(slug,tool,title,desc){
  const url='https://alperen15100.github.io/MergeVid/'+slug+'/';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>'+esc(title)+' | MergeVid</title><meta name="description" content="'+esc(desc)+'">'+
  '<link rel="canonical" href="'+url+'"><meta name="robots" content="index,follow">'+
  '<style>body{font-family:system-ui;background:#08090d;color:#f6f7fb;margin:0;padding:40px}main{max-width:760px;margin:auto}.b{display:inline-block;padding:14px 18px;border-radius:12px;background:#8dff70;color:#071007;text-decoration:none;font-weight:800}p{color:#a6adbb;line-height:1.7}h1{font-size:46px;letter-spacing:-.04em}</style></head><body><main>'+
  '<p>MergeVid · Private browser video tools</p><h1>'+esc(title)+'</h1><p>'+esc(desc)+' Files stay on your device and are processed locally in your browser.</p>'+
  '<a class="b" href="'+base+'?tool='+encodeURIComponent(tool)+'">Open '+esc(title)+'</a>'+
  '<p>No signup · No forced watermark · Works on phone and desktop.</p></main></body></html>';
}

for(const [slug,tool,title,desc] of tools){
  const dir=path.join(root,slug);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'index.html'),page(slug,tool,title,desc));
  for(const [d,label] of devices){
    const ds=slug+'-'+d;const dd=path.join(root,ds);fs.mkdirSync(dd,{recursive:true});
    fs.writeFileSync(path.join(dd,'index.html'),page(ds,tool,title+' '+label,desc+' Optimized for '+label+'.'));
  }
}

const formats=['mp4','mov','webm','mkv','avi'];
for(const a of formats){
  for(const b of formats){
    if(a===b) continue;
    const slug='convert-'+a+'-to-'+b;
    const dir=path.join(root,slug);fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'index.html'),page(slug,'convert','Convert '+a.toUpperCase()+' to '+b.toUpperCase(),'Convert '+a.toUpperCase()+' files for easier playback and sharing.'));
  }
}

const urls=[];
for(const entry of fs.readdirSync(root,{withFileTypes:true})){
  if(entry.isDirectory() && fs.existsSync(path.join(root,entry.name,'index.html'))) urls.push('https://alperen15100.github.io/MergeVid/'+entry.name+'/');
}
urls.unshift('https://alperen15100.github.io/MergeVid/');
const sitemap='<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(u=>'<url><loc>'+u+'</loc></url>').join('')+'</urlset>';
fs.writeFileSync(path.join(root,'sitemap.xml'),sitemap);
fs.writeFileSync(path.join(root,'robots.txt'),'User-agent: *\nAllow: /\nSitemap: https://alperen15100.github.io/MergeVid/sitemap.xml\n');
console.log('Generated',urls.length,'SEO pages');
