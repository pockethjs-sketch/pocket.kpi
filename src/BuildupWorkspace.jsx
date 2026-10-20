import React, { useEffect, useState } from 'react';
import { BUILDUP_SANDBOX, prepareBuildupDocument } from './data/workspaces.js';

export default function BuildupWorkspace() {
  const [document, setDocument] = useState('');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    import('./assets/buildup-intelligence-v3.html?raw')
      .then(module => { if (alive) setDocument(prepareBuildupDocument(module.default)); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [attempt]);
  return <div className="buildup-workspace">
    <p className="buildup-workspace-notice" role="note">영업 상담 도구 v3.0 · KPI 데이터와 자동 연동되지 않습니다. 상담 입력은 현재 창에서만 유지되므로 닫거나 새로고침하기 전에 상담 파일을 내려받으세요. 녹음·기기 간 저장 연동은 이번 연결 범위에 포함되지 않습니다.</p>
    {document ? <iframe title="빌드업 인텔리전스 상담 화면" srcDoc={document} sandbox={BUILDUP_SANDBOX} referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'" />
      : <div className="workspace-load-state" role="status">{failed ? <><p>빌드업 화면을 불러오지 못했습니다.</p><button type="button" onClick={() => setAttempt(value => value + 1)}>다시 불러오기</button></> : '빌드업 화면을 불러오는 중입니다…'}</div>}
  </div>;
}
