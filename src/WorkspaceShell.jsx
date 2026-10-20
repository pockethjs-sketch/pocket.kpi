import React, { useState } from 'react';
import { ArrowRight, ChartNoAxesCombined, Layers3, LayoutGrid } from 'lucide-react';
import BuildupWorkspace from './BuildupWorkspace.jsx';
import { INITIAL_WORKSPACE, WORKSPACES, MARKETING_HUB, selectWorkspace } from './data/workspaces.js';
import './workspace-shell.css';

export default function WorkspaceShell({ children, onSignOut }) {
  const [workspace, setWorkspace] = useState(INITIAL_WORKSPACE);
  const select = target => setWorkspace(state => selectWorkspace(state, target));
  return <div className="workspace-shell">
    <header className="workspace-switcher">
      <button type="button" className="workspace-brand" onClick={() => select('home')} aria-label="포켓 업무 공간 선택으로 돌아가기"><LayoutGrid size={19} /><span>POCKET <small>WORKSPACE</small></span></button>
      <nav aria-label="상위 업무 공간">
        <button type="button" onClick={() => select('home')} aria-current={workspace.active === 'home' ? 'page' : undefined}>선택 홈</button>
        {WORKSPACES.map(item => <button type="button" key={item.id} onClick={() => select(item.id)} aria-current={workspace.active === item.id ? 'page' : undefined}>{item.title}</button>)}
      </nav>
      <button type="button" className="workspace-signout" onClick={onSignOut}>로그아웃</button>
    </header>
    <section className="workspace-home" hidden={workspace.active !== 'home'} aria-label="업무 공간 선택">
      <div className="workspace-home-heading"><p>POCKET WORKSPACE</p><h1>업무 공간을 선택하세요</h1><span>KPI 성과 관리, 빌드업 영업 상담, 마케팅 허브로 이동합니다.</span></div>
      <div className="workspace-cards">{WORKSPACES.map(item => {
        const Icon = item.id === 'kpi' ? ChartNoAxesCombined : Layers3;
        return <button type="button" className="workspace-card" key={item.id} onClick={() => select(item.id)}>
          <Icon className="workspace-card-icon" size={25} /><h2>{item.title}</h2><p>{item.description}</p><small>{item.detail}</small><strong>{item.action}<ArrowRight size={17} /></strong>
        </button>;
      })}<a className="workspace-card" href={MARKETING_HUB.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label="마케팅 허브 열기 (새 탭)">
        <LayoutGrid className="workspace-card-icon" size={25} /><h2>{MARKETING_HUB.title}</h2><p>별도로 운영 중인 포켓 마케팅 허브 사이트로 이동합니다.</p><small>외부 사이트 · 새 탭</small><strong>마케팅 허브 열기<ArrowRight size={17} /></strong>
      </a></div>
      <p className="workspace-home-note">상단 메뉴로 언제든 전환할 수 있습니다. 화면을 전환해도 열어 둔 KPI와 상담 화면은 유지됩니다. 마케팅 허브는 새 탭에서 열립니다.</p>
    </section>
    <section className="workspace-panel workspace-panel--kpi" hidden={workspace.active !== 'kpi'} aria-label="KPI 시트 작업 공간">{workspace.kpiOpened ? children : null}</section>
    <section className="workspace-panel workspace-panel--buildup" hidden={workspace.active !== 'buildup'} aria-label="빌드업 인텔리전스 작업 공간">{workspace.buildupOpened ? <BuildupWorkspace /> : null}</section>
  </div>;
}
