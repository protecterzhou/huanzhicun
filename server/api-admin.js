'use strict';
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib');
const { run, get, all, nowStr, resetDemo, clearBusiness, backupNow, DATA_DIR } = require('./db');
const A = require('./auth');
const { err } = A;

const must = (c) => { if (!c.user) throw err(401, '未登录'); return c.user; };
const adminOnly = (c) => {
  const u = must(c);
  if (!A.can.admin(u)) throw err(403, '仅系统总负责人可执行此操作');
  return u;
};
const inSql = (arr) => (arr.length ? '(' + arr.map(() => '?').join(',') + ')' : '(NULL)');

module.exports = function register(r) {
  // ---------------- 组织 ----------------
  r.get('/api/admin/orgs', async (c) => {
    const u = adminOnly(c);
    const rows = all('SELECT * FROM org WHERE tenant_id=? ORDER BY sort,id', u.tenant_id);
    const kids = get('SELECT COUNT(*) n FROM archive_task WHERE tenant_id=?', u.tenant_id).n;
    return { rows, taskCount: +kids };
  });

  r.post('/api/admin/orgs', async (c) => {
    const u = adminOnly(c);
    const b = c.body || {};
    const name = String(b.name || '').trim();
    if (!name) throw err(400, '请填写公司名称');
    const parentId = +b.parentId || 1;
    const parent = get('SELECT * FROM org WHERE id=? AND tenant_id=?', parentId, u.tenant_id);
    if (!parent) throw err(400, '上级单位不存在');
    const sort = (get('SELECT COALESCE(MAX(sort),0) m FROM org WHERE tenant_id=?', u.tenant_id).m || 0) + 1;
    const id = run(
      `INSERT INTO org(tenant_id,parent_id,path,type,name,short_name,sort,is_subject,status)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      u.tenant_id, parentId, '/tmp', b.type || 'company', name, String(b.shortName || '').slice(0, 8), sort, 1, 'active'
    ).id;
    run('UPDATE org SET path=? WHERE id=?', `${parent.path}/${id}`, id);
    A.audit(c, 'org.create', 'org', id, { name });
    return { ok: true, id };
  });

  r.patch('/api/admin/orgs/:id', async (c) => {
    const u = adminOnly(c);
    const o = get('SELECT * FROM org WHERE id=? AND tenant_id=?', +c.params.id, u.tenant_id);
    if (!o) throw err(404, '单位不存在');
    const b = c.body || {};
    run(
      'UPDATE org SET name=?, short_name=?, status=?, sort=? WHERE id=?',
      String(b.name || o.name), String(b.shortName ?? o.short_name ?? ''), b.status || o.status,
      b.sort === undefined ? o.sort : +b.sort, o.id
    );
    A.audit(c, 'org.update', 'org', o.id, b);
    return { ok: true };
  });

  // ---------------- 分类 ----------------
  r.get('/api/admin/categories', async (c) => {
    const u = must(c);
    const rows = all('SELECT * FROM category WHERE tenant_id=? ORDER BY sort,id', u.tenant_id);
    const scope = all('SELECT category_id, org_id FROM category_org');
    return {
      rows: rows.map((x) => ({
        ...x,
        appliesTo: scope.filter((s) => s.category_id === x.id).map((s) => s.org_id),
      })),
    };
  });

  r.post('/api/admin/categories', async (c) => {
    const u = adminOnly(c);
    const b = c.body || {};
    const name = String(b.name || '').trim();
    if (!name) throw err(400, '请填写分类名称');
    const freq = ['month', 'quarter', 'half_year', 'year', 'once'].includes(b.frequency) ? b.frequency : 'year';
    const sort = (get('SELECT COALESCE(MAX(sort),0) m FROM category WHERE tenant_id=?', u.tenant_id).m || 0) + 1;
    const id = run(
      `INSERT INTO category(tenant_id,parent_id,code,name,frequency,due_base,due_offset_days,remind_days,required,retention_years,responsible_role,sort,status,source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      u.tenant_id, null, String(b.code || '').toUpperCase() || null, name, freq,
      b.dueBase === 'period_start' ? 'period_start' : 'period_end',
      Number(b.dueOffsetDays ?? 5), Number(b.remindDays ?? 7),
      b.required === false ? 0 : 1, b.retentionYears ? +b.retentionYears : null,
      b.responsibleRole || 'clerk', sort, 'active', 'custom'
    ).id;
    if (Array.isArray(b.appliesTo) && b.appliesTo.length) {
      for (const oid of b.appliesTo) run('INSERT INTO category_org(category_id,org_id) VALUES (?,?)', id, +oid);
    }
    A.audit(c, 'category.create', 'category', id, { name });
    return { ok: true, id };
  });

  r.patch('/api/admin/categories/:id', async (c) => {
    const u = adminOnly(c);
    const cat = get('SELECT * FROM category WHERE id=? AND tenant_id=?', +c.params.id, u.tenant_id);
    if (!cat) throw err(404, '分类不存在');
    const b = c.body || {};
    run(
      `UPDATE category SET name=?, frequency=?, due_base=?, due_offset_days=?, remind_days=?,
              required=?, retention_years=?, status=? WHERE id=?`,
      String(b.name || cat.name),
      b.frequency || cat.frequency,
      b.dueBase || cat.due_base,
      b.dueOffsetDays === undefined ? cat.due_offset_days : +b.dueOffsetDays,
      b.remindDays === undefined ? cat.remind_days : +b.remindDays,
      b.required === undefined ? cat.required : (b.required ? 1 : 0),
      b.retentionYears === undefined ? cat.retention_years : +b.retentionYears,
      b.status || cat.status,
      cat.id
    );
    if (Array.isArray(b.appliesTo)) {
      run('DELETE FROM category_org WHERE category_id=?', cat.id);
      for (const oid of b.appliesTo) run('INSERT INTO category_org(category_id,org_id) VALUES (?,?)', cat.id, +oid);
    }
    A.audit(c, 'category.update', 'category', cat.id, b);
    return { ok: true };
  });

  r.del('/api/admin/categories/:id', async (c) => {
    const u = adminOnly(c);
    const cat = get('SELECT * FROM category WHERE id=? AND tenant_id=?', +c.params.id, u.tenant_id);
    if (!cat) throw err(404, '分类不存在');
    run('UPDATE category SET status=\'disabled\' WHERE id=?', cat.id);
    A.audit(c, 'category.disable', 'category', cat.id, { name: cat.name });
    return { ok: true };
  });

  // ---------------- 成员 ----------------
  r.get('/api/admin/users', async (c) => {
    const u = adminOnly(c);
    const rows = all(
      `SELECT u.*, o.name org_name FROM user u LEFT JOIN org o ON o.id=u.org_id
       WHERE u.tenant_id=? ORDER BY u.id`, u.tenant_id
    );
    return { rows: rows.map((x) => ({ ...x, password_hash: undefined })) };
  });

  r.post('/api/admin/users', async (c) => {
    const u = adminOnly(c);
    const b = c.body || {};
    const username = String(b.username || '').trim();
    const password = String(b.password || '');
    const name = String(b.name || '').trim();
    const role = ['tenant_admin', 'org_admin', 'clerk', 'auditor'].includes(b.role) ? b.role : 'clerk';
    if (!username) throw err(400, '请填写登录账号');
    if (password.length < 6) throw err(400, '初始密码至少 6 位');
    if (!name) throw err(400, '请填写姓名');
    if (get('SELECT id FROM user WHERE username=?', username)) throw err(409, '该登录账号已存在');

    const orgId = b.orgId ? +b.orgId : null;
    if (role !== 'tenant_admin' && role !== 'auditor' && !orgId) throw err(400, '请选择所属公司');
    const dataScope = role === 'tenant_admin' || role === 'auditor' ? 'all' : 'self';

    const id = run(
      `INSERT INTO user(tenant_id,org_id,username,password_hash,name,title,role,data_scope,scope_org_id,status,must_change_pwd,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      u.tenant_id, orgId, username, L.hashPassword(password), name, String(b.title || ''),
      role, dataScope, orgId, 'active', 1, nowStr()
    ).id;
    A.audit(c, 'user.create', 'user', id, { username, role });
    return { ok: true, id };
  });

  r.patch('/api/admin/users/:id', async (c) => {
    const u = adminOnly(c);
    const target = get('SELECT * FROM user WHERE id=? AND tenant_id=?', +c.params.id, u.tenant_id);
    if (!target) throw err(404, '账号不存在');
    const b = c.body || {};
    run('UPDATE user SET name=?, title=?, status=? WHERE id=?',
      String(b.name || target.name), String(b.title ?? target.title ?? ''), b.status || target.status, target.id);
    A.audit(c, 'user.update', 'user', target.id, b);
    return { ok: true };
  });

  r.post('/api/admin/users/:id/reset', async (c) => {
    const u = adminOnly(c);
    const target = get('SELECT * FROM user WHERE id=? AND tenant_id=?', +c.params.id, u.tenant_id);
    if (!target) throw err(404, '账号不存在');
    const pwd = String((c.body || {}).password || '');
    if (pwd.length < 6) throw err(400, '新密码至少 6 位');
    run('UPDATE user SET password_hash=?, fail_count=0, must_change_pwd=1 WHERE id=?', L.hashPassword(pwd), target.id);
    A.audit(c, 'user.reset_password', 'user', target.id, { username: target.username });
    return { ok: true };
  });

  // ---------------- 操作日志 ----------------
  r.get('/api/admin/audit', async (c) => {
    const u = adminOnly(c);
    const q = c.query || {};
    const page = Math.max(1, +q.page || 1);
    const size = 30;
    let where = 'tenant_id=?';
    const args = [u.tenant_id];
    if (q.action) { where += ' AND action LIKE ?'; args.push(`%${q.action}%`); }
    const total = get(`SELECT COUNT(*) n FROM audit_log WHERE ${where}`, ...args).n;
    const rows = all(
      `SELECT * FROM audit_log WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      ...args, size, (page - 1) * size
    );
    return { total: +total, page, rows };
  });

  // ---------------- 平台总览（超管视角） ----------------
  r.get('/api/admin/platform', async (c) => {
    const u = adminOnly(c);
    const tenants = all('SELECT * FROM tenant ORDER BY id');
    return {
      tenants: tenants.map((t) => ({
        ...t,
        orgs: get('SELECT COUNT(*) n FROM org WHERE tenant_id=? AND is_subject=1', t.id).n,
        users: get('SELECT COUNT(*) n FROM user WHERE tenant_id=?', t.id).n,
        docs: get('SELECT COUNT(*) n FROM document WHERE tenant_id=? AND deleted_at IS NULL', t.id).n,
      })),
    };
  });

  // ---------------- 系统维护：重置 / 清空 ----------------
  r.get('/api/admin/backups', async (c) => {
    adminOnly(c);
    const dir = path.join(DATA_DIR, 'backups');
    if (!fs.existsSync(dir)) return { rows: [] };
    const rows = fs.readdirSync(dir).map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, at: st.mtime.toISOString().replace('T', ' ').slice(0, 19), size: st.size };
    });
    rows.sort((a, b) => b.name.localeCompare(a.name));
    return { rows: rows.slice(0, 20) };
  });

  r.post('/api/admin/reset', async (c) => {
    const u = adminOnly(c);
    const b = c.body || {};
    const mode = b.mode === 'clear' ? 'clear' : 'demo';
    const need = mode === 'clear' ? '确认清空' : '确认重置';
    if (String(b.confirm || '').trim() !== need) throw err(400, `请输入「${need}」以确认`);

    A.audit(c, 'system.reset', 'tenant', u.tenant_id, { mode });
    const backup = mode === 'clear' ? clearBusiness() : resetDemo();
    return { ok: true, mode, backup };
  });

  r.post('/api/admin/backup', async (c) => {
    adminOnly(c);
    const dir = backupNow('manual');
    A.audit(c, 'system.backup', 'tenant', c.user.tenant_id, { dir });
    return { ok: true, dir };
  });
};
