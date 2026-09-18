import React, { Fragment } from "react";

const colors = ["#edab9b", "#ffe39a", "#a9c9ed", "#cfb5df", "#a6d8c6"];
const money = (value) => "₩" + Number(value || 0).toLocaleString("ko-KR");

export function ContractCustomerTypeLabel({ value }) {
  const type = value || "신규";
  return <span className={"contract-customer-type " + (type === "구분 미상" ? "contract-customer-unknown" : type === "기존" ? "contract-customer-existing" : "contract-customer-new")}>{type}</span>;
}

export default function ContractOwnerSheet({ groups, title, customerType = "전체", valueOf, channelOf, gradeOf, programOf, onOpen, description = "계약일 기준 · 최종 계약금액 · 업체명 클릭 시 상세", amountLabel = "계약액", listLabel = "계약", dateOf = lead => lead.contractAt }) {
  if (!groups.length) return <p className="p-10 text-center text-sm text-slate-600">조건에 맞는 {listLabel}이 없습니다.</p>;
  const count = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const total = groups.reduce((sum, group) => sum + group.rows.reduce((subtotal, lead) => subtotal + valueOf(lead), 0), 0);
  const rowCount = Math.max(12, ...groups.map((group) => group.rows.length));
  return (
    <section className="contract-sheet" aria-label={"담당자별 " + listLabel + " 성과"}>
      <div className="contract-sheet-title">
        <h2>{title} · {customerType} {listLabel} 리스트</h2>
        <p>{description}</p>
      </div>
      <div className="contract-sheet-overflow" tabIndex={0} role="region" aria-label="담당자별 계약 표, 좌우로 스크롤 가능">
        <table style={{ minWidth: 40 + groups.length * 400 }}>
          <caption className="sr-only">담당자별 {listLabel} 업체, 채널, 등급, 프로그램, {amountLabel}과 합계</caption>
          <colgroup><col style={{ width: 40 }} /></colgroup>
          {groups.map((group) => <colgroup key={group.owner}>
            <col style={{ width: 135 }} /><col style={{ width: 56 }} /><col style={{ width: 38 }} /><col style={{ width: 76 }} /><col style={{ width: 95 }} />
          </colgroup>)}
          <thead>
            <tr className="contract-sheet-owners">
              <th className="contract-sheet-number" rowSpan={2} scope="col">No.</th>
              {groups.map((group, index) => <th key={group.owner} colSpan={5} scope="colgroup" className="contract-sheet-divider" style={{ background: colors[index % colors.length] }}>
                <div><span>{group.owner}</span><span className="contract-sheet-owner-total">{group.rows.length}건 · {money(group.rows.reduce((sum, lead) => sum + valueOf(lead), 0))}</span></div>
              </th>)}
            </tr>
            <tr className="contract-sheet-columns">{groups.map((group) => <Fragment key={group.owner}>
              <th scope="col" className="contract-sheet-divider">업체명</th><th scope="col">채널</th><th scope="col">등급</th><th scope="col">프로그램</th><th scope="col">{amountLabel}</th>
            </Fragment>)}</tr>
          </thead>
          <tbody>{Array.from({ length: rowCount }, (_, index) => <tr key={index}>
            <th scope="row" className="contract-sheet-number">{index + 1}</th>
            {groups.map((group) => {
              const lead = group.rows[index];
              if (!lead) return <Fragment key={group.owner}><td className="contract-sheet-divider" /><td /><td /><td /><td /></Fragment>;
              return <Fragment key={group.owner}>
                <td className="contract-sheet-divider contract-sheet-company"><button type="button" onClick={() => onOpen(lead.id)} title={`${lead.company} · ${lead.ctype || "신규"} · ${dateOf(lead) || ""}`}>
                  <ContractCustomerTypeLabel value={lead.ctype} /><span className="contract-sheet-company-name">{lead.company || "업체명 없음"}</span>
                </button></td>
                <td title={lead.channel || "미지정"}>{channelOf(lead.channel)}</td>
                <td>{gradeOf(lead.grade) === "미평가" ? "—" : gradeOf(lead.grade)}</td>
                <td className="contract-sheet-program" title={programOf(lead)}>{programOf(lead)}</td>
                <td className="contract-sheet-money">{money(valueOf(lead))}</td>
              </Fragment>;
            })}
          </tr>)}</tbody>
          <tfoot><tr>
            <th className="contract-sheet-number" scope="row">합계</th>
            {groups.map((group) => <Fragment key={group.owner}>
              <td colSpan={4} className="contract-sheet-divider contract-sheet-count">{group.owner} · {listLabel} {group.rows.length}건</td>
              <td className="contract-sheet-money">{money(group.rows.reduce((sum, lead) => sum + valueOf(lead), 0))}</td>
            </Fragment>)}
          </tr></tfoot>
        </table>
      </div>
      <div className="contract-sheet-total"><span>{customerType} {listLabel} 합계 <span className="contract-sheet-total-count">{count}건</span></span><strong>{money(total)}</strong></div>
    </section>
  );
}
