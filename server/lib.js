'use strict';
// 通用工具：日期 / 期次 / 密码 / CSV
const crypto = require('node:crypto');

const pad2 = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = (d) => fmtDate(d || new Date());

function parseDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d || 1);
}

function addDays(dateStr, days) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + Number(days || 0));
  return fmtDate(d);
}

function daysBetween(a, b) {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}

/** 解析期次编号 -> 起止日期 */
function periodRange(key) {
  if (!key || key === 'ONCE') return null;
  let m = /^(\d{4})-(\d{2})$/.exec(key);
  if (m) {
    const y = +m[1], mo = +m[2];
    if (mo < 1 || mo > 12) return null;
    const last = new Date(y, mo, 0);
    return { type: 'month', start: `${y}-${pad2(mo)}-01`, end: fmtDate(last), year: y, label: `${y}年${mo}月` };
  }
  m = /^(\d{4})-Q([1-4])$/i.exec(key);
  if (m) {
    const y = +m[1], q = +m[2];
    const sm = (q - 1) * 3 + 1;
    const last = new Date(y, sm + 2, 0);
    return { type: 'quarter', start: `${y}-${pad2(sm)}-01`, end: fmtDate(last), year: y, label: `${y}年第${q}季度` };
  }
  m = /^(\d{4})-H([12])$/i.exec(key);
  if (m) {
    const y = +m[1], h = +m[2];
    const sm = h === 1 ? 1 : 7;
    const last = new Date(y, h === 1 ? 6 : 12, 0);
    return { type: 'half_year', start: `${y}-${pad2(sm)}-01`, end: fmtDate(last), year: y, label: `${y}年${h === 1 ? '上' : '下'}半年` };
  }
  m = /^(\d{4})$/.exec(key);
  if (m) {
    const y = +m[1];
    return { type: 'year', start: `${y}-01-01`, end: `${y}-12-31`, year: y, label: `${y}年` };
  }
  return null;
}

/** 当前期次编号 */
function currentPeriodKey(type, dateStr) {
  const d = dateStr ? parseDate(dateStr) : new Date();
  const y = d.getFullYear(), m = d.getMonth() + 1;
  if (type === 'month') return `${y}-${pad2(m)}`;
  if (type === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  if (type === 'half_year') return `${y}-H${m <= 6 ? 1 : 2}`;
  if (type === 'year') return `${y}`;
  return 'ONCE';
}

/** 期次前后平移 */
function shiftPeriod(key, n) {
  const r = periodRange(key);
  if (!r) return key;
  const [sy, smo] = r.start.split('-').map(Number);
  let months;
  if (r.type === 'month') months = 1;
  else if (r.type === 'quarter') months = 3;
  else if (r.type === 'half_year') months = 6;
  else return String(sy + n);

  const idx = sy * 12 + (smo - 1) + n * months;
  const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
  if (r.type === 'month') return `${ny}-${pad2(nm)}`;
  if (r.type === 'quarter') return `${ny}-Q${Math.floor((nm - 1) / 3) + 1}`;
  return `${ny}-H${nm <= 6 ? 1 : 2}`;
}

/** 某年内的全部期次 */
function periodsInYear(type, year) {
  if (type === 'month') return Array.from({ length: 12 }, (_, i) => `${year}-${pad2(i + 1)}`);
  if (type === 'quarter') return [1, 2, 3, 4].map((q) => `${year}-Q${q}`);
  if (type === 'half_year') return [`${year}-H1`, `${year}-H2`];
  if (type === 'once') return ['ONCE'];
  return [`${year}`];
}

/** 截止日 = 期次起/止 + 偏移天数 */
function dueDateFor(cat, key) {
  const r = periodRange(key);
  if (!r) return cat.fixed_due || null;
  const base = cat.due_base === 'period_start' ? r.start : r.end;
  return addDays(base, Number(cat.due_offset_days || 0));
}

/** 任务标题 */
function taskTitle(cat, key) {
  const r = periodRange(key);
  return r ? `${cat.name}（${r.label}）` : cat.name;
}

function periodLabel(key) {
  const r = periodRange(key);
  if (!r) return key === 'ONCE' ? '一次性' : '';
  return r.label;
}

// ---------- 密码 ----------
function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pwd), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(pwd, stored) {
  try {
    const [alg, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const test = crypto.scryptSync(String(pwd), salt, 64).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(test, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---------- CSV ----------
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  return '\ufeff' + lines.join('\r\n');
}

const hashCode = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
};

module.exports = {
  pad2, fmtDate, todayStr, parseDate, addDays, daysBetween,
  periodRange, currentPeriodKey, shiftPeriod, periodsInYear,
  dueDateFor, taskTitle, periodLabel,
  hashPassword, verifyPassword, sha256, toCsv, csvCell, hashCode,
};
