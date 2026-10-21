// Microphone recording and live Korean transcription for the buildup consultation frame.
// The isolated frame cannot open the microphone (opaque origin), so the KPI page records here
// and forwards only transcript text, recorder state and the finished audio file to the frame.
// Nothing is uploaded here; the frame may then ask the bridge to keep the file in the private
// recordings bucket (audio.put) for precise transcription. Speech is recorded at 32 kbps Opus
// (about 14 MB per hour) so long meetings stay within the storage upload limit.

export function createBuildupRecorder({ win = globalThis, onEvent = () => {} } = {}) {
  const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
  const R = { state: 'idle', base: 0, startedAt: 0, mr: null, stream: null, sr: null, chunks: [], mime: '', srOn: true, srFails: 0, finished: false };
  const emit = (event) => { try { onEvent(event); } catch { /* frame gone */ } };
  const elapsed = () => R.base + (R.state === 'rec' && R.startedAt ? (Date.now() - R.startedAt) / 1000 : 0);

  async function micPermission() {
    try { return (await win.navigator.permissions.query({ name: 'microphone' })).state || ''; } catch { return ''; }
  }

  function srStop() {
    const recognition = R.sr; R.sr = null;
    emit({ type: 'interim', text: '' });
    if (recognition) { try { recognition.onend = null; recognition.onerror = null; recognition.stop(); } catch { /* stopped */ } }
  }

  function srStart() {
    if (!SR || !R.srOn) return;
    srStop();
    let recognition;
    try { recognition = new SR(); } catch { return; }
    recognition.lang = 'ko-KR'; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i], text = String(result[0]?.transcript || '').trim();
        if (!text) continue;
        if (result.isFinal) { R.srFails = 0; emit({ type: 'line', text, t: Math.round(elapsed()) }); }
        else interim += text + ' ';
      }
      if (R.sr === recognition) emit({ type: 'interim', text: interim.trim() });
    };
    recognition.onerror = (event) => {
      const code = event?.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') { R.srOn = false; emit({ type: 'error', message: '받아쓰기 권한이 없어 녹음만 합니다', srOn: false }); }
      else if (code === 'network' || code === 'audio-capture') {
        R.srFails++;
        if (R.srFails >= 3) { R.srOn = false; emit({ type: 'error', message: code === 'network' ? '받아쓰기 서버에 연결하지 못해 녹음만 합니다' : '마이크 입력이 없어 받아쓰기를 멈췄습니다', srOn: false }); }
      }
    };
    recognition.onend = () => {
      if (R.state === 'rec' && R.srOn && R.sr === recognition) {
        setTimeout(() => { if (R.sr === recognition && R.srOn && R.state === 'rec') { try { recognition.start(); } catch { /* already started */ } } }, R.srFails ? 1500 : 200);
      }
    };
    R.sr = recognition;
    try { recognition.start(); } catch { /* already started */ }
  }

  async function finalize(recorder) {
    if (recorder !== R.mr || R.finished) return;
    R.finished = true;
    if (R.state === 'rec') R.base = elapsed();
    R.startedAt = 0; srStop();
    const mime = recorder.mimeType || R.mime || 'audio/webm';
    const blob = new win.Blob(R.chunks, { type: mime });
    try { R.stream.getTracks().forEach((track) => { track.onended = null; track.stop(); }); } catch { /* stopped */ }
    R.state = 'stopped'; R.mr = null; R.stream = null; R.chunks = [];
    let buffer = null;
    try { buffer = await blob.arrayBuffer(); } catch { buffer = null; }
    emit(buffer ? { type: 'result', buffer, mime, duration: Math.round(R.base) } : { type: 'result', mime, duration: Math.round(R.base) });
  }

  return {
    supported: () => !!(win.navigator?.mediaDevices?.getUserMedia && win.MediaRecorder),
    srSupported: () => !!SR,
    state: () => R.state,
    elapsed,
    async start({ base = 0, sr = true } = {}) {
      if (R.state === 'rec' || R.state === 'paused') throw { code: 'busy', message: '이미 녹음 중입니다' };
      if (!(win.navigator?.mediaDevices?.getUserMedia && win.MediaRecorder)) throw { code: 'unsupported', message: '이 브라우저는 녹음을 지원하지 않습니다' };
      let stream;
      try { stream = await win.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
      catch (error) {
        const name = error?.name || '';
        const blocked = ['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(name);
        const busy = ['NotReadableError', 'TrackStartError', 'AbortError'].includes(name);
        throw { code: blocked ? 'blocked' : busy ? 'busy' : 'nomic', name, detail: String(error?.message || '').slice(0, 200),
          perm: await micPermission(), message: blocked ? '마이크를 쓸 수 없습니다' : busy ? '마이크를 열지 못했습니다' : '마이크를 찾지 못했습니다' };
      }
      R.stream = stream; R.chunks = []; R.finished = false;
      R.mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => win.MediaRecorder.isTypeSupported?.(type)) || '';
      const recorder = R.mr = new win.MediaRecorder(stream, { ...(R.mime ? { mimeType: R.mime } : {}), audioBitsPerSecond: 32_000 });
      recorder.ondataavailable = (event) => { if (event.data?.size) R.chunks.push(event.data); };
      recorder.onstop = () => { finalize(recorder); };
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => { if (R.mr === recorder && (R.state === 'rec' || R.state === 'paused')) { try { recorder.stop(); } catch { finalize(recorder); } } };
      });
      recorder.start(1000);
      R.base = Math.max(0, Number(base) || 0); R.startedAt = Date.now(); R.srFails = 0; R.srOn = !!sr && !!SR;
      R.state = 'rec';
      srStart();
    },
    pause() {
      if (R.state !== 'rec') return;
      try { R.mr.pause(); } catch { /* some browsers */ }
      R.base = elapsed(); R.startedAt = 0; srStop(); R.state = 'paused';
    },
    resume() {
      if (R.state !== 'paused') return;
      try { R.mr.resume(); } catch { /* some browsers */ }
      R.startedAt = Date.now(); R.state = 'rec'; srStart();
    },
    stop() {
      if (R.state !== 'rec' && R.state !== 'paused') return false;
      const recorder = R.mr;
      if (R.state === 'rec') R.base = elapsed();
      R.startedAt = 0; srStop();
      if (!recorder || recorder.state === 'inactive') { finalize(recorder); return true; }
      try { recorder.stop(); } catch { finalize(recorder); }
      setTimeout(() => { if (R.mr === recorder) finalize(recorder); }, 3000);
      return true;
    },
    setSr(on) {
      R.srOn = !!on && !!SR;
      if (R.state === 'rec') { if (R.srOn) srStart(); else srStop(); }
    },
    // Workspace closed (logout/reload): release the microphone without producing a file.
    dispose() {
      R.finished = true; srStop();
      try { R.mr?.stop(); } catch { /* stopped */ }
      try { R.stream?.getTracks().forEach((track) => track.stop()); } catch { /* stopped */ }
      R.mr = null; R.stream = null; R.chunks = []; R.state = 'idle';
    },
  };
}
