import './style.css';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const app = document.querySelector('#app');

app.innerHTML = `
  <div class="shell">
    <header>
      <div class="brand"><div class="brandmark">▶</div>MergeVid</div>
      <div class="badge">%100 cihazında çalışır</div>
    </header>

    <main>
      <section class="hero">
        <h1>Videolarını <span class="gradient">tek dosyada</span> birleştir.</h1>
        <p>MP4, MOV, WebM ve diğer yaygın video dosyalarını sırala, birleştir ve MP4 olarak indir. Dosyaların sunucuya yüklenmez.</p>
      </section>

      <section class="tool">
        <div class="card">
          <div id="drop" class="drop">
            <div>
              <div class="drop-icon">＋</div>
              <h2>Videolarını buraya bırak</h2>
              <p>En az 2 video seç. Sıralamayı sonradan değiştirebilirsin.</p>
              <button id="pickBtn" class="primary">Video seç</button>
              <input id="fileInput" type="file" accept="video/*,.mkv,.mov,.m4v,.avi" multiple hidden />
            </div>
          </div>
          <div id="fileList" class="file-list"></div>
        </div>

        <aside class="card side">
          <h3>Çıktı ayarları</h3>
          <div class="setting">
            <label for="resolution">Çözünürlük</label>
            <select id="resolution">
              <option value="first">İlk videonun boyutu</option>
              <option value="720">720p</option>
              <option value="1080">1080p</option>
            </select>
          </div>
          <div class="setting">
            <label for="quality">Kalite</label>
            <select id="quality">
              <option value="29">Hızlı — daha küçük dosya</option>
              <option value="25" selected>Dengeli — önerilen</option>
              <option value="21">Yüksek kalite</option>
            </select>
          </div>

          <div class="stats">
            <div class="stat"><b id="countStat">0</b><span>video</span></div>
            <div class="stat"><b id="durationStat">0:00</b><span>toplam</span></div>
            <div class="stat"><b id="sizeStat">0 MB</b><span>girdi</span></div>
          </div>

          <button id="mergeBtn" class="primary" style="width:100%" disabled>Videoları birleştir</button>
          <div class="notice">İlk kullanımda yaklaşık 30 MB FFmpeg çekirdeği indirilir. Büyük videolarda özellikle telefonda işlem süresi ve RAM kullanımı artabilir.</div>

          <div id="progressWrap" class="progress-wrap">
            <div class="progress-top"><span id="progressText">Hazırlanıyor…</span><span id="progressPct">0%</span></div>
            <div class="progress"><div id="progressBar"></div></div>
          </div>

          <div id="errorBox" class="error"></div>

          <div id="result" class="result">
            <video id="resultVideo" controls playsinline></video>
            <button id="downloadBtn" class="primary" style="width:100%">Birleştirilmiş videoyu indir</button>
          </div>
        </aside>
      </section>

      <section class="features">
        <div class="feature"><div>🔒</div><h3>Gizli ve yerel</h3><p>Videolar cihazından çıkmaz. İşlem tarayıcının içinde yapılır.</p></div>
        <div class="feature"><div>⚡</div><h3>Sunucu bekleme yok</h3><p>Yükleme kuyruğu yok; cihazın gücü kadar hızlı çalışır.</p></div>
        <div class="feature"><div>📱</div><h3>Telefon uyumlu</h3><p>Mobil tarayıcıdan video seçebilir, sıralayabilir ve sonucu indirebilirsin.</p></div>
      </section>

      <section class="content">
        <h2>Online video birleştirme nasıl çalışır?</h2>
        <p>Videolarını seç, yukarı-aşağı butonlarıyla istediğin sıraya getir ve “Videoları birleştir” düğmesine bas. MergeVid klipleri aynı video ve ses ayarlarına dönüştürür, ardından tek bir MP4 dosyasında birleştirir.</p>
        <h2>Neden tarayıcı içinde?</h2>
        <p>Geleneksel araçlarda videolar önce bir sunucuya yüklenir. Bu yaklaşım hem bekleme hem de gizlilik sorunu oluşturabilir. MergeVid FFmpeg'in WebAssembly sürümünü kullanarak işlemi doğrudan cihazında yapar.</p>
        <div class="faq">
          <h2>Sık sorulan sorular</h2>
          <details><summary>Ücretsiz mi?</summary><p>Evet. Temel video birleştirme ücretsizdir.</p></details>
          <details><summary>Videolarım yükleniyor mu?</summary><p>Hayır. Birleştirme işlemi tarayıcında gerçekleşir.</p></details>
          <details><summary>Hangi formatları destekliyor?</summary><p>FFmpeg'in okuyabildiği birçok yaygın formatı destekler. Çıktı MP4/H.264 + AAC olarak hazırlanır.</p></details>
          <details><summary>Telefonda çalışır mı?</summary><p>Evet, ancak çok büyük veya uzun videolar cihaz belleğini zorlayabilir. Böyle durumlarda 720p ve “Hızlı” seçeneği daha uygundur.</p></details>
        </div>
      </section>
    </main>

    <footer>MergeVid · Videoların cihazında kalır.</footer>
  </div>
`;

