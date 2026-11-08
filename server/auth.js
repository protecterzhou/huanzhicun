'use strict';
const crypto = require('node:crypto');
const { run, get, all, nowStr } = require('./db');

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const err = (s, m) => new ApiError(s, m);

const TTL_MS = 12 * 3600 * 1000;

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const exp = new Date(Date.now() + TTL_MS).toISOString().replace('T', ' ').slice(0, 19);
  run('INSERT INTO session(token,user_id,expires_at,created_at) VALUES (?,?,?,?)', token, userId, exp, nowStr());
  return token;
}

function getUserByToken(token) {
  if (!token) return null;
  const s = get('SELECT * FROM session WHERE token=?', token);
  if (!s) return null;
  if (s.expires_at < nowStr()) {
    run('DELETE FROM session WHERE token=?', token);
    return null;
  }
  return get('SELECT * FROM user WHERE id=? AND status=\'active\'', s.user_id) || null;
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, name: u.name, title: u.title,
    role: u.role, data_scope: u.data_scope, org_id: u.org_id,
    scope_org_id: u.scope_org_id, tenant_id: u.tenant_id,
    must_change_pwd: !!u.must_change_pwd,
  };
}

/** 当前用户可见的归档主体（公司）ID 列表 */
function visibleOrgIds(u) {
  if (u.data_scope === 'all') {
    return all('SELECT id FROM org WHERE tenant_id=? AND is_subject=1 AND status=\'active\'', u.tenant_id).map((r) => r.id);
  }
  const base = u.scope_org_id || u.org_id;
  if (!base) return [];
  const o = get('SELECT * FROM org WHERE id=?', base);
  if (!o) return [];
  return all(
    'SELECT id FROM org WHERE tenant_id=? AND is_subject=1 AND status=\'active\' AND (id=? OR path LIKE ?)',
    u.tenant_id, base, o.path + '/%'
  ).map((r) => r.id);
}

const can = {
  write: (u) => u.role !== 'auditor',
  review: (u) => u.role === 'tenant_admin' || u.role === 'org_admin',
  admin: (u) => u.role === 'tenant_admin',
};

function audit(c, action, targetType, targetId, detail) {
  run(
    `INSERT INTO audit_log(tenant_id,actor_id,actor_name,action,target_type,target_id,detail,ip,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    c.user ? c.user.tenant_id : null, c.user ? c.user.id : null, c.user ? c.user.name : '匿名',
    action, targetType, targetId,
    typeof detail === 'string' ? detail : JSON.stringify(detail || {}),
    c.ip || '', nowStr()
  );
}

module.exports = { ApiError, err, createSession, getUserByToken, publicUser, visibleOrgIds, can, audit };
