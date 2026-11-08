'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const L = require('./lib');
const { run, get, all, UPLOAD_DIR, nowStr, createTenant } = require('./db');
const A = require('./auth');
const { err } = A;

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
const inSql = (arr) => (arr.length ? '(' + arr.map(() => '?').join(',') + ')' : '(NULL)');
const must = (c) => { if (!c.user) throw err(401, '未登录或登录已过期'); return c.user; };
const scopes = (u) => A.visibleOrgIds(u);

function windowMonth(year, month) {
  return { start: `${year}-${L.pad2(month)}-01`, end: L.fmtDate(new Date(year, month, 0)) };
}
function windowYear(year) {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

function counts(tid, idsArr, win) {
  if (!idsArr.length) return { total: 0, done: 0 };
  const r = get(
    `SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN status=\'done\' THEN 1 ELSE 0 END),0) done
     FROM archive_task
     WHERE tenant_id=? AND status!='waived' AND due_date>=? AND due_date<=? AND org_id IN ${inSql(idsArr)}`,
    tid, win.start, win.end, ...idsArr
  );
  return { total: Number(r.total || 0), done: Number(r.done || 0) };
}

function byCategory(tid, idsArr, win) {
  if (!idsArr.length) return [];
  return all(
    `SELECT c.id, c.name, c.sort,
            COUNT(*) total,
            COALESCE(SUM(CASE WHEN t.status=\'done\' THEN 1 ELSE 0 END),0) done
     FROM archive_task t JOIN category c ON c.id=t.category_id
     WHERE t.tenant_id=? AND t.status!='waived' AND t.due_date>=? AND t.due_date<=? AND t.org_id IN ${inSql(idsArr)}
     GROUP BY c.id ORDER BY c.sort`,
    tid, win.start, win.end, ...idsArr
  ).map((r) => ({ id: r.id, name: r.name, total: +r.total, done: +r.done }));
}

function byOrg(tid, idsArr, win) {
  if (!idsArr.length) return [];
  return all(
    `SELECT o.id, o.name, o.short_name,
            COUNT(*) total,
            COALESCE(SUM(CASE WHEN t.status=\'done\' THEN 1 ELSE 0 END),0) done
     FROM archive_task t JOIN org o ON o.id=t.org_id
     WHERE t.tenant_id=? AND t.status!='waived' AND t.due_date>=? AND t.due_date<=? AND t.org_id IN ${inSql(idsArr)}
     GROUP BY o.id ORDER BY o.sort`,
    tid, win.start, win.end, ...idsArr
  ).map((r) => ({ id: r.id, name: r.name, short_name: r.short_name, total: +r.total, done: +r.done, rate: r.total ? +r.done / +r.total : 0 }));
}

function alarms(tid, idsArr, today) {
  if (!idsArr.length) return [];
  const rows = all(
    `SELECT t.*, o.name org_name, o.short_name, c.name cat_name, c.remind_days
     FROM archive_task t
     JOIN org o ON o.id=t.org_id
     JOIN category c ON c.id=t.category_id
     WHERE t.tenant_id=? AND t.status IN ('pending','rejected') AND t.org_id IN ${inSql(idsArr)}
       AND t.due_date <= date(?, '+' || COALESCE(c.remind_days,7) || ' day')
     ORDER BY t.due_date ASC`,
    tid, ...idsArr, today
  );
  return rows.map((t) => ({
    ...t,
    state: t.due_date < today ? 'overdue' : 'dueSoon',
    days_left: L.daysBetween(today, t.due_date),
  }));
}

function taskState(t, today) {
  if (t.status === 'done' || t.status === 'waived' || t.status === 'submitted') return t.status;
  if (t.status === 'rejected') return 'rejected';
  if (t.due_date < today) return 'overdue';
  const d = L.daysBetween(today, t.due_date);
  return d <= (t.remind_days || 7) ? 'dueSoon' : 'pending';
}

function syncNotifications(u) {
  const idsArr = scopes(u);
  if (!idsArr.length) return;
  const today = L.todayStr();
  const rows = alarms(u.tenant_id, idsArr, today);
  for (const t of rows.slice(0, 10)) {
    const dedupe = `task:${t.id}`;
    const exists = get('SELECT id FROM notification WHERE user_id=? AND dedupe=?', u.id, dedupe);
    if (exists) continue;
    run(
      `INSERT INTO notification(tenant_id,user_id,type,title,body,ref_type,ref_id,dedupe,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      u.tenant_id, u.id,
      t.state === 'overdue' ? 'task_overdue' : 'task_due',
      t.state === 'overdue' ? '归档任务已逾期' : '归档任务即将到期',
      `${t.org_name} · ${t.title}，截止 ${t.due_date}`,
      'task', t.id, dedupe, nowStr()
    );
  }
}

// ---------------------------------------------------------------------------
module.exports = function register(r) {
  // ---------------- 认证 ----------------
  r.post('/api/login', async (c) => {
    const b = c.body || {};
    const username = String(b.username || '').trim();
    const password = String(b.password || '');
    if (!username || !password) throw err(400, '请输入账号和密码');

    const u = get('SELECT * FROM user WHERE username=?', username);
    if (!u) throw err(401, '账号或密码错误');
    if (u.status !== 'active') throw err(403, '账号已停用，请联系管理员');
    if (u.fail_count >= 5) throw err(403, '密码错误次数过多，账号已锁定，请联系管理员重置');

    if (!L.verifyPassword(password, u.password_hash)) {
      run('UPDATE user SET fail_count=fail_count+1 WHERE id=?', u.id);
      throw err(401, '账号或密码错误');
    }
    run('UPDATE user SET fail_count=0,last_login_at=? WHERE id=?', nowStr(), u.id);

    const token = A.createSession(u.id);
    c.user = u;
    A.audit(c, 'user.login', 'user', u.id, { username });
    return { token, user: A.publicUser(u) };
  });

  r.post('/api/logout', async (c) => {
    if (c.token) run('DELETE FROM session WHERE token=?', c.token);
    return { ok: true };
  });

  // 企业自助注册：建独立租户，注册人成为该企业首位管理员
  r.post('/api/register', async (c) => {
    const b = c.body || {};
    const company = String(b.company || '').trim();
    const name = String(b.name || '').trim();
    const username = String(b.username || '').trim();
    const password = String(b.password || '');

    if (company.length < 2) throw err(400, '请填写企业名称（至少 2 个字）');
    if (!name) throw err(400, '请填写管理员姓名');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw err(400, '登录账号需为 3-20 位字母、数字或下划线');
    if (password.length < 6) throw err(400, '密码至少 6 位');
    if (get('SELECT id FROM user WHERE username=?', username)) throw err(409, '该登录账号已被占用，换一个');

    const { tid, uid } = createTenant({ company, name, username, password, withDemo: !!b.withDemo });
    const u = get('SELECT * FROM user WHERE id=?', uid);
    const token = A.createSession(uid);
    c.user = u;
    A.audit(c, 'tenant.register', 'tenant', tid, { company, username });
    return { token, user: A.publicUser(u), tenantId: tid };
  });

  r.get('/api/me', async (c) => {
    const u = must(c);
    const org = u.org_id ? get('SELECT id,name,type,path FROM org WHERE id=?', u.org_id) : null;
    const tenant = get('SELECT id,name,plan,deploy_mode,expire_at FROM tenant WHERE id=?', u.tenant_id);
    syncNotifications(u);
    const unread = get('SELECT COUNT(*) n FROM notification WHERE user_id=? AND read_at IS NULL', u.id).n;
    const sc = A.visibleOrgIds(u);
    const pendingReview = get(
      `SELECT COUNT(*) n FROM archive_task WHERE tenant_id=? AND status='submitted' AND org_id IN ${inSql(sc)}`,
      u.tenant_id, ...sc
    ).n;
    return {
      user: A.publicUser(u), org, tenant, unread: +unread, today: L.todayStr(),
      pendingReview: +pendingReview,
      caps: { write: A.can.write(u), review: A.can.review(u), admin: A.can.admin(u) },
    };
  });

  r.get('/api/meta', async (c) => {
    const u = must(c);
    const idsArr = scopes(u);
    const orgs = idsArr.length
      ? all(`SELECT id,name,short_name,type,path FROM org WHERE id IN ${inSql(idsArr)} ORDER BY sort`, ...idsArr)
      : [];
    const categories = all('SELECT * FROM category WHERE tenant_id=? AND status=\'active\' ORDER BY sort', u.tenant_id);
    const edges = all('SELECT category_id, org_id FROM category_org');
    return {
      orgs, categories, today: L.todayStr(),
      caps: { write: A.can.write(u), review: A.can.review(u), admin: A.can.admin(u) },
      categoryOrgs: edges,
    };
  });

  // ---------------- 工作台 ----------------
  r.get('/api/workbench', async (c) => {
    const u = must(c);
    let idsArr = scopes(u);
    const selOrg = c.query.orgId ? +c.query.orgId : null;
    if (selOrg && idsArr.includes(selOrg)) idsArr = [selOrg];
    const today = L.todayStr();
    const year = Number(c.query.year || today.slice(0, 4));
    const month = Number(c.query.month || today.slice(5, 7));

    const mw = windowMonth(year, month);
    const yw = windowYear(year);
    const mc = counts(u.tenant_id, idsArr, mw);
    const yc = counts(u.tenant_id, idsArr, yw);
    const alarmRows = alarms(u.tenant_id, idsArr, today);

    const overdue = alarmRows.filter((a) => a.state === 'overdue').length;
    const dueSoon = alarmRows.filter((a) => a.state === 'dueSoon').length;

    const monthCats = byCategory(u.tenant_id, idsArr, mw);
    const allCats = all(`SELECT id,name FROM category WHERE tenant_id=? AND status=\'active\' ORDER BY sort`, u.tenant_id);
    const progress = allCats.map((cat) => {
      const row = monthCats.find((x) => x.id === cat.id) || { id: cat.id, name: cat.name, total: 0, done: 0 };
      const rel = alarmRows.filter((a) => a.category_id === cat.id && a.due_date >= mw.start && a.due_date <= mw.end);
      return {
        ...row,
        overdue: rel.filter((a) => a.state === 'overdue').length,
        dueSoon: rel.filter((a) => a.state === 'dueSoon').length,
      };
    });

    const orgRates = byOrg(u.tenant_id, idsArr, yw);

    const distribution = all(
      `SELECT c.name, COUNT(*) n FROM document d JOIN category c ON c.id=d.category_id
       WHERE d.tenant_id=? AND d.status=\'archived\' AND d.deleted_at IS NULL AND d.year=? AND d.org_id IN ${inSql(idsArr)}
       GROUP BY c.id ORDER BY c.sort`,
      u.tenant_id, year, ...idsArr
    ).map((x) => ({ name: x.name, count: +x.n }));

    const pendingReview = get(
      `SELECT COUNT(*) n FROM archive_task WHERE tenant_id=? AND status=\'submitted\' AND org_id IN ${inSql(idsArr)}`,
      u.tenant_id, ...idsArr
    ).n;

    return {
      year, month, today,
      kpi: {
        monthTotal: mc.total, monthDone: mc.done,
        monthRate: mc.total ? mc.done / mc.total : 0,
        yearTotal: yc.total, yearDone: yc.done,
        yearRate: yc.total ? yc.done / yc.total : 0,
        overdue, dueSoon, pendingReview: +pendingReview,
      },
      progress,
      orgRates,
      distribution,
      todos: alarmRows.slice(0, 20),
      orgCount: idsArr.length,
    };
  });

  // ---------------- 任务 ----------------
  r.get('/api/tasks', async (c) => {
    const u = must(c);
    const idsArr = scopes(u);
    const q = c.query || {};
    const today = L.todayStr();
    if (!idsArr.length) return { total: 0, rows: [] };

    let where = `t.tenant_id=? AND t.org_id IN ${inSql(idsArr)}`;
    const args = [u.tenant_id, ...idsArr];

    if (q.orgId) { where += ' AND t.org_id=?'; args.push(+q.orgId); }
    if (q.categoryId) { where += ' AND t.category_id=?'; args.push(+q.categoryId); }
    if (q.year) { where += ' AND t.period_key LIKE ?'; args.push(`${q.year}%`); }
    if (q.status) { where += ' AND t.status=?'; args.push(q.status); }
    if (q.q) { where += ' AND (t.title LIKE ? OR o.name LIKE ?)'; args.push(`%${q.q}%`, `%${q.q}%`); }

    const total = get(
      `SELECT COUNT(*) n FROM archive_task t JOIN org o ON o.id=t.org_id WHERE ${where}`, ...args
    ).n;

    const rows = all(
      `SELECT t.*, o.name org_name, o.short_name, c.name cat_name, c.frequency, c.remind_days,
              d.status doc_status, d.id doc_id
       FROM archive_task t
       JOIN org o ON o.id=t.org_id
       JOIN category c ON c.id=t.category_id
       LEFT JOIN document d ON d.id=t.document_id
       WHERE ${where}
       ORDER BY CASE t.status WHEN 'rejected' THEN 0 WHEN 'pending' THEN 1 WHEN 'submitted' THEN 2 ELSE 3 END,
                t.due_date ASC
       LIMIT 500`,
      ...args
    ).map((t) => ({ ...t, state: taskState(t, today), period_label: L.periodLabel(t.period_key) }));

    return { total: +total, rows };
  });

  r.post('/api/tasks/:id/waive', async (c) => {
    const u = must(c);
    if (!A.can.admin(u)) throw err(403, '仅系统总负责人可标记免交');
    const t = get('SELECT * FROM archive_task WHERE id=? AND tenant_id=?', +c.params.id, u.tenant_id);
    if (!t) throw err(404, '任务不存在');
    const reason = String((c.body || {}).reason || '').trim() || '不适用';
    run('UPDATE archive_task SET status=\'waived\', waived_reason=? WHERE id=?', reason, t.id);
    A.audit(c, 'task.waive', 'task', t.id, { reason });
    return { ok: true };
  });

  // ---------------- 档案 ----------------
  r.get('/api/documents', async (c) => {
    const u = must(c);
    const idsArr = scopes(u);
    const q = c.query || {};
    if (!idsArr.length) return { total: 0, rows: [] };

    let where = `d.tenant_id=? AND d.deleted_at IS NULL AND d.org_id IN ${inSql(idsArr)}`;
    const args = [u.tenant_id, ...idsArr];
    if (q.orgId) { where += ' AND d.org_id=?'; args.push(+q.orgId); }
    if (q.categoryId) { where += ' AND d.category_id=?'; args.push(+q.categoryId); }
    if (q.year) { where += ' AND d.year=?'; args.push(+q.year); }
    if (q.status) { where += ' AND d.status=?'; args.push(q.status); }
    if (q.q) { where += ' AND (d.title LIKE ? OR d.remark LIKE ? OR v.file_name LIKE ?)'; args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }

    const total = get(
      `SELECT COUNT(*) n FROM document d LEFT JOIN document_version v ON v.id=d.current_version_id WHERE ${where}`, ...args
    ).n;

    const page = Math.max(1, +q.page || 1);
    const size = Math.min(100, Math.max(10, +q.pageSize || 20));

    const rows = all(
      `SELECT d.*, o.name org_name, o.short_name, c.name cat_name,
              v.file_name, v.size, v.mime, v.version_no, ub.name creator_name
       FROM document d
       JOIN org o ON o.id=d.org_id
       JOIN category c ON c.id=d.category_id
       LEFT JOIN document_version v ON v.id=d.current_version_id
       LEFT JOIN user ub ON ub.id=d.created_by
       WHERE ${where}
       ORDER BY d.created_at DESC
       LIMIT ? OFFSET ?`,
      ...args, size, (page - 1) * size
    ).map((d) => ({ ...d, period_label: L.periodLabel(d.period_key) }));

    return { total: +total, page, pageSize: size, rows };
  });

  r.get('/api/documents/:id', async (c) => {
    const u = must(c);
    const idsArr = scopes(u);
    const d = get('SELECT * FROM document WHERE id=? AND tenant_id=?', +c.params.id, u.tenant_id);
    if (!d || d.deleted_at) throw err(404, '档案不存在');
    if (!idsArr.includes(d.org_id)) throw err(403, '无权查看该档案');
    const org = get('SELECT name FROM org WHERE id=?', d.org_id);
    const cat = get('SELECT name, frequency FROM category WHERE id=?', d.category_id);
    const versions = all(
      `SELECT v.*, u2.name uploader FROM document_version v LEFT JOIN user u2 ON u2.id=v.uploaded_by
       WHERE v.document_id=? ORDER BY v.version_no DESC`, d.id
    );
    const task = d.task_id ? get('SELECT * FROM archive_task WHERE id=?', d.task_id) : null;
    return { doc: { ...d, org_name: org && org.name, cat_name: cat && cat.name, period_label: L.periodLabel(d.period_key) }, versions, task };
  });

  r.post('/api/documents', async (c) => {
    const u = must(c);
    if (!A.can.write(u)) throw err(403, '当前角色无上传权限');

    const f = c.fields || {};
    const orgId = +f.orgId;
    const categoryId = +f.categoryId;
    const idsArr = scopes(u);
    if (!idsArr.includes(orgId)) throw err(403, '无权向该公司归档');

    const cat = get('SELECT * FROM category WHERE id=? AND tenant_id=?', categoryId, u.tenant_id);
    if (!cat) throw err(400, '资料分类不存在');

    const app = all('SELECT org_id FROM category_org WHERE category_id=?', categoryId);
    if (app.length && !app.some((x) => x.org_id === orgId)) throw err(400, '该分类不适用于该公司');

    const periodKey = String(f.periodKey || L.currentPeriodKey(cat.frequency));
    if (!/^(\d{4})(-(\d{2}|Q[1-4]|H[12]))?$|^ONCE$/.test(periodKey)) throw err(400, '期次格式不正确');

    const due = L.dueDateFor(cat, periodKey) || L.todayStr();
    let task = get(
      'SELECT * FROM archive_task WHERE tenant_id=? AND org_id=? AND category_id=? AND period_key=?',
      u.tenant_id, orgId, categoryId, periodKey
    );
    if (!task) {
      const id = run(
        `INSERT INTO archive_task(tenant_id,org_id,category_id,period_type,period_key,title,due_date,status,generated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        u.tenant_id, orgId, categoryId, cat.frequency, periodKey, L.taskTitle(cat, periodKey), due, 'pending', nowStr()
      ).id;
      task = get('SELECT * FROM archive_task WHERE id=?', id);
    }

    const file = (c.files || [])[0];
    if (!file || !file.data || !file.data.length) throw err(400, '请选择要上传的文件');
    const MAX = 50 * 1024 * 1024;
    if (file.data.length > MAX) throw err(400, '单个文件不能超过 50MB');

    let doc = task.document_id ? get('SELECT * FROM document WHERE id=?', task.document_id) : null;
    if (doc && doc.status === 'archived' && f.mode !== 'version') {
      throw err(409, '该期次已归档，如需替换请以“新版本”方式提交');
    }

    const ext = path.extname(file.filename || '') || '';
    const objectKey = `t${u.tenant_id}/o${orgId}/${periodKey}/${crypto.randomUUID()}${ext}`;
    const diskPath = path.join(UPLOAD_DIR, objectKey.replace(/\//g, '_'));
    fs.writeFileSync(diskPath, file.data);

    const autoApprove = A.can.review(u) && String(f.autoApprove || '') === '1';
    const title = String(f.title || '').trim() || L.taskTitle(cat, periodKey);
    const now = nowStr();

    if (!doc) {
      const docId = run(
        `INSERT INTO document(tenant_id,org_id,category_id,task_id,title,period_key,year,remark,status,created_by,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        u.tenant_id, orgId, categoryId, task.id, title, periodKey, Number(periodKey.slice(0, 4)) || null,
        String(f.remark || ''), 'pending_review', u.id, now
      ).id;
      doc = get('SELECT * FROM document WHERE id=?', docId);
    }

    const vno = ((get('SELECT MAX(version_no) v FROM document_version WHERE document_id=?', doc.id).v || 0) + 1);
    const vid = run(
      `INSERT INTO document_version(document_id,version_no,file_name,object_key,size,mime,sha256,uploaded_by,note,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      doc.id, vno, file.filename, objectKey, file.data.length, file.mime || 'application/octet-stream',
      L.sha256(file.data), u.id, String(f.remark || ''), now
    ).id;

    run(
      `UPDATE document SET title=?, remark=?, current_version_id=?, status=?, reject_reason=NULL,
              reviewed_by=?, reviewed_at=? WHERE id=?`,
      title, String(f.remark || ''), vid, autoApprove ? 'archived' : 'pending_review',
      autoApprove ? u.id : null, autoApprove ? now : null, doc.id
    );
    run('UPDATE archive_task SET document_id=?, status=? WHERE id=?',
      doc.id, autoApprove ? 'done' : 'submitted', task.id);

    A.audit(c, autoApprove ? 'document.upload_archive' : 'document.upload', 'document', doc.id,
      { title, orgId, categoryId, periodKey, vno, size: file.data.length });

    return { ok: true, id: doc.id, status: autoApprove ? 'archived' : 'pending_review', version: vno };
  });

  r.post('/api/documents/:id/approve', async (c) => {
    const u = must(c);
    if (!A.can.review(u)) throw err(403, '无审核权限');
    const d = get('SELECT * FROM document WHERE id=? AND tenant_id=?', +c.params.id, u.tenant_id);
    if (!d) throw err(404, '档案不存在');
    if (!scopes(u).includes(d.org_id)) throw err(403, '无权审核该档案');
    const now = nowStr();
    run('UPDATE document SET status=\'archived\', reviewed_by=?, reviewed_at=?, reject_reason=NULL WHERE id=?', u.id, now, d.id);
    if (d.task_id) run('UPDATE archive_task SET status=\'done\' WHERE id=?', d.task_id);
    if (d.created_by) {
      run(`INSERT INTO notification(tenant_id,user_id,type,title,body,ref_type,ref_id,dedupe,created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        u.tenant_id, d.created_by, 'review_ok', '资料审核通过', `${d.title} 已归档`, 'document', d.id, `ok:${d.id}:${now}`, now);
    }
    A.audit(c, 'document.approve', 'document', d.id, { title: d.title });
    return { ok: true };
  });

  r.post('/api/documents/:id/reject', async (c) => {
    const u = must(c);
    if (!A.can.review(u)) throw err(403, '无审核权限');
    const d = get('SELECT * FROM document WHERE id=? AND tenant_id=?', +c.params.id, u.tenant_id);
    if (!d) throw err(404, '档案不存在');
    if (!scopes(u).includes(d.org_id)) throw err(403, '无权审核该档案');
    const reason = String((c.body || {}).reason || '').trim();
    if (!reason) throw err(400, '请填写驳回原因');
    const now = nowStr();
    run('UPDATE document SET status=\'rejected\', reject_reason=?, reviewed_by=?, reviewed_at=? WHERE id=?', reason, u.id, now, d.id);
    if (d.task_id) run('UPDATE archive_task SET status=\'rejected\' WHERE id=?', d.task_id);
    if (d.created_by) {
      run(`INSERT INTO notification(tenant_id,user_id,type,title,body,ref_type,ref_id,dedupe,created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        u.tenant_id, d.created_by, 'review_reject', '资料被驳回', `${d.title}：${reason}`, 'document', d.id, `no:${d.id}:${now}`, now);
    }
    A.audit(c, 'document.reject', 'document', d.id, { title: d.title, reason });
    return { ok: true };
  });

  r.post('/api/documents/:id/void', async (c) => {
    const u = must(c);
    if (!A.can.admin(u)) throw err(403, '仅系统总负责人可作废');
    const d = get('SELECT * FROM document WHERE id=? AND tenant_id=?', +c.params.id, u.tenant_id);
    if (!d) throw err(404, '档案不存在');
    const reason = String((c.body || {}).reason || '').trim() || '作废';
    run('UPDATE document SET status=\'voided\', reject_reason=? WHERE id=?', reason, d.id);
    if (d.task_id) run('UPDATE archive_task SET status=\'pending\', document_id=NULL WHERE id=?', d.task_id);
    A.audit(c, 'document.void', 'document', d.id, { title: d.title, reason });
    return { ok: true };
  });

  r.del('/api/documents/:id', async (c) => {
    const u = must(c);
    if (!A.can.admin(u)) throw err(403, '仅系统总负责人可删除');
    const d = get('SELECT * FROM document WHERE id=? AND tenant_id=?', +c.params.id, u.tenant_id);
    if (!d) throw err(404, '档案不存在');
    run('UPDATE document SET deleted_at=? WHERE id=?', nowStr(), d.id);
    if (d.task_id) run('UPDATE archive_task SET status=\'pending\', document_id=NULL WHERE id=?', d.task_id);
    A.audit(c, 'document.delete', 'document', d.id, { title: d.title });
    return { ok: true };
  });

  r.get('/api/documents/:id/download', async (c) => {
    const u = must(c);
    const idsArr = scopes(u);
    const d = get('SELECT * FROM document WHERE id=? AND tenant_id=?', +c.params.id, u.tenant_id);
    if (!d || d.deleted_at) throw err(404, '档案不存在');
    if (!idsArr.includes(d.org_id)) throw err(403, '无权下载该档案');
    let v;
    if (c.query.vid) v = get('SELECT * FROM document_version WHERE id=? AND document_id=?', +c.query.vid, d.id);
    else v = get('SELECT * FROM document_version WHERE id=?', d.current_version_id);
    if (!v) throw err(404, '文件不存在');
    const p = path.join(UPLOAD_DIR, v.object_key.replace(/\//g, '_'));
    if (!fs.existsSync(p)) throw err(404, '文件已丢失');
    A.audit(c, 'document.download', 'document', d.id, { file: v.file_name });
    return { __file: p, name: v.file_name, mime: v.mime };
  });

  // ---------------- 统计 ----------------
  r.get('/api/stats', async (c) => {
    const u = must(c);
    const idsArr = scopes(u);
    const today = L.todayStr();
    const year = Number(c.query.year || today.slice(0, 4));
    const yw = windowYear(year);

    const orgs = all(`SELECT id,name,short_name,sort FROM org WHERE id IN ${inSql(idsArr)} ORDER BY sort`, ...idsArr);
    const cats = all('SELECT id,name,sort,frequency FROM category WHERE tenant_id=? AND status=\'active\' ORDER BY sort', u.tenant_id);

    const cells = all(
      `SELECT t.org_id, t.category_id, COUNT(*) total,
              COALESCE(SUM(CASE WHEN t.status=\'done\' THEN 1 ELSE 0 END),0) done
       FROM archive_task t
       WHERE t.tenant_id=? AND t.status!='waived' AND t.due_date>=? AND t.due_date<=? AND t.org_id IN ${inSql(idsArr)}
       GROUP BY t.org_id, t.category_id`,
      u.tenant_id, yw.start, yw.end, ...idsArr
    );

    const map = {};
    for (const r of cells) map[`${r.org_id}:${r.category_id}`] = { total: +r.total, done: +r.done };

    const matrix = orgs.map((o) => {
      const row = { orgId: o.id, name: o.name, short_name: o.short_name, cells: [] };
      let total = 0, done = 0;
      for (const cat of cats) {
        const cell = map[`${o.id}:${cat.id}`] || { total: 0, done: 0 };
        row.cells.push({ categoryId: cat.id, name: cat.name, ...cell });
        total += cell.total; done += cell.done;
      }
      row.total = total; row.done = done; row.rate = total ? done / total : 0;
      return row;
    });

    // 近 6 个月趋势
    const trend = [];
    const base = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const y = d.getFullYear(), m = d.getMonth() + 1;
      const w = windowMonth(y, m);
      const cc = counts(u.tenant_id, idsArr, w);
      trend.push({ label: `${m}月`, total: cc.total, done: cc.done, rate: cc.total ? cc.done / cc.total : 0, year: y, month: m });
    }

    const overdueRows = alarms(u.tenant_id, idsArr, today).filter((a) => a.state === 'overdue');

    return { year, matrix, cats, trend, overdue: overdueRows, orgs };
  });

  // ---------------- 通知 ----------------
  r.get('/api/notifications', async (c) => {
    const u = must(c);
    syncNotifications(u);
    const rows = all(
      'SELECT * FROM notification WHERE user_id=? ORDER BY read_at IS NULL DESC, id DESC LIMIT 100', u.id
    );
    const unread = get('SELECT COUNT(*) n FROM notification WHERE user_id=? AND read_at IS NULL', u.id).n;
    return { unread: +unread, rows };
  });

  r.post('/api/notifications/read', async (c) => {
    const u = must(c);
    const ids2 = (c.body || {}).ids;
    if (Array.isArray(ids2) && ids2.length) {
      run(`UPDATE notification SET read_at=? WHERE user_id=? AND id IN ${inSql(ids2)}`, nowStr(), u.id, ...ids2.map(Number));
    } else {
      run('UPDATE notification SET read_at=? WHERE user_id=? AND read_at IS NULL', nowStr(), u.id);
    }
    return { ok: true };
  });

  // ---------------- 导出 ----------------
  r.get('/api/export/documents', async (c) => {
    const u = must(c);
    const idsArr = scopes(u);
    const q = c.query || {};
    let where = `d.tenant_id=? AND d.deleted_at IS NULL AND d.org_id IN ${inSql(idsArr)}`;
    const args = [u.tenant_id, ...idsArr];
    if (q.orgId) { where += ' AND d.org_id=?'; args.push(+q.orgId); }
    if (q.categoryId) { where += ' AND d.category_id=?'; args.push(+q.categoryId); }
    if (q.year) { where += ' AND d.year=?'; args.push(+q.year); }
    const rows = all(
      `SELECT o.name org, c.name cat, d.year, d.period_key, d.title, d.status, d.remark, v.file_name, d.created_at
       FROM document d JOIN org o ON o.id=d.org_id JOIN category c ON c.id=d.category_id
       LEFT JOIN document_version v ON v.id=d.current_version_id
       WHERE ${where} ORDER BY d.created_at DESC`,
      ...args
    );
    const statusMap = { archived: '已归档', pending_review: '待审核', rejected: '已驳回', voided: '已作废', draft: '草稿' };
    const csv = L.toCsv(
      ['公司', '分类', '年度', '期次', '标题', '状态', '备注', '文件名', '上传时间'],
      rows.map((x) => [x.org, x.cat, x.year, L.periodLabel(x.period_key), x.title, statusMap[x.status] || x.status, x.remark, x.file_name, x.created_at])
    );
    return { __csv: { name: `资料档案_${L.todayStr()}.csv`, content: csv } };
  });

  r.get('/api/export/overdue', async (c) => {
    const u = must(c);
    const idsArr = scopes(u);
    const rows = alarms(u.tenant_id, idsArr, L.todayStr());
    const csv = L.toCsv(
      ['公司', '资料分类', '期次', '截止日期', '状态', '逾期天数'],
      rows.map((t) => [
        t.org_name, t.cat_name, L.periodLabel(t.period_key), t.due_date,
        t.state === 'overdue' ? '逾期' : '临期',
        t.state === 'overdue' ? Math.abs(t.days_left) : 0,
      ])
    );
    return { __csv: { name: `催办清单_${L.todayStr()}.csv`, content: csv } };
  });
};
