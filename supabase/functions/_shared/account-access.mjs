// Employee account administration rules (kpi-account-api).
// MASTER/OWNER and ADMIN manage employee accounts; nobody manages OWNER accounts or themselves here.
// Temporary passwords are set by an administrator and must be replaced by the employee at first login.
// Passwords are never stored, logged or returned by these helpers. Pure helpers only.

export const ACCOUNT_ROLES = Object.freeze(['ADMIN', 'EDITOR', 'VIEWER']);
export const PASSWORD_FLAG = 'pk_password_change';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ACCOUNT_LIMITS = Object.freeze({ bodyBytes: 64_000, tempMin: 8, newMin: 12, passwordMaxBytes: 72, nameMax: 40 });

const bytes = (value) => new TextEncoder().encode(String(value)).length;
const fail = (status, error) => ({ ok: false, status, error });

export function isAccountAdmin(access) {
  return !!access?.ok && ['OWNER', 'ADMIN'].includes(access.role) && (access.scope || 'all') === 'all';
}

export function passwordChangeRequired(user) {
  return !!user?.app_metadata?.[PASSWORD_FLAG];
}

export function isMasterUser(user) {
  return !!user?.app_metadata?.kpi_master_alias;
}

// Only OWNER may grant or touch ADMIN; OWNER/MASTER accounts and one's own account are never managed here.
export function canAssignRole(access, role) {
  if (!isAccountAdmin(access) || !ACCOUNT_ROLES.includes(role)) return false;
  return role !== 'ADMIN' || access.role === 'OWNER';
}

export function canManageTarget(access, target) {
  if (!isAccountAdmin(access) || !target || !UUID.test(String(target.userId || ''))) return false;
  if (target.userId === access.userId || target.master || target.role === 'OWNER' || target.role === 'SERVICE') return false;
  return target.role !== 'ADMIN' || access.role === 'OWNER';
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function validateTempPassword(value) {
  const password = typeof value === 'string' ? value : '';
  if (password.length < ACCOUNT_LIMITS.tempMin || bytes(password) > ACCOUNT_LIMITS.passwordMaxBytes || /[\r\n\t]/.test(password) || password.trim() !== password) return fail(400, 'invalid_temp_password');
  return { ok: true, value: password };
}

export function validateNewPassword(value) {
  const password = typeof value === 'string' ? value : '';
  if (password.length < ACCOUNT_LIMITS.newMin || bytes(password) > ACCOUNT_LIMITS.passwordMaxBytes || /[\r\n\t]/.test(password) || !password.trim()) return fail(400, 'weak_password');
  if (/^(.)\1+$/.test(password)) return fail(400, 'weak_password');
  return { ok: true, value: password };
}

export function displayName(email, name) {
  const given = String(name || '').trim().slice(0, ACCOUNT_LIMITS.nameMax);
  if (given) return given;
  const local = String(email || '').split('@')[0].trim();
  return local.slice(0, ACCOUNT_LIMITS.nameMax) || '직원';
}

export function validateCreate(access, body) {
  const email = normalizeEmail(body?.email);
  if (!email) return fail(400, 'invalid_email');
  const role = String(body?.role || 'EDITOR');
  if (!canAssignRole(access, role)) return fail(403, 'role_not_allowed');
  const password = validateTempPassword(body?.password);
  if (!password.ok) return password;
  return { ok: true, value: { email, role, password: password.value, name: displayName(email, body?.name) } };
}

export function validateUpdate(access, target, body) {
  if (!canManageTarget(access, target)) return fail(403, 'account_protected');
  const patch = {};
  if (body?.role !== undefined) {
    if (!canAssignRole(access, String(body.role))) return fail(403, 'role_not_allowed');
    patch.role = String(body.role);
  }
  if (body?.active !== undefined) {
    if (typeof body.active !== 'boolean') return fail(400, 'invalid_account_update');
    patch.active = body.active;
  }
  if (body?.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name || name.length > ACCOUNT_LIMITS.nameMax) return fail(400, 'invalid_account_update');
    patch.name = name;
  }
  if (!Object.keys(patch).length) return fail(400, 'invalid_account_update');
  return { ok: true, value: patch };
}

// List row for the administrator screen. The MASTER alias address is never shown.
export function accountRow({ membership, profile, user, me }) {
  const master = isMasterUser(user);
  return {
    userId: membership.user_id,
    email: master ? 'MASTER' : String(user?.email || profile?.email || ''),
    name: master ? 'MASTER' : String(profile?.display_name || displayName(user?.email, '')),
    role: membership.role,
    active: membership.state === 'ACTIVE' && !membership.archived_at,
    master,
    self: membership.user_id === me,
    mustChangePassword: passwordChangeRequired(user),
    lastSignInAt: user?.last_sign_in_at || null,
    createdAt: membership.created_at || user?.created_at || null,
  };
}

export function sortAccounts(rows) {
  const rank = { OWNER: 0, ADMIN: 1, EDITOR: 2, VIEWER: 3 };
  return [...rows].sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || Number(b.active) - Number(a.active) || a.email.localeCompare(b.email));
}

// Supabase Auth admin errors mapped to codes the screen explains.
export function authErrorCode(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`;
  if (/weak_password|password should|at least/i.test(text)) return 'weak_password';
  if (/already|registered|exists|email_exists/i.test(text)) return 'account_exists';
  return 'auth_update_failed';
}