const $ = (s) => document.querySelector(s);
const drop = $('#drop');
const input = $('#fileInput');
const pickBtn = $('#pickBtn');
const list = $('#fileList');
const mergeBtn = $('#mergeBtn');
const resolution = $('#resolution');
const quality = $('#quality');
const progressWrap = $('#progressWrap');
const progressText = $('#progressText');
const progressPct = $('#progressPct');
const progressBar = $('#progressBar');
const errorBox = $('#errorBox');
const result = $('#result');
const resultVideo = $('#resultVideo');
const downloadBtn = $('#downloadBtn');

let clips = [];
let ffmpeg = null;
let outputUrl = null;
let isBusy = false;

pickBtn.addEventListener('click', () => input.click());
input.addEventListener('change', (e) => addFiles([...e.target.files]));

drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('drag');
  addFiles([...e.dataTransfer.files]);
});

async function addFiles(files) {
  const videos = files.filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name));
  for (const file of videos) {
    try {
      const meta = await readVideoMeta(file);
      clips.push({ id: crypto.randomUUID(), file, ...meta });
    } catch {
      clips.push({ id: crypto.randomUUID(), file, duration: 0, width: 1280, height: 720, thumb: '' });
    }
  }
  input.value = '';
  render();
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
      video.currentTime = Math.min(duration / 2, 1);
      video.onseeked = () => {
        let thumb = '';
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 160; canvas.height = 100;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, 160, 100);
          thumb = canvas.toDataURL('image/jpeg', .72);
        } catch {}
        URL.revokeObjectURL(url);
        resolve({ duration, width, height, thumb });
      };
      if (duration === 0) video.onseeked();
    };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('metadata')); };
    video.src = url;
  });
}

function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}` : `${m}:${String(ss).padStart(2,'0')}`;
}
function fmtBytes(n) {
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(n > 100 * 1024 ** 2 ? 0 : 1)} MB`;
}

