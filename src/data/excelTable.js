// Explicit scalar column schema. Never serialize whole business/auth objects.
export const excelTable = (name, headers, rows, scope = '') => ({ name, headers, rows, scope });
