import React from 'react';

// G-19: shared presentation only. Each view owns business callbacks and values.
export const Chip = ({ cls, children }) => <span data-ui-component="chip" className={"ui-chip inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium whitespace-nowrap " + (cls || "bg-slate-100 text-slate-600 border-slate-200")}>{children}</span>;
export const Btn = ({ onClick, kind = 'ghost', size = 'sm', disabled, children, cls = '', ...props }) => {
  const base = 'ui-button inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ';
  const variant = { primary: 'bg-indigo-600 text-white hover:bg-indigo-700', dark: 'bg-slate-900 text-white hover:bg-slate-800', ghost: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50', danger: 'border border-red-200 bg-white text-red-600 hover:bg-red-50', soft: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' }[kind];
  const sizing = { xs: 'px-2 py-1 text-xs', sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm' }[size];
  return <button type="button" {...props} data-ui-component="button" data-kind={kind} data-size={size} onClick={onClick} disabled={disabled} className={base + variant + ' ' + sizing + ' ' + cls}>{children}</button>;
};
export const Inp = ({ className = '', ...props }) => <input {...props} data-ui-component="input" className={'ui-input w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 ' + className} />;
export const Ta = ({ className = '', ...props }) => <textarea {...props} data-ui-component="textarea" className={'ui-textarea w-full px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 leading-relaxed placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 ' + className} />;
export const Sel = ({ value, onChange, options, className = '', disabled, ...props }) => <select {...props} value={value} onChange={onChange} disabled={disabled} data-ui-component="select" className={'ui-select px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed ' + className}>
  {options.map(option => { const value = option && typeof option === 'object' ? option.value : option; const label = option && typeof option === 'object' ? option.label : option; return <option key={value} value={value}>{label}</option>; })}
</select>;
export const Fld = ({ label, children }) => <label className="ui-field block"><span className="ui-field-label block text-xs font-semibold text-slate-500 mb-1">{label}</span>{children}</label>;
export const Card = ({ children, cls = '' }) => <div data-ui-component="card" className={'kpi-card bg-white rounded-xl border border-slate-200 shadow-sm ' + cls}>{children}</div>;
export const SecTitle = ({ icon: Icon, title, right }) => <div className="kpi-section-title flex items-start justify-between gap-3 mb-5 flex-wrap">
  <div className="flex items-start gap-3">
    {Icon && <div className="ui-section-icon w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-sm"><Icon size={16} /></div>}
    <div><h2 className="text-lg font-extrabold text-slate-900 leading-tight">{title}</h2></div>
  </div>
  {right && <div className="flex items-center gap-2 flex-wrap">{right}</div>}
</div>;
export const Seg = ({ value, onChange, options, label = '옵션 선택' }) => <div role="group" aria-label={label} className="ui-segment flex rounded-lg border border-slate-200 overflow-hidden bg-white">
  {options.map(([key, label]) => <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)} className={'px-3 py-1.5 text-xs font-semibold transition-colors ' + (value === key ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50')}>{label}</button>)}
</div>;