function render() {
  list.innerHTML = clips.map((c, i) => `
    <div class="file-row" data-id="${c.id}">
      ${c.thumb ? `<img class="thumb" src="${c.thumb}" alt="" />` : `<div class="thumb"></div>`}
      <div style="min-width:0">
        <div class="file-name">${escapeHtml(c.file.name)}</div>
        <div class="file-meta">${fmtTime(c.duration)} · ${c.width}×${c.height} · ${fmtBytes(c.file.size)}</div>
      </div>
      <div class="row-actions">
        <button class="iconbtn up" title="Yukarı" ${i===0?'disabled':''}>↑</button>
        <button class="iconbtn down" title="Aşağı" ${i===clips.length-1?'disabled':''}>↓</button>
        <button class="iconbtn danger remove" title="Sil">×</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.file-row').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('.remove').onclick = () => { clips = clips.filter(c => c.id !== id); render(); };
    row.querySelector('.up').onclick = () => move(id, -1);
    row.querySelector('.down').onclick = () => move(id, 1);
  });

  $('#countStat').textContent = clips.length;
  $('#durationStat').textContent = fmtTime(clips.reduce((a,c)=>a+c.duration,0));
  $('#sizeStat').textContent = fmtBytes(clips.reduce((a,c)=>a+c.file.size,0));
  mergeBtn.disabled = clips.length < 2 || isBusy;
}

function move(id, delta) {
  const i = clips.findIndex(c => c.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= clips.length) return;
  [clips[i], clips[j]] = [clips[j], clips[i]];
  render();
}

function escapeHtml(s) {
  return s.replace(/[&<>'"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

async function ensureFFmpeg() {
  if (ffmpeg?.loaded) return ffmpeg;
  progressText.textContent = 'Video motoru yükleniyor…';
  ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress }) => {
    if (!isBusy) return;
    const pct = Math.min(99, Math.max(0, Math.round(progress * 100)));
    setProgress(pct);
  });
  const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
  });
  return ffmpeg;
}

function setProgress(pct, text) {
  progressWrap.classList.add('show');
  progressBar.style.width = `${pct}%`;
  progressPct.textContent = `${pct}%`;
  if (text) progressText.textContent = text;
}

function outputSize() {
  const first = clips[0] || { width:1280, height:720 };
  const portrait = first.height > first.width;
  if (resolution.value === '720') return portrait ? [720,1280] : [1280,720];
  if (resolution.value === '1080') return portrait ? [1080,1920] : [1920,1080];
  return [Math.max(2, first.width - (first.width % 2)), Math.max(2, first.height - (first.height % 2))];
}

async function probeHasAudio(name, i) {
  const out = `probe_${i}.json`;
  try {
    await ffmpeg.ffprobe(['-v','quiet','-print_format','json','-show_streams',name,'-o',out]);
    const data = await ffmpeg.readFile(out);
    const text = new TextDecoder().decode(data);
    const json = JSON.parse(text);
    return (json.streams || []).some(s => s.codec_type === 'audio');
  } catch {
    return true;
  } finally {
    try { await ffmpeg.deleteFile(out); } catch {}
  }
}

mergeBtn.addEventListener('click', async () => {
  if (clips.length < 2 || isBusy) return;
  isBusy = true;
  render();
  errorBox.classList.remove('show');
  result.classList.remove('show');
  setProgress(1, 'Hazırlanıyor…');

  try {
    await ensureFFmpeg();
    const [w,h] = outputSize();
    const crf = quality.value;
    const normalized = [];

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const ext = (clip.file.name.split('.').pop() || 'mp4').replace(/[^a-z0-9]/gi,'').toLowerCase();
      const inputName = `input_${i}.${ext || 'mp4'}`;
      const outputName = `norm_${i}.mp4`;
      setProgress(Math.round((i / clips.length) * 82), `Video ${i+1}/${clips.length} hazırlanıyor…`);
      await ffmpeg.writeFile(inputName, await fetchFile(clip.file));
      const hasAudio = await probeHasAudio(inputName, i);
      const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;

      const args = hasAudio
        ? ['-i', inputName, '-map','0:v:0','-map','0:a:0','-vf',vf,'-c:v','libx264','-preset','ultrafast','-crf',crf,'-c:a','aac','-ar','48000','-ac','2','-b:a','128k','-movflags','+faststart',outputName]
        : ['-i', inputName, '-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000','-map','0:v:0','-map','1:a:0','-shortest','-vf',vf,'-c:v','libx264','-preset','ultrafast','-crf',crf,'-c:a','aac','-ar','48000','-ac','2','-b:a','128k','-movflags','+faststart',outputName];

      const code = await ffmpeg.exec(args);
      if (code !== 0) throw new Error(`${clip.file.name} dönüştürülemedi.`);
      normalized.push(outputName);
      try { await ffmpeg.deleteFile(inputName); } catch {}
    }

    const concatText = normalized.map(n => `file '${n}'`).join('\n');
    await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(concatText));
    setProgress(88, 'Videolar birleştiriliyor…');
    const code = await ffmpeg.exec(['-f','concat','-safe','0','-i','concat.txt','-c','copy','-movflags','+faststart','merged.mp4']);
    if (code !== 0) throw new Error('Birleştirme tamamlanamadı.');

    const data = await ffmpeg.readFile('merged.mp4');
    const blob = new Blob([data.buffer], { type:'video/mp4' });
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);
    resultVideo.src = outputUrl;
    result.classList.add('show');
    setProgress(100, 'Tamamlandı');

    for (const n of normalized) { try { await ffmpeg.deleteFile(n); } catch {} }
    for (const n of ['concat.txt','merged.mp4']) { try { await ffmpeg.deleteFile(n); } catch {} }
  } catch (err) {
    console.error(err);
    errorBox.textContent = `Hata: ${err?.message || 'Video birleştirme sırasında bir sorun oluştu.'}`;
    errorBox.classList.add('show');
    setProgress(0, 'İşlem durdu');
  } finally {
    isBusy = false;
    render();
  }
});

downloadBtn.addEventListener('click', () => {
  if (!outputUrl) return;
  const a = document.createElement('a');
  a.href = outputUrl;
  a.download = `mergevid-${new Date().toISOString().slice(0,10)}.mp4`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});
