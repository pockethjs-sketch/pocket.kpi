// Read-only source/token audit. This is not browser/computed-style accessibility evidence.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import postcss from 'postcss';

export function readTokens(source) {
  const tokens = {};
  postcss.parse(source).walkDecls(declaration => {
    if (declaration.prop.startsWith('--ui-')) tokens[declaration.prop] = declaration.value;
  });
  return tokens;
}
export function sourceInventory(source) {
  const values = { sizes: new Set(), weights: new Set(), tracking: new Set(), radii: new Set(), colors: new Set() };
  const root = postcss.parse(source);
  root.walkDecls(declaration => {
    if (declaration.parent?.type === 'atrule' && declaration.parent.name === 'font-face') return;
    const value = declaration.value;
    if (declaration.prop === 'font-size' && /^\d+(\.\d+)?px$/.test(value)) values.sizes.add(Number.parseFloat(value));
    if (declaration.prop === 'font-weight' && /^\d+$/.test(value)) values.weights.add(Number(value));
    if (declaration.prop === 'letter-spacing') values.tracking.add(value);
    if (declaration.prop === 'border-radius') values.radii.add(value);
    for (const color of value.match(/#[a-f\d]{3,8}\b/gi) || []) values.colors.add(color.toLowerCase());
  });
  return Object.fromEntries(Object.entries(values).map(([key, set]) => [key, { count: set.size, values: [...set].sort((a,b) => String(a).localeCompare(String(b))) }]));
}
export function contrast(foreground, background) {
  const luminance = hex => {
    const value = hex.replace('#', '');
    const full = value.length === 3 ? [...value].map(c => c + c).join('') : value;
    const channels = [0,2,4].map(index => Number.parseInt(full.slice(index,index+2),16)/255).map(n => n<=.04045 ? n/12.92 : ((n+.055)/1.055)**2.4);
    return channels[0]*.2126 + channels[1]*.7152 + channels[2]*.0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
export function auditKpiDesign(tokenSource, themeSource) {
  const tokens = readTokens(tokenSource);
  const roleValues = prefix => Object.entries(tokens).filter(([key]) => key.startsWith(prefix)).map(([,value]) => value);
  const pairs = [
    ['ink/surface','--ui-ink','--ui-surface'], ['body/surface','--ui-body','--ui-surface'],
    ['muted/surface','--ui-muted','--ui-surface'], ['muted/canvas','--ui-muted','--ui-canvas'],
    ['brand/soft','--ui-brand','--ui-brand-soft'], ['surface/brand','--ui-surface','--ui-brand'],
    ['success/soft','--ui-success','--ui-success-soft'], ['warning/soft','--ui-warning','--ui-warning-soft'],
    ['danger/soft','--ui-danger','--ui-danger-soft'],
  ].map(([role,foreground,background]) => ({ role, ratio: contrast(tokens[foreground],tokens[background]), passes: contrast(tokens[foreground],tokens[background]) >= 4.5 }));
  return { scope: 'KPI_TOKEN_AND_SOURCE_ONLY_NOT_RENDERED_SCREEN', sizes: roleValues('--ui-text-').map(Number.parseFloat),
    weights: roleValues('--ui-weight-').map(Number), tracking: tokens['--ui-tracking'],
    radii: roleValues('--ui-radius-'), neutralRoles: ['canvas','surface','line','muted','body','ink'],
    contrastPairs: pairs, contrastFailures: pairs.filter(pair => !pair.passes).length,
    source: sourceInventory(themeSource), browserVerified: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL('../', import.meta.url);
  const report = auditKpiDesign(readFileSync(new URL('src/kpi-tokens.css',root),'utf8'),readFileSync(new URL('src/design.css',root),'utf8'));
  console.log(JSON.stringify(report,null,2));
  if (report.contrastFailures || report.sizes.some(size => size<11 || !Number.isInteger(size))) process.exitCode=1;
}
