import React, { useEffect, useRef, useState } from 'react';
import { BUILDUP_SANDBOX, BUILDUP_FRAME_ALLOW, BUILDUP_NOTICE, prepareBuildupDocument } from './data/workspaces.js';
import { BUILDUP_BRIDGE_VERSION, createBuildupBridge } from './data/buildupBridge.js';
import { createBuildupRecorder } from './data/buildupRecorder.js';
import { buildupAiStream, buildupCall, buildupPrefs } from './data/buildupApi.js';

export default function BuildupWorkspace() {
  const [html, setHtml] = useState('');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const frame = useRef(null), link = useRef(null), port = useRef(null), recorder = useRef(null);
  const busy = useRef({ pending: false, recording: false });
  useEffect(() => {
    let alive = true;
    setFailed(false);
    import('./assets/buildup-intelligence.html?raw')
      .then(module => { if (alive) setHtml(prepareBuildupDocument(module.default)); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [attempt]);
  useEffect(() => {
    recorder.current = createBuildupRecorder({ onEvent: event => link.current?.recorderEvent(event) });
    const warn = event => {
      const state = recorder.current?.state();
      if (busy.current.pending || busy.current.recording || state === 'rec' || state === 'paused') { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); link.current?.close(); port.current?.close(); recorder.current?.dispose(); };
  }, []);
  // Every frame load gets a fresh private channel; the frame accepts only the first port from its parent.
  const connect = () => {
    const target = frame.current?.contentWindow, rec = recorder.current;
    if (!target || !rec) return;
    link.current?.close(); port.current?.close();
    if (['rec', 'paused'].includes(rec.state())) rec.dispose();
    const channel = new MessageChannel();
    port.current = channel.port1;
    link.current = createBuildupBridge({
      post: (message, transfer) => channel.port1.postMessage(message, transfer),
      call: buildupCall, aiStream: buildupAiStream, recorder: rec, prefs: buildupPrefs,
      onUiState: state => { busy.current = state; },
    });
    channel.port1.onmessage = event => link.current?.handle(event.data);
    target.postMessage({ type: 'pk-bridge', v: BUILDUP_BRIDGE_VERSION, rec: { rec: rec.supported(), sr: rec.srSupported() } }, '*', [channel.port2]);
  };
  return <div className="buildup-workspace">
    <p className="buildup-workspace-notice" role="note">{BUILDUP_NOTICE}</p>
    {html ? <iframe ref={frame} onLoad={connect} title="빌드업 인텔리전스 상담 화면" srcDoc={html} sandbox={BUILDUP_SANDBOX} referrerPolicy="no-referrer" allow={BUILDUP_FRAME_ALLOW} />
      : <div className="workspace-load-state" role="status">{failed ? <><p>빌드업 화면을 불러오지 못했습니다.</p><button type="button" onClick={() => setAttempt(value => value + 1)}>다시 불러오기</button></> : '빌드업 화면을 불러오는 중입니다…'}</div>}
  </div>;
}
