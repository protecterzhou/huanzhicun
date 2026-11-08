'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const L = require('./lib');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'hzc.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenant (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  plan TEXT DEFAULT 'standard',
  deploy_mode TEXT DEFAULT 'saas',
  status TEXT DEFAULT 'active',
  expire_at TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS org (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  parent_id INTEGER,
  path TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'company',
  name TEXT NOT NULL,
  short_name TEXT,
  sort INTEGER DEFAULT 0,
  is_subject INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  org_id INTEGER,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  title TEXT,
  phone TEXT,
  role TEXT NOT NULL,
  data_scope TEXT NOT NULL DEFAULT 'self',
  scope_org_id INTEGER,
  status TEXT DEFAULT 'active',
  fail_count INTEGER DEFAULT 0,
  must_change_pwd INTEGER DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT,
  UNIQUE(tenant_id, username)
);

CREATE TABLE IF NOT EXISTS category (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  parent_id INTEGER,
  code TEXT,
  name TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'year',
  due_base TEXT DEFAULT 'period_end',
  due_offset_days INTEGER DEFAULT 5,
  remind_days INTEGER DEFAULT 7,
  required INTEGER DEFAULT 1,
  retention_years INTEGER,
  template_name TEXT,
  responsible_role TEXT,
  sort INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  source TEXT DEFAULT 'template'
);

CREATE TABLE IF NOT EXISTS category_org (
  category_id INTEGER NOT NULL,
  org_id INTEGER NOT NULL,
  PRIMARY KEY (category_id, org_id)
);

CREATE TABLE IF NOT EXISTS archive_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  org_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  period_type TEXT NOT NULL,
  period_key TEXT NOT NULL,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  assignee_id INTEGER,
  status TEXT DEFAULT 'pending',
  document_id INTEGER,
  waived_reason TEXT,
  generated_at TEXT,
  UNIQUE(tenant_id, org_id, category_id, period_key)
);

CREATE TABLE IF NOT EXISTS document (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  org_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  task_id INTEGER,
  title TEXT NOT NULL,
  period_key TEXT,
  year INTEGER,
  remark TEXT,
  status TEXT DEFAULT 'pending_review',
  current_version_id INTEGER,
  created_by INTEGER,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  reject_reason TEXT,
  deleted_at TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS document_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  version_no INTEGER NOT NULL,
  file_name TEXT,
  object_key TEXT,
  size INTEGER,
  mime TEXT,
  sha256 TEXT,
  uploaded_by INTEGER,
  note TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER,
  actor_id INTEGER,
  actor_name TEXT,
  action TEXT,
  target_type TEXT,
  target_id INTEGER,
  detail TEXT,
  ip TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS notification (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER,
  user_id INTEGER,
  type TEXT,
  title TEXT,
  body TEXT,
  ref_type TEXT,
  ref_id INTEGER,
  dedupe TEXT,
  read_at TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS session (
  token TEXT PRIMARY KEY,
  user_id INTEGER,
  expires_at TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_org ON archive_task(org_id, status);
CREATE INDEX IF NOT EXISTS idx_task_due ON archive_task(due_date);
CREATE INDEX IF NOT EXISTS idx_doc_org ON document(org_id, status);
CREATE INDEX IF NOT EXISTS idx_user_username ON user(username);
`;

db.exec(SCHEMA);

const nowStr = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function run(sql, ...args) {
  const st = db.prepare(sql);
  const r = st.run(...args);
  return { changes: Number(r.changes || 0), id: Number(r.lastInsertRowid || 0) };
}
function all(sql, ...args) { return db.prepare(sql).all(...args); }
function get(sql, ...args) { return db.prepare(sql).get(...args); }

// ---------------------------------------------------------------------------
// 行业模板包：环保台账（演示租户与新注册租户共用）
// ---------------------------------------------------------------------------
const CATEGORY_TEMPLATE = [
  { code: 'HBZD', name: '环保制度', frequency: 'year', due_base: 'period_end', due_offset_days: -30, remind_days: 15, retention_years: 10, only: ['建设', '环保科技'] },
  { code: 'HBJC', name: '环保检查', frequency: 'month', due_base: 'period_end', due_offset_days: 5, remind_days: 7, retention_years: 5, only: ['总部', '建设', '环保科技'] },
  { code: 'HBPX', name: '环保培训', frequency: 'year', due_base: 'period_end', due_offset_days: -30, remind_days: 15, retention_years: 5, only: null },
  { code: 'YJYL', name: '应急演练', frequency: 'year', due_base: 'period_end', due_offset_days: -45, remind_days: 10, retention_years: 5, only: null },
  { code: 'YDZJ', name: '月度总结报告', frequency: 'month', due_base: 'period_end', due_offset_days: 5, remind_days: 5, retention_years: 5, only: null },
  { code: 'JDZJ', name: '季度总结报告', frequency: 'quarter', due_base: 'period_end', due_offset_days: 15, remind_days: 7, retention_years: 5, only: null },
  { code: 'NDZJ', name: '年度总结报告', frequency: 'year', due_base: 'period_end', due_offset_days: -11, remind_days: 15, retention_years: 10, only: null },
  { code: 'NDJH', name: '年度环保工作计划', frequency: 'year', due_base: 'period_start', due_offset_days: 30, remind_days: 10, retention_years: 5, only: null },
];

function installTemplate(tid, orgByShort, useOnly) {
  let sort = 1;
  const ids = [];
  for (const c of CATEGORY_TEMPLATE) {
    const cid = run(
      `INSERT INTO category(tenant_id,parent_id,code,name,frequency,due_base,due_offset_days,remind_days,required,retention_years,responsible_role,sort,status,source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      tid, null, c.code, c.name, c.frequency, c.due_base, c.due_offset_days, c.remind_days,
      1, c.retention_years, 'clerk', sort++, 'active', 'template'
    ).id;
    if (useOnly && c.only) {
      for (const sn of c.only) {
        const oid = orgByShort[sn];
        if (oid) run('INSERT INTO category_org(category_id,org_id) VALUES (?,?)', cid, oid);
      }
    }
    ids.push(cid);
  }
  return ids;
}

/** 生成一条演示档案（含占位文件），返回 document.id */
function createDemoDoc(tid, org, cat, taskId, title, key, year, due, h, status) {
  const created = L.addDays(due, -(1 + (h % 4)));
  const docStatus = status === 'done' ? 'archived' : 'pending_review';
  const docId = run(
    `INSERT INTO document(tenant_id,org_id,category_id,task_id,title,period_key,year,status,created_by,reviewed_by,reviewed_at,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    tid, org.id, cat.id, taskId, title, key, year, docStatus,
    null, docStatus === 'archived' ? 1 : null, docStatus === 'archived' ? created + ' 10:00:00' : null,
    created + ' 09:12:00'
  ).id;
  run('UPDATE archive_task SET document_id=? WHERE id=?', docId, taskId);

  const fname = `${title}.txt`;
  const key2 = `t${tid}/o${org.id}/${year}/${crypto.randomUUID()}.txt`;
  const fpath = path.join(UPLOAD_DIR, key2.replace(/\//g, '_'));
  const body =
    `${title}\n` +
    `==============================\n` +
    `归档单位：${org.name}\n` +
    `资料分类：${cat.name}\n` +
    `所属期次：${L.periodLabel(key)}\n` +
    `截止日期：${due}\n\n` +
    `本文件为演示数据，用于展示“环智存”归档与统计效果。\n` +
    `正式使用时，这里会是实际上传的 PDF / Word / Excel 原件。\n`;
  fs.writeFileSync(fpath, body, 'utf8');
  const buf = Buffer.from(body, 'utf8');
  const vid = run(
    `INSERT INTO document_version(document_id,version_no,file_name,object_key,size,mime,sha256,uploaded_by,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    docId, 1, fname, key2, buf.length, 'text/plain; charset=utf-8', L.sha256(buf), null, created + ' 09:13:00'
  ).id;
  run('UPDATE document SET current_version_id=? WHERE id=?', vid, docId);
  return docId;
}

/** 按规则生成某租户某年度的应归档任务 */
function generateTasksForTenant(tid, year, opts) {
  opts = opts || {};
  const TODAY = L.todayStr();
  const subjects = all(`SELECT * FROM org WHERE tenant_id=? AND is_subject=1 AND status='active'`, tid);
  const cats = all(`SELECT * FROM category WHERE tenant_id=? AND status='active'`, tid);
  let created = 0;

  for (const org of subjects) {
    for (const cat of cats) {
      const apply = all('SELECT org_id FROM category_org WHERE category_id=?', cat.id);
      if (apply.length && !apply.some((r) => r.org_id === org.id)) continue;

      for (const key of L.periodsInYear(cat.frequency, year)) {
        const due = L.dueDateFor(cat, key);
        if (!due) continue;
        if (get('SELECT id FROM archive_task WHERE tenant_id=? AND org_id=? AND category_id=? AND period_key=?',
          tid, org.id, cat.id, key)) continue;

        const title = L.taskTitle(cat, key);
        const h = L.hashCode(`${org.id}-${cat.id}-${key}`);
        const r = (h % 1000) / 1000;
        let status = 'pending';
        if (opts.demo && due <= TODAY) {
          const age = L.daysBetween(due, TODAY);
          let p = opts.perf !== undefined ? opts.perf : 0.78;
          if (age > 150) p = Math.min(0.97, p + 0.15);
          else if (age > 60) p = Math.min(0.93, p + 0.08);
          if (r < p) status = 'done';
          else if (r < p + 0.05) status = 'submitted';
        }
        const taskId = run(
          `INSERT INTO archive_task(tenant_id,org_id,category_id,period_type,period_key,title,due_date,status,generated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          tid, org.id, cat.id, cat.frequency, key, title, due, status, nowStr()
        ).id;
        created++;

        if (status !== 'pending') {
          createDemoDoc(tid, org, cat, taskId, title, key, year, due, h, status);
        }
      }
    }
  }
  return created;
}

/** 新企业注册：建租户 + 组织 + 模板分类 + 首个管理员 + 当年任务 */
function createTenant(opts) {
  const now = nowStr();
  const company = String(opts.company || '').trim();
  const expire = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const tid = run(
    `INSERT INTO tenant(name, code, plan, deploy_mode, status, expire_at, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    company, 'T' + Date.now().toString(36).toUpperCase(), 'trial', 'saas', 'active', expire, now
  ).id;

  const gid = run(
    `INSERT INTO org(tenant_id,parent_id,path,type,name,short_name,sort,is_subject,status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    tid, null, '/tmp', 'group', company, company.slice(0, 6), 1, 0, 'active'
  ).id;
  run('UPDATE org SET path=? WHERE id=?', `/${gid}`, gid);

  const oid = run(
    `INSERT INTO org(tenant_id,parent_id,path,type,name,short_name,sort,is_subject,status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    tid, gid, `/tmp`, 'group', company + '总部', '总部', 2, 1, 'active'
  ).id;
  run('UPDATE org SET path=? WHERE id=?', `/${gid}/${oid}`, oid);

  installTemplate(tid, {}, false);

  const uid = run(
    `INSERT INTO user(tenant_id,org_id,username,password_hash,name,title,role,data_scope,scope_org_id,status,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    tid, oid, String(opts.username).trim(), L.hashPassword(opts.password),
    String(opts.name || '').trim() || '管理员', '系统总负责人', 'tenant_admin', 'all', oid, 'active', now
  ).id;

  const year = Number(L.todayStr().slice(0, 4));
  generateTasksForTenant(tid, year, { demo: !!opts.withDemo, perf: 0.8 });

  run(`INSERT INTO audit_log(tenant_id,actor_id,actor_name,action,target_type,target_id,detail,created_at)
       VALUES (?,?,?,?,?,?,?,?)`, tid, uid, '注册用户', 'tenant.create', 'tenant', tid, `企业注册：${company}`, now);
  return { tid, uid, oid, gid };
}

/** 备份：数据库快照 + 上传目录副本 */
function backupNow(tag) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const dir = path.join(DATA_DIR, 'backups', `${stamp}_${tag || 'manual'}`);
  fs.mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, 'hzc.db');
  db.exec(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`);
  if (fs.existsSync(UPLOAD_DIR)) fs.cpSync(UPLOAD_DIR, path.join(dir, 'uploads'), { recursive: true });
  return dir;
}

/** 恢复出厂演示数据（连账号一起重置） */
function resetDemo() {
  const backup = backupNow('reset');
  for (const t of ['notification', 'audit_log', 'document_version', 'document', 'archive_task',
    'category_org', 'category', 'user', 'session', 'org', 'tenant']) {
    db.exec(`DELETE FROM ${t}`);
  }
  db.exec('DELETE FROM sqlite_sequence');
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  seedIfEmpty();
  return backup;
}

/** 清空业务数据，保留组织 / 分类 / 账号（转正式使用时用） */
function clearBusiness() {
  const backup = backupNow('clear');
  for (const t of ['notification', 'document_version', 'document', 'archive_task']) db.exec(`DELETE FROM ${t}`);
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const year = Number(L.todayStr().slice(0, 4));
  for (const t of all('SELECT id FROM tenant')) generateTasksForTenant(t.id, year, {});
  return backup;
}

// ---------------------------------------------------------------------------
// 演示数据
// ---------------------------------------------------------------------------

function seedIfEmpty() {
  const t = get('SELECT * FROM tenant LIMIT 1');
  if (t) return;

  const now = nowStr();
  const tid = run(
    `INSERT INTO tenant(name, code, plan, deploy_mode, status, expire_at, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    '高新开发集团', 'GXKF', 'enterprise', 'saas', 'active', '2027-12-31', now
  ).id;

  run(`INSERT INTO org(tenant_id,parent_id,path,type,name,short_name,sort,is_subject,status)
       VALUES (?,?,?,?,?,?,?,?,?)`, tid, null, '/1', 'group', '高新开发集团', '集团', 1, 0, 'active');
  const orgs = [
    ['高新开发集团总部', '总部', 1, 'group'],
    ['建设工程公司', '建设', 1, 'company'],
    ['环保科技公司', '环保科技', 1, 'company'],
    ['物业管理公司', '物业', 1, 'company'],
  ];
  orgs.forEach((o, i) => {
    const oid = run(`INSERT INTO org(tenant_id,parent_id,path,type,name,short_name,sort,is_subject,status)
                     VALUES (?,?,?,?,?,?,?,?,?)`, tid, 1, `/1/${i + 2}`, o[3], o[0], o[1], i + 2, 1, 'active').id;
  });
  // 重算 path，保证与真实 id 一致
  const allOrgs = all('SELECT * FROM org ORDER BY id');
  for (const o of allOrgs) {
    const p = o.parent_id ? get('SELECT path FROM org WHERE id=?', o.parent_id).path : '';
    run('UPDATE org SET path=? WHERE id=?', `${p}/${o.id}`, o.id);
  }

  const O = Object.fromEntries(allOrgs.map((o) => [o.short_name, o.id]));

  // 用户
  const users = [
    ['admin', 'admin123', '张海涛', '集团环保总监', 'tenant_admin', 'all', 1],
    ['gx_admin', '123456', '李建国', '总部环保负责人', 'org_admin', 'self', O['总部']],
    ['gx_clerk', '123456', '王敏', '总部环保资料员', 'clerk', 'self', O['总部']],
    ['js_admin', '123456', '赵磊', '建设公司负责人', 'org_admin', 'self', O['建设']],
    ['js_clerk', '123456', '陈晨', '建设公司资料员', 'clerk', 'self', O['建设']],
    ['hb_clerk', '123456', '周洋', '环保科技资料员', 'clerk', 'self', O['环保科技']],
    ['wy_clerk', '123456', '孙倩', '物业公司资料员', 'clerk', 'self', O['物业']],
    ['auditor', '123456', '督察组', '外部督察（只读）', 'auditor', 'all', 1],
  ];
  for (const u of users) {
    run(`INSERT INTO user(tenant_id,org_id,username,password_hash,name,title,role,data_scope,scope_org_id,status,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      tid, u[6], u[0], L.hashPassword(u[1]), u[2], u[3], u[4], u[5], u[6], 'active', now);
  }

  // 分类（环保台账 2026 模板包）
  installTemplate(tid, O, true);

  // ---- 自动生成 2026 年任务 ----
  const TODAY = L.todayStr();
  const YEAR = Number(TODAY.slice(0, 4));
  const subjects = all('SELECT * FROM org WHERE is_subject=1 AND status=\'active\'');
  const catsAll = all('SELECT * FROM category WHERE status=\'active\'');
  const perf = { [O['总部']]: 0.86, [O['建设']]: 0.64, [O['环保科技']]: 0.72, [O['物业']]: 0.5 };

  for (const org of subjects) {
    for (const cat of catsAll) {
      const apply = all('SELECT org_id FROM category_org WHERE category_id=?', cat.id);
      if (apply.length && !apply.some((r) => r.org_id === org.id)) continue;

      for (const key of L.periodsInYear(cat.frequency, YEAR)) {
        const due = L.dueDateFor(cat, key);
        if (!due) continue;
        const title = L.taskTitle(cat, key);
        const h = L.hashCode(`${org.id}-${cat.id}-${key}`);
        const r = (h % 1000) / 1000;
        let status = 'pending';
        if (due <= TODAY) {
          const age = L.daysBetween(due, TODAY);
          let p = perf[org.id];
          // 越早的期次越可能事后补交，让逾期集中在近期，更接近真实情形
          if (age > 150) p = Math.min(0.97, p + 0.33);
          else if (age > 60) p = Math.min(0.92, p + 0.16);
          if (r < p) status = 'done';
          else if (r < p + 0.05) status = 'submitted';
        }
        const taskId = run(
          `INSERT INTO archive_task(tenant_id,org_id,category_id,period_type,period_key,title,due_date,status,generated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          tid, org.id, cat.id, cat.frequency, key, title, due, status, now
        ).id;

        if (status === 'done' || status === 'submitted') {
          createDemoDoc(tid, org, cat, taskId, title, key, YEAR, due, h, status);
        }
      }
    }
  }

  run(`INSERT INTO audit_log(tenant_id,actor_id,actor_name,action,target_type,target_id,detail,created_at)
       VALUES (?,?,?,?,?,?,?,?)`, tid, 1, '系统', 'tenant.init', 'tenant', tid, '初始化租户与环保台账模板包', now);
}

seedIfEmpty();

module.exports = {
  db, run, all, get, nowStr, UPLOAD_DIR, DATA_DIR,
  CATEGORY_TEMPLATE, createTenant, generateTasksForTenant,
  resetDemo, clearBusiness, backupNow,
};
