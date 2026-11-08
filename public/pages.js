/* 环智存 · 业务页面 */
(function () {
  'use strict';
  const HZ = window.HZ;
  if (!HZ) return;
  const S = HZ.state;
  const esc = HZ.esc;
  const api = HZ.api;

  const val = (id) => { const e = document.getElementById(id); return e ? e.value : ''; };
  const num = (id) => Number(val(id) || 0);
  function fmtSize(n) {
    if (!n) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function chip(state) {
    const map = {
      done: ['chip-green', '已归档'], archived: ['chip-green', '已归档'],
      submitted: ['chip-blue', '待审核'], pending_review: ['chip-blue', '待审核'],
      rejected: ['chip-red', '已驳回'],
      overdue: ['chip-red', '逾期'], dueSoon: ['chip-amber', '临期'],
      pending: ['chip-gray', '未归档'], waived: ['chip-gray', '免交'], voided: ['chip-gray', '已作废'],
    };
    const m = map[state] || ['chip-gray', state || '-'];
    return '<span class="chip ' + m[0] + '">' + m[1] + '</span>';
  }

  function orgOptions(selected, emptyLabel) {
    const orgs = (S.meta && S.meta.orgs) || [];
    return '<option value="">' + (emptyLabel || '全部公司') + '</option>' +
      orgs.map(function (o) { return '<option value="' + o.id + '"' + (String(selected) === String(o.id) ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('');
  }
  function catOptions(selected, emptyLabel) {
    const cats = (S.meta && S.meta.categories) || [];
    return '<option value="">' + (emptyLabel || '全部分类') + '</option>' +
      cats.map(function (c) { return '<option value="' + c.id + '"' + (String(selected) === String(c.id) ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
  }

  /* =======================================================
     台账
  ======================================================= */
  HZ.pages.ledger = async function () {
    const st = S.ledger || (S.ledger = { tab: 'tasks', orgId: '', categoryId: '', year: String(new Date().getFullYear()), q: '', status: '', page: 1 });

    const tabs = '<div class="tabs">' +
      ['tasks:归档任务', 'docs:全部档案'].map(function (t) {
        const k = t.split(':')[0];
        return '<div class="tab ' + (st.tab === k ? 'active' : '') + '" onclick="HZ.setLedger(\'tab\',\'' + k + '\')">' + t.split(':')[1] + '</div>';
      }).join('') + '</div>';

    const filterBar =
      '<div class="toolbar" style="margin-bottom:14px">' +
        '<select class="select" onchange="HZ.setLedger(\'orgId\',this.value)">' + orgOptions(st.orgId) + '</select>' +
        '<select class="select" onchange="HZ.setLedger(\'categoryId\',this.value)">' + catOptions(st.categoryId) + '</select>' +
        '<select class="select" onchange="HZ.setLedger(\'year\',this.value)">' +
          ['', '2027', '2026', '2025'].map(function (y) { return '<option value="' + y + '"' + (st.year === y ? ' selected' : '') + '>' + (y ? y + ' 年' : '全部年度') + '</option>'; }).join('') +
        '</select>' +
        (st.tab === 'tasks' ? '<select class="select" onchange="HZ.setLedger(\'status\',this.value)">' +
          [['', '全部状态'], ['pending', '未归档'], ['submitted', '待审核'], ['done', '已归档'], ['rejected', '已驳回'], ['waived', '免交']].map(function (s) {
            return '<option value="' + s[0] + '"' + (st.status === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
          }).join('') + '</select>' : '') +
        '<div class="search">' + HZ.icon.search + '<input class="input" id="ld-q" placeholder="搜索标题 / 公司 / 备注" value="' + esc(st.q) + '" onkeydown="if(event.key===\'Enter\')HZ.setLedger(\'q\',this.value)" /></div>' +
        '<div class="grow"></div>' +
        '<button class="btn" onclick="HZ.exportDocs()">' + HZ.icon.download + '导出 Excel</button>' +
        '<button class="btn btn-primary" onclick="HZ.openUpload()">' + HZ.icon.upload + '上传资料</button>' +
      '</div>';

    let body = '';
    if (st.tab === 'tasks') {
      const qs = ['pageSize=200'];
      if (st.orgId) qs.push('orgId=' + st.orgId);
      if (st.categoryId) qs.push('categoryId=' + st.categoryId);
      if (st.year) qs.push('year=' + st.year);
      if (st.status) qs.push('status=' + st.status);
      if (st.q) qs.push('q=' + encodeURIComponent(st.q));
      const d = await api('/tasks?' + qs.join('&'));

      body = d.rows.length ? '<div class="table-wrap"><table class="tb"><thead><tr>' +
        '<th>状态</th><th>公司</th><th>资料分类</th><th>期次</th><th>截止日期</th><th>任务名称</th><th style="text-align:right">操作</th>' +
        '</tr></thead><tbody>' +
        d.rows.map(function (t) {
          const canUp = ['pending', 'overdue', 'dueSoon', 'rejected'].indexOf(t.state) >= 0;
          return '<tr>' +
            '<td>' + chip(t.state) + '</td>' +
            '<td class="nowrap">' + esc(t.org_name) + '</td>' +
            '<td class="nowrap">' + esc(t.cat_name) + '</td>' +
            '<td class="nowrap muted">' + esc(t.period_label || '') + '</td>' +
            '<td class="nowrap num">' + esc(t.due_date) + '</td>' +
            '<td>' + esc(t.title) + '</td>' +
            '<td><div class="actions">' +
              (t.doc_id ? '<button class="btn btn-sm" onclick="HZ.openDoc(' + t.doc_id + ')">查看</button>' : '') +
              (canUp ? '<button class="btn btn-sm btn-soft" onclick="HZ.openUploadByTask(' + t.id + ')">' + (t.state === 'rejected' ? '重新提交' : '上传') + '</button>' : '') +
            '</div></td>' +
          '</tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="empty">' + HZ.icon.empty + '<p>没有符合条件的归档任务</p><span>换个筛选条件试试</span></div>';
    } else {
      const qs = ['page=' + st.page, 'pageSize=20'];
      if (st.orgId) qs.push('orgId=' + st.orgId);
      if (st.categoryId) qs.push('categoryId=' + st.categoryId);
      if (st.year) qs.push('year=' + st.year);
      if (st.q) qs.push('q=' + encodeURIComponent(st.q));
      const d = await api('/documents?' + qs.join('&'));

      body = d.rows.length ? '<div class="table-wrap"><table class="tb"><thead><tr>' +
        '<th>状态</th><th>标题</th><th>公司</th><th>分类</th><th>期次</th><th>文件</th><th>上传时间</th><th style="text-align:right">操作</th>' +
        '</tr></thead><tbody>' +
        d.rows.map(function (x) {
          return '<tr>' +
            '<td>' + chip(x.status) + '</td>' +
            '<td><a onclick="HZ.openDoc(' + x.id + ')">' + esc(x.title) + '</a>' + (x.remark ? '<div class="muted" style="font-size:11.5px">' + esc(x.remark) + '</div>' : '') + '</td>' +
            '<td class="nowrap">' + esc(x.org_name) + '</td>' +
            '<td class="nowrap">' + esc(x.cat_name) + '</td>' +
            '<td class="nowrap muted">' + esc(x.period_label || '') + '</td>' +
            '<td class="nowrap muted" style="font-size:12px">' + esc(x.file_name || '-') + '</td>' +
            '<td class="nowrap num muted">' + esc((x.created_at || '').slice(0, 10)) + '</td>' +
            '<td><div class="actions">' +
              '<button class="btn btn-sm" onclick="HZ.openDoc(' + x.id + ')">查看</button>' +
              '<button class="btn btn-sm btn-ghost" onclick="HZ.download(\'/documents/' + x.id + '/download\')">下载</button>' +
            '</div></td>' +
          '</tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="toolbar" style="justify-content:space-between;padding:12px 16px">' +
          '<span class="muted" style="font-size:12.5px">共 ' + d.total + ' 条 · 第 ' + d.page + ' 页</span>' +
          '<span style="display:flex;gap:8px">' +
            '<button class="btn btn-sm" ' + (d.page <= 1 ? 'disabled' : '') + ' onclick="HZ.ledgerPage(-1)">上一页</button>' +
            '<button class="btn btn-sm" ' + (d.page * d.pageSize >= d.total ? 'disabled' : '') + ' onclick="HZ.ledgerPage(1)">下一页</button>' +
          '</span></div>'
        : '<div class="empty">' + HZ.icon.empty + '<p>还没有档案</p><span>点击右上角“上传资料”开始归档</span></div>';
    }

    const inner = '<div class="page-head"><div><h1>台账</h1><p>按归档任务跟踪交付情况，或检索全部已归档资料</p></div></div>' +
      tabs + filterBar + '<div class="card"><div class="card-bd flush">' + body + '</div></div>';

    HZ.shell('ledger', '归档与检索', inner);
  };

  HZ.setLedger = function (k, v) {
    S.ledger = S.ledger || {};
    S.ledger[k] = v;
    if (k !== 'page') S.ledger.page = 1;
    HZ.pages.ledger();
  };
  HZ.ledgerPage = function (n) {
    S.ledger.page = Math.max(1, (S.ledger.page || 1) + n);
    HZ.pages.ledger();
  };
  HZ.exportDocs = function () {
    const st = S.ledger || {};
    const qs = [];
    if (st.orgId) qs.push('orgId=' + st.orgId);
    if (st.categoryId) qs.push('categoryId=' + st.categoryId);
    if (st.year) qs.push('year=' + st.year);
    HZ.download('/export/documents?' + qs.join('&'), '资料档案.csv');
  };

  /* =======================================================
     上传
  ======================================================= */
  function periodFieldsHTML(freq, periodKey) {
    const today = (S.meta && S.meta.today) || new Date().toISOString().slice(0, 10);
    const y = Number((periodKey || today).slice(0, 4));
    const ySel = ['2027', '2026', '2025'].map(function (v) { return '<option value="' + v + '"' + (+v === y ? ' selected' : '') + '>' + v + ' 年</option>'; }).join('');
    if (freq === 'month') {
      const mm = periodKey && /^\d{4}-(\d{2})$/.test(periodKey) ? Number(periodKey.slice(5, 7)) : Number(today.slice(5, 7));
      return '<select class="select" id="up-year">' + ySel + '</select>' +
        '<select class="select" id="up-month">' + Array.from({ length: 12 }, function (_, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === mm ? ' selected' : '') + '>' + (i + 1) + ' 月</option>'; }).join('') + '</select>';
    }
    if (freq === 'quarter') {
      const q = periodKey && /Q([1-4])/.test(periodKey) ? Number(periodKey.slice(-1)) : Math.floor(new Date().getMonth() / 3) + 1;
      return '<select class="select" id="up-year">' + ySel + '</select>' +
        '<select class="select" id="up-quarter">' + [1, 2, 3, 4].map(function (i) { return '<option value="' + i + '"' + (i === q ? ' selected' : '') + '>第 ' + i + ' 季度</option>'; }).join('') + '</select>';
    }
    if (freq === 'half_year') {
      return '<select class="select" id="up-year">' + ySel + '</select>' +
        '<select class="select" id="up-half"><option value="1">上半年</option><option value="2">下半年</option></select>';
    }
    if (freq === 'once') return '<input class="input" value="一次性" disabled />';
    return '<select class="select" id="up-year">' + ySel + '</select><input class="input" value="全年" disabled style="width:90px" />';
  }

  function catsForOrg(orgId) {
    const cats = (S.meta && S.meta.categories) || [];
    const edges = (S.meta && S.meta.categoryOrgs) || [];
    if (!orgId) return cats;
    return cats.filter(function (c) {
      const rel = edges.filter(function (e) { return e.category_id === c.id; });
      return !rel.length || rel.some(function (e) { return String(e.org_id) === String(orgId); });
    });
  }

  HZ.openUpload = function (pre) {
    pre = pre || {};
    const orgs = (S.meta && S.meta.orgs) || [];
    if (!orgs.length) return HZ.toast('当前账号没有可归档的公司', 'err');
    const initOrg = pre.orgId || orgs[0].id;
    const cats = catsForOrg(initOrg);
    const initCat = pre.categoryId || (cats[0] && cats[0].id);
    const cat0 = cats.find(function (c) { return String(c.id) === String(initCat); }) || cats[0];

    HZ.modal(
      '<div class="modal-hd"><h3>上传资料</h3><button class="close-x" onclick="HZ.closeModal()">' + HZ.icon.x + '</button></div>' +
      '<div class="modal-bd"><div class="form-grid">' +
        '<div class="field"><label>归档公司<span class="req">*</span></label>' +
          '<select class="select" id="up-org" onchange="HZ.onUpOrg()">' +
          orgs.map(function (o) { return '<option value="' + o.id + '"' + (String(o.id) === String(initOrg) ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('') +
          '</select></div>' +
        '<div class="field"><label>资料分类<span class="req">*</span></label>' +
          '<select class="select" id="up-cat" onchange="HZ.onUpCat()">' +
          cats.map(function (c) { return '<option value="' + c.id + '"' + (String(c.id) === String(initCat) ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') +
          '</select></div>' +
        '<div class="field full"><label>所属期次<span class="req">*</span></label>' +
          '<div style="display:flex;gap:8px" id="up-period">' + periodFieldsHTML(cat0 ? cat0.frequency : 'year', pre.periodKey) + '</div>' +
          '<div class="hint">期次决定归档归属与截止日期，系统按分类频次自动推导</div></div>' +
        '<div class="field full"><label>资料标题</label>' +
          '<input class="input" id="up-title" placeholder="留空则自动使用“分类（期次）”" /></div>' +
        '<div class="field full"><label>备注</label>' +
          '<textarea class="input" id="up-remark" placeholder="选填，例如：本次检查覆盖 3 个车间"></textarea></div>' +
        '<div class="field full"><label>选择文件<span class="req">*</span></label>' +
          '<div class="file-drop" id="up-drop" onclick="document.getElementById(\'up-file\').click()">' +
            '<div id="up-file-info"><div class="fd-t">点击选择文件</div><div class="fd-s">支持 PDF / Word / Excel / 图片，单个不超过 50MB</div></div>' +
          '</div>' +
          '<input type="file" id="up-file" style="display:none" onchange="HZ.onFilePick()" /></div>' +
      '</div></div>' +
      '<div class="modal-ft">' +
        '<button class="btn" onclick="HZ.closeModal()">取消</button>' +
        '<button class="btn btn-primary" id="up-submit" onclick="HZ.submitUpload(false)">提交审核</button>' +
        (S.me && S.me.caps && S.me.caps.review ? '<button class="btn btn-soft" id="up-submit2" onclick="HZ.submitUpload(true)">提交并归档</button>' : '') +
      '</div>',
      { wide: true }
    );
    // 保存预填的期次，供默认值使用
    HZ._upPrefill = pre;
    if (!pre.periodKey) setTimeout(HZ.suggestPeriod, 80);
  };

  HZ.onUpOrg = function () {
    const orgId = val('up-org');
    const cats = catsForOrg(orgId);
    const sel = document.getElementById('up-cat');
    sel.innerHTML = cats.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
    HZ.onUpCat();
  };

  HZ.onUpCat = function () {
    const cid = val('up-cat');
    const cat = ((S.meta && S.meta.categories) || []).find(function (c) { return String(c.id) === String(cid); });
    const box = document.getElementById('up-period');
    if (!box || !cat) return;
    const pf = HZ._upPrefill || {};
    const keep = String(pf.categoryId) === String(cid) ? pf.periodKey : '';
    box.innerHTML = periodFieldsHTML(cat.frequency, keep);
    setTimeout(HZ.suggestPeriod, 50);
  };

  /* 默认把期次指到“当前还欠着的那一期”，避免误开新任务 */
  HZ.suggestPeriod = async function () {
    const orgId = val('up-org');
    const cid = val('up-cat');
    if (!orgId || !cid) return;
    try {
      const d = await api('/tasks?orgId=' + orgId + '&categoryId=' + cid + '&pageSize=30');
      const today = (S.meta && S.meta.today) || new Date().toISOString().slice(0, 10);
      const cands = (d.rows || []).filter(function (x) {
        return ['overdue', 'dueSoon', 'pending', 'rejected'].indexOf(x.state) >= 0;
      });
      if (!cands.length) return;
      // 优先“已经到期还没交”的最近一期，其次才是未来最近一期
      const past = cands.filter(function (x) { return x.due_date <= today; })
        .sort(function (a, b) { return b.due_date.localeCompare(a.due_date); });
      const future = cands.filter(function (x) { return x.due_date > today; })
        .sort(function (a, b) { return a.due_date.localeCompare(b.due_date); });
      const pick = past[0] || future[0];
      if (!pick) return;
      const cat = ((S.meta && S.meta.categories) || []).find(function (c) { return String(c.id) === String(cid); });
      const box = document.getElementById('up-period');
      if (cat && box) box.innerHTML = periodFieldsHTML(cat.frequency, pick.period_key);
    } catch (e) { /* 忽略 */ }
  };

  HZ.onFilePick = function () {
    const f = document.getElementById('up-file').files[0];
    const info = document.getElementById('up-file-info');
    const drop = document.getElementById('up-drop');
    if (!f) return;
    drop.classList.add('has');
    info.innerHTML = '<div class="file-picked">' + HZ.icon.file +
      '<div><div class="nm">' + esc(f.name) + '</div><div class="fd-s">' + (f.size / 1024 / 1024).toFixed(2) + ' MB</div></div></div>';
  };

  function currentPeriodKey() {
    const cid = val('up-cat');
    const cat = ((S.meta && S.meta.categories) || []).find(function (c) { return String(c.id) === String(cid); });
    if (!cat) return '';
    const y = val('up-year') || (S.meta.today || '').slice(0, 4);
    if (cat.frequency === 'month') return y + '-' + String(Number(val('up-month') || 1)).padStart(2, '0');
    if (cat.frequency === 'quarter') return y + '-Q' + (val('up-quarter') || 1);
    if (cat.frequency === 'half_year') return y + '-H' + (val('up-half') || 1);
    if (cat.frequency === 'once') return 'ONCE';
    return String(y);
  }

  HZ.submitUpload = async function (autoApprove) {
    const file = document.getElementById('up-file').files[0];
    if (!file) return HZ.toast('请选择要上传的文件', 'err');
    const btn = document.getElementById(autoApprove ? 'up-submit2' : 'up-submit');
    if (btn) { btn.disabled = true; btn.textContent = '上传中…'; }
    try {
      const fd = new FormData();
      fd.append('orgId', val('up-org'));
      fd.append('categoryId', val('up-cat'));
      fd.append('periodKey', currentPeriodKey());
      fd.append('title', val('up-title'));
      fd.append('remark', val('up-remark'));
      if (autoApprove) fd.append('autoApprove', '1');
      fd.append('file', file);

      const res = await fetch('/api/documents', { method: 'POST', headers: { Authorization: 'Bearer ' + S.token }, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '上传失败');
      HZ.closeModal();
      HZ.toast(data.status === 'archived' ? '已提交并归档' : '已提交，等待审核', 'ok');
      HZ.refresh();
    } catch (e) {
      HZ.toast(e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = autoApprove ? '提交并归档' : '提交审核'; }
    }
  };

  HZ.openUploadByTask = async function (taskId) {
    try {
      const d = await api('/tasks?pageSize=500');
      const t = d.rows.find(function (x) { return x.id === taskId; });
      if (!t) return HZ.openUpload();
      HZ.openUpload({ orgId: t.org_id, categoryId: t.category_id, periodKey: t.period_key });
    } catch (e) { HZ.openUpload(); }
  };

  /* =======================================================
     档案详情
  ======================================================= */
  HZ.openDoc = async function (id) {
    let d;
    try { d = await api('/documents/' + id); } catch (e) { return HZ.toast(e.message, 'err'); }
    const doc = d.doc;
    const caps = (S.me && S.me.caps) || {};
    const canReview = caps.review && doc.status === 'pending_review';
    const isAdmin = caps.admin;

    const versions = (d.versions || []).map(function (v) {
      return '<tr><td class="nowrap">v' + v.version_no + '</td><td>' + esc(v.file_name) + '</td>' +
        '<td class="nowrap num muted">' + fmtSize(v.size) + '</td>' +
        '<td class="nowrap muted">' + esc((v.created_at || '').slice(0, 16)) + '</td>' +
        '<td class="nowrap muted">' + esc(v.uploader || '系统') + '</td>' +
        '<td style="text-align:right"><button class="btn btn-sm btn-ghost" onclick="HZ.download(\'/documents/' + doc.id + '/download?vid=' + v.id + '\',\'' + esc(v.file_name) + '\')">下载</button></td></tr>';
    }).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">暂无文件版本</td></tr>';

    HZ.modal(
      '<div class="modal-hd"><h3>' + esc(doc.title) + '</h3><button class="close-x" onclick="HZ.closeModal()">' + HZ.icon.x + '</button></div>' +
      '<div class="modal-bd">' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:14px">' + chip(doc.status) +
          '<span class="muted" style="font-size:12.5px">' + esc(doc.org_name) + ' · ' + esc(doc.cat_name) + ' · ' + esc(doc.period_label || '') + '</span></div>' +
        (doc.status === 'rejected' && doc.reject_reason ? '<div class="login-err">驳回原因：' + esc(doc.reject_reason) + '</div>' : '') +
        '<div class="form-grid" style="margin-bottom:14px">' +
          '<div class="field"><label>归档公司</label><div>' + esc(doc.org_name) + '</div></div>' +
          '<div class="field"><label>资料分类</label><div>' + esc(doc.cat_name) + '</div></div>' +
          '<div class="field"><label>期次</label><div>' + esc(doc.period_label || '-') + '</div></div>' +
          '<div class="field"><label>上传时间</label><div>' + esc((doc.created_at || '').slice(0, 16)) + '</div></div>' +
          (doc.remark ? '<div class="field full"><label>备注</label><div>' + esc(doc.remark) + '</div></div>' : '') +
        '</div>' +
        '<div style="font-size:13px;font-weight:600;margin:4px 0 8px">文件版本</div>' +
        '<div class="table-wrap" style="border:1px solid var(--line);border-radius:8px"><table class="tb"><thead><tr>' +
          '<th>版本</th><th>文件名</th><th>大小</th><th>时间</th><th>上传人</th><th></th></tr></thead><tbody>' + versions + '</tbody></table></div>' +
      '</div>' +
      '<div class="modal-ft">' +
        (isAdmin ? '<button class="btn btn-danger" onclick="HZ.docAction(' + doc.id + ',\'delete\')">删除</button>' +
                   '<button class="btn" onclick="HZ.docAction(' + doc.id + ',\'void\')">作废</button>' : '') +
        '<div style="flex:1"></div>' +
        (doc.current_version_id ? '<button class="btn" onclick="HZ.download(\'/documents/' + doc.id + '/download\')">下载最新</button>' : '') +
        (canReview ? '<button class="btn btn-danger" onclick="HZ.rejectDoc(' + doc.id + ')">驳回</button>' +
                     '<button class="btn btn-primary" onclick="HZ.approveDoc(' + doc.id + ')">审核通过</button>' : '') +
      '</div>',
      { wide: true }
    );
  };

  HZ.approveDoc = async function (id) {
    try { await api('/documents/' + id + '/approve', { method: 'POST' }); HZ.closeModal(); HZ.toast('已归档', 'ok'); HZ.refresh(); }
    catch (e) { HZ.toast(e.message, 'err'); }
  };

  HZ.rejectDoc = function (id) {
    HZ.modal(
      '<div class="modal-hd"><h3>驳回资料</h3><button class="close-x" onclick="HZ.closeModal()">' + HZ.icon.x + '</button></div>' +
      '<div class="modal-bd"><div class="field"><label>驳回原因<span class="req">*</span></label>' +
      '<textarea class="input" id="rj-reason" placeholder="例如：缺少整改前后对比，请补充后重新提交"></textarea></div></div>' +
      '<div class="modal-ft"><button class="btn" onclick="HZ.closeModal()">取消</button>' +
      '<button class="btn btn-danger" onclick="HZ.doReject(' + id + ')">确认驳回</button></div>'
    );
  };

  HZ.doReject = async function (id) {
    const reason = val('rj-reason').trim();
    if (!reason) return HZ.toast('请填写驳回原因', 'err');
    try { await api('/documents/' + id + '/reject', { method: 'POST', body: { reason: reason } }); HZ.closeModal(); HZ.toast('已驳回', 'ok'); HZ.refresh(); }
    catch (e) { HZ.toast(e.message, 'err'); }
  };

  HZ.docAction = async function (id, kind) {
    if (kind === 'delete' && !confirm('确认删除该档案？删除后归档任务会回到未归档状态。')) return;
    if (kind === 'void' && !confirm('确认作废该档案？')) return;
    try {
      if (kind === 'delete') await api('/documents/' + id, { method: 'DELETE' });
      else await api('/documents/' + id + '/void', { method: 'POST', body: {} });
      HZ.closeModal(); HZ.toast('操作成功', 'ok'); HZ.refresh();
    } catch (e) { HZ.toast(e.message, 'err'); }
  };

  /* =======================================================
     进度统计
  ======================================================= */
  HZ.pages.stats = async function () {
    if (!S.statsYear) S.statsYear = String(new Date().getFullYear());
    const d = await api('/stats?year=' + S.statsYear);
    const cats = d.cats;

    const yearSel = '<select class="select" onchange="HZ.statsYear=this.value;HZ.pages.stats()">' +
      ['2027', '2026', '2025'].map(function (y) { return '<option value="' + y + '"' + (S.statsYear === y ? ' selected' : '') + '>' + y + ' 年</option>'; }).join('') + '</select>';

    const head = '<thead><tr><th style="min-width:130px">公司</th>' +
      cats.map(function (c) { return '<th style="text-align:center">' + esc(c.name) + '</th>'; }).join('') +
      '<th style="text-align:center">合计</th></tr></thead>';

    const rows = d.matrix.map(function (r) {
      const cells = r.cells.map(function (c) {
        if (!c.total) return '<td style="text-align:center"><span class="cell cell-none">—</span></td>';
        const rate = c.done / c.total;
        const cls = rate >= 1 ? 'cell-ok' : rate >= 0.5 ? 'cell-part' : 'cell-bad';
        return '<td style="text-align:center"><span class="cell ' + cls + '">' + c.done + '/' + c.total + '</span></td>';
      }).join('');
      const rate = r.rate;
      const cls = !r.total ? 'cell-none' : rate >= 0.8 ? 'cell-ok' : rate >= 0.6 ? 'cell-part' : 'cell-bad';
      return '<tr><td><b>' + esc(r.name) + '</b></td>' + cells +
        '<td style="text-align:center"><span class="cell ' + cls + '">' + HZ.pct(rate) + '</span></td></tr>';
    }).join('');

    const trend = d.trend.map(function (t) {
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px">' +
        '<div style="font-size:11.5px;color:var(--muted)">' + HZ.pct(t.rate) + '</div>' +
        '<div style="width:100%;height:110px;display:flex;align-items:flex-end;justify-content:center">' +
        '<div style="width:60%;height:' + Math.max(2, t.rate * 100) + '%;background:linear-gradient(180deg,#4cb98a,#1e8e5a);border-radius:6px 6px 0 0;min-height:3px"></div></div>' +
        '<div style="font-size:11.5px;color:var(--faint)">' + t.label + '</div></div>';
    }).join('');

    const od = d.overdue || [];
    const odRows = od.length ? od.slice(0, 30).map(function (t) {
      return '<tr><td class="nowrap">' + esc(t.org_name) + '</td><td class="nowrap">' + esc(t.cat_name) + '</td>' +
        '<td class="nowrap muted">' + esc(t.period_label || '') + '</td>' +
        '<td class="nowrap num">' + esc(t.due_date) + '</td>' +
        '<td><span class="chip chip-red">逾期 ' + Math.abs(t.days_left) + ' 天</span></td></tr>';
    }).join('') : '<tr><td colspan="5" class="muted" style="text-align:center;padding:26px">暂无逾期任务</td></tr>';

    const inner = '<div class="page-head"><div><h1>进度统计</h1><p>按公司与分类拆解归档完成情况，用于月度复盘与督察前自查</p></div>' +
      '<div class="toolbar">' + yearSel + '<button class="btn" onclick="HZ.download(\'/export/overdue\',\'催办清单.csv\')">' + HZ.icon.download + '导出催办清单</button></div></div>' +
      '<div class="stack">' +
        '<div class="card"><div class="card-hd"><h3>公司 × 分类 归档矩阵 <span class="sub">已归档 / 应归档</span></h3>' +
          '<span class="muted" style="font-size:12px">绿=良好　黄=部分完成　红=缺失较多</span></div>' +
          '<div class="card-bd flush"><div class="table-wrap"><table class="tb matrix">' + head + '<tbody>' + rows + '</tbody></table></div></div></div>' +
        '<div class="card"><div class="card-hd"><h3>近 6 个月归档率趋势</h3></div>' +
          '<div class="card-bd"><div style="display:flex;gap:10px;align-items:flex-end">' + trend + '</div></div></div>' +
        '<div class="card"><div class="card-hd"><h3>逾期清单 <span class="sub">共 ' + od.length + ' 项</span></h3>' +
          '<button class="btn btn-ghost btn-sm" onclick="HZ.download(\'/export/overdue\',\'催办清单.csv\')">导出 →</button></div>' +
          '<div class="card-bd flush"><div class="table-wrap"><table class="tb"><thead><tr><th>公司</th><th>分类</th><th>期次</th><th>截止日期</th><th>状态</th></tr></thead><tbody>' + odRows + '</tbody></table></div></div></div>' +
      '</div>';

    HZ.shell('stats', S.statsYear + ' 年度', inner);
  };

  /* =======================================================
     配置
  ======================================================= */
  HZ.pages.settings = async function () {
    const isAdmin = !!(S.me && S.me.caps && S.me.caps.admin);
    const ALL_TABS = [['org', '组织与公司'], ['cat', '资料分类'], ['user', '成员与权限'], ['audit', '操作日志'], ['sys', '系统与维护']];
    const allow = isAdmin ? ALL_TABS : [['cat', '资料分类']];
    const tab = allow.some(function (t) { return t[0] === S.setTab; }) ? S.setTab : allow[0][0];

    const tabs = '<div class="tabs">' +
      allow.map(function (t) {
        return '<div class="tab ' + (tab === t[0] ? 'active' : '') + '" onclick="HZ.setTab(\'' + t[0] + '\')">' + t[1] + '</div>';
      }).join('') + '</div>';

    let body = '';
    if (tab === 'org') {
      const d = await api('/admin/orgs');
      body = (isAdmin ? '<div class="toolbar" style="margin-bottom:12px"><button class="btn btn-primary" onclick="HZ.orgForm()">' + HZ.icon.plus + '新增公司</button></div>' : '') +
        '<div class="table-wrap"><table class="tb"><thead><tr><th>单位名称</th><th>简称</th><th>类型</th><th>状态</th><th style="text-align:right">操作</th></tr></thead><tbody>' +
        d.rows.map(function (o) {
          return '<tr><td><b>' + esc(o.name) + '</b></td><td class="muted">' + esc(o.short_name || '-') + '</td>' +
            '<td><span class="chip chip-gray">' + (o.type === 'group' ? '集团/总部' : '公司') + '</span></td>' +
            '<td>' + (o.status === 'active' ? '<span class="chip chip-green">启用</span>' : '<span class="chip chip-gray">停用</span>') + '</td>' +
            '<td><div class="actions">' + (isAdmin ? '<button class="btn btn-sm" onclick="HZ.orgForm(' + o.id + ')">编辑</button>' : '') + '</div></td></tr>';
        }).join('') + '</tbody></table></div>';
    } else if (tab === 'cat') {
      const d = await api('/admin/categories');
      const freqName = { month: '每月', quarter: '每季', half_year: '每半年', year: '每年', once: '一次性' };
      const orgName = function (id) { const o = ((S.meta && S.meta.orgs) || []).find(function (x) { return x.id === id; }); return o ? o.short_name || o.name : ''; };
      body = (isAdmin ? '<div class="toolbar" style="margin-bottom:12px"><button class="btn btn-primary" onclick="HZ.catForm()">' + HZ.icon.plus + '新增分类</button></div>' : '') +
        '<div class="table-wrap"><table class="tb"><thead><tr><th>分类名称</th><th>频次</th><th>截止规则</th><th>提前提醒</th><th>适用公司</th><th>状态</th><th style="text-align:right">操作</th></tr></thead><tbody>' +
        d.rows.map(function (c) {
          const rule = (c.due_base === 'period_start' ? '期初' : '期末') + (c.due_offset_days >= 0 ? ' + ' : ' ') + c.due_offset_days + ' 天';
          const apply = c.appliesTo && c.appliesTo.length ? c.appliesTo.map(orgName).join('、') : '全部公司';
          return '<tr><td><b>' + esc(c.name) + '</b></td><td>' + (freqName[c.frequency] || c.frequency) + '</td>' +
            '<td class="muted">' + esc(rule) + '</td><td class="muted">' + c.remind_days + ' 天</td>' +
            '<td class="muted" style="max-width:220px">' + esc(apply) + '</td>' +
            '<td>' + (c.status === 'active' ? '<span class="chip chip-green">启用</span>' : '<span class="chip chip-gray">停用</span>') + '</td>' +
            '<td><div class="actions">' + (isAdmin ? '<button class="btn btn-sm" onclick="HZ.catForm(' + c.id + ')">编辑</button>' : '') + '</div></td></tr>';
        }).join('') + '</tbody></table></div>';
    } else if (tab === 'user') {
      const d = await api('/admin/users');
      const roleName = { tenant_admin: '系统总负责人', org_admin: '公司负责人', clerk: '资料员', auditor: '只读督察' };
      body = (isAdmin ? '<div class="toolbar" style="margin-bottom:12px"><button class="btn btn-primary" onclick="HZ.userForm()">' + HZ.icon.plus + '开通账号</button></div>' : '') +
        '<div class="table-wrap"><table class="tb"><thead><tr><th>登录账号</th><th>姓名</th><th>角色</th><th>所属公司</th><th>状态</th><th style="text-align:right">操作</th></tr></thead><tbody>' +
        d.rows.map(function (u) {
          return '<tr><td><b>' + esc(u.username) + '</b></td><td>' + esc(u.name) + '<div class="muted" style="font-size:11.5px">' + esc(u.title || '') + '</div></td>' +
            '<td><span class="chip ' + (u.role === 'tenant_admin' ? 'chip-green' : u.role === 'auditor' ? 'chip-gray' : 'chip-blue') + '">' + (roleName[u.role] || u.role) + '</span></td>' +
            '<td class="muted">' + esc(u.org_name || '全集团') + '</td>' +
            '<td>' + (u.status === 'active' ? '<span class="chip chip-green">正常</span>' : '<span class="chip chip-red">停用</span>') + '</td>' +
            '<td><div class="actions">' + (isAdmin
              ? '<button class="btn btn-sm" onclick="HZ.resetPwd(' + u.id + ',\'' + esc(u.username) + '\')">重置密码</button>' +
                '<button class="btn btn-sm btn-ghost" onclick="HZ.toggleUser(' + u.id + ',\'' + (u.status === 'active' ? 'disabled' : 'active') + '\')">' + (u.status === 'active' ? '停用' : '启用') + '</button>'
              : '') + '</div></td></tr>';
        }).join('') + '</tbody></table></div>';
    } else if (tab === 'sys') {
      const bk = await api('/admin/backups');
      const bkRows = (bk.rows || []).length
        ? bk.rows.slice(0, 6).map(function (b) {
            return '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px dashed var(--line-2);font-size:12.5px">' +
              '<span class="muted">' + esc(b.name) + '</span>' +
              '<span class="num" style="color:var(--faint)">' + Math.max(1, Math.round(b.size / 1024)) + ' KB</span></div>';
          }).join('')
        : '<div class="muted" style="font-size:12.5px;padding:6px 0">还没有备份记录</div>';

      body =
        '<div class="form-grid" style="gap:14px;align-items:start">' +
          '<div style="border:1px solid var(--line);border-radius:10px;padding:16px">' +
            '<div style="font-weight:650;margin-bottom:6px">数据备份</div>' +
            '<p class="muted" style="font-size:12.5px;margin:0 0 12px">把当前数据库和全部上传文件快照到 <code style="font-size:11.5px">data/backups/</code>。重置和清空操作会自动先备份一次。</p>' +
            '<button class="btn btn-primary" onclick="HZ.doBackup()">' + HZ.icon.download + '立即备份</button>' +
          '</div>' +
          '<div style="border:1px solid var(--line);border-radius:10px;padding:16px">' +
            '<div style="font-weight:650;margin-bottom:6px">最近备份</div>' + bkRows +
          '</div>' +
        '</div>' +

        '<div style="border:1px solid #f0d3d0;border-radius:10px;padding:16px;margin-top:16px">' +
          '<div style="font-weight:650;color:var(--red);margin-bottom:6px">危险操作</div>' +
          '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:12px">' +
            '<div style="flex:1;min-width:260px">' +
              '<div style="font-weight:600;font-size:13px">恢复演示数据</div>' +
              '<p class="muted" style="font-size:12px;margin:4px 0 10px">清空所有数据并恢复成出厂状态（4 家公司、8 个演示账号、2026 全年示例档案）。用于反复演示。</p>' +
              '<button class="btn btn-danger" onclick="HZ.confirmReset(\'demo\')">恢复演示数据</button>' +
            '</div>' +
            '<div style="flex:1;min-width:260px">' +
              '<div style="font-weight:600;font-size:13px">清空业务数据</div>' +
              '<p class="muted" style="font-size:12px;margin:4px 0 10px">删除全部归档任务、档案与上传文件，保留组织架构、分类规则和账号。用于从演示转入正式使用。</p>' +
              '<button class="btn btn-danger" onclick="HZ.confirmReset(\'clear\')">清空业务数据</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    } else {
      const d = await api('/admin/audit');
      body = '<div class="table-wrap"><table class="tb"><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>详情</th></tr></thead><tbody>' +
        d.rows.map(function (a) {
          return '<tr><td class="nowrap num muted">' + esc(a.created_at) + '</td><td class="nowrap">' + esc(a.actor_name || '-') + '</td>' +
            '<td><span class="chip chip-gray">' + esc(a.action) + '</span></td>' +
            '<td class="muted nowrap">' + esc(a.target_type) + '#' + a.target_id + '</td>' +
            '<td class="muted" style="max-width:420px;word-break:break-all;font-size:12px">' + esc((a.detail || '').slice(0, 160)) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    const inner = '<div class="page-head"><div><h1>配置</h1><p>组织、分类规则、账号权限与操作留痕' + (isAdmin ? '' : ' · 当前身份为只读') + '</p></div></div>' +
      tabs + '<div class="card"><div class="card-bd">' + body + '</div></div>';
    HZ.shell('settings', '基础数据', inner);
  };

  HZ.setTab = function (t) { S.setTab = t; HZ.pages.settings(); };

  /* ---- 组织表单 ---- */
  HZ.orgForm = async function (id) {
    const d = await api('/admin/orgs');
    const o = id ? d.rows.find(function (x) { return x.id === id; }) : null;
    HZ.modal(
      '<div class="modal-hd"><h3>' + (o ? '编辑单位' : '新增公司') + '</h3><button class="close-x" onclick="HZ.closeModal()">' + HZ.icon.x + '</button></div>' +
      '<div class="modal-bd"><div class="form-grid">' +
        '<div class="field full"><label>单位名称<span class="req">*</span></label><input class="input" id="f-name" value="' + esc(o ? o.name : '') + '" /></div>' +
        '<div class="field"><label>简称</label><input class="input" id="f-short" maxlength="8" value="' + esc(o ? o.short_name || '' : '') + '" /></div>' +
        '<div class="field"><label>类型</label><select class="select" id="f-type"><option value="company"' + (o && o.type === 'company' ? ' selected' : '') + '>公司</option><option value="group"' + (o && o.type === 'group' ? ' selected' : '') + '>集团/总部</option></select></div>' +
        (o ? '<div class="field"><label>状态</label><select class="select" id="f-status"><option value="active"' + (o.status === 'active' ? ' selected' : '') + '>启用</option><option value="disabled"' + (o.status !== 'active' ? ' selected' : '') + '>停用</option></select></div>' : '') +
      '</div></div>' +
      '<div class="modal-ft"><button class="btn" onclick="HZ.closeModal()">取消</button><button class="btn btn-primary" onclick="HZ.saveOrg(' + (o ? o.id : 0) + ')">保存</button></div>'
    );
  };

  HZ.saveOrg = async function (id) {
    const body = { name: val('f-name'), shortName: val('f-short'), type: val('f-type') };
    if (id) body.status = val('f-status');
    try {
      if (id) await api('/admin/orgs/' + id, { method: 'PATCH', body: body });
      else await api('/admin/orgs', { method: 'POST', body: body });
      HZ.closeModal(); HZ.toast('已保存', 'ok');
      S.meta = await api('/meta');
      HZ.pages.settings();
    } catch (e) { HZ.toast(e.message, 'err'); }
  };

  /* ---- 分类表单 ---- */
  HZ.catForm = async function (id) {
    const d = await api('/admin/categories');
    const c = id ? d.rows.find(function (x) { return x.id === id; }) : null;
    const orgs = (S.meta && S.meta.orgs) || [];
    const applies = c && c.appliesTo && c.appliesTo.length ? c.appliesTo : [];
    HZ.modal(
      '<div class="modal-hd"><h3>' + (c ? '编辑分类' : '新增资料分类') + '</h3><button class="close-x" onclick="HZ.closeModal()">' + HZ.icon.x + '</button></div>' +
      '<div class="modal-bd"><div class="form-grid">' +
        '<div class="field full"><label>分类名称<span class="req">*</span></label><input class="input" id="c-name" value="' + esc(c ? c.name : '') + '" /></div>' +
        '<div class="field"><label>归档频次</label><select class="select" id="c-freq">' +
          [['month', '每月'], ['quarter', '每季度'], ['half_year', '每半年'], ['year', '每年'], ['once', '一次性']].map(function (f) {
            return '<option value="' + f[0] + '"' + (c && c.frequency === f[0] ? ' selected' : '') + '>' + f[1] + '</option>';
          }).join('') + '</select></div>' +
        '<div class="field"><label>截止基准</label><select class="select" id="c-base">' +
          '<option value="period_end"' + (c && c.due_base === 'period_end' ? ' selected' : '') + '>期次结束</option>' +
          '<option value="period_start"' + (c && c.due_base === 'period_start' ? ' selected' : '') + '>期次开始</option></select></div>' +
        '<div class="field"><label>偏移天数</label><input class="input" type="number" id="c-offset" value="' + (c ? c.due_offset_days : 5) + '" /><div class="hint">负数表示提前，如 -11 = 期末前 11 天</div></div>' +
        '<div class="field"><label>提前提醒（天）</label><input class="input" type="number" id="c-remind" value="' + (c ? c.remind_days : 7) + '" /></div>' +
        '<div class="field full"><label>适用公司</label><div style="display:flex;flex-wrap:wrap;gap:10px">' +
          orgs.map(function (o) {
            return '<label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" class="c-org" value="' + o.id + '"' +
              (applies.indexOf(o.id) >= 0 ? ' checked' : '') + ' />' + esc(o.name) + '</label>';
          }).join('') + '</div><div class="hint">全部不勾选 = 适用于全部公司</div></div>' +
      '</div></div>' +
      '<div class="modal-ft"><button class="btn" onclick="HZ.closeModal()">取消</button><button class="btn btn-primary" onclick="HZ.saveCat(' + (c ? c.id : 0) + ')">保存</button></div>',
      { wide: true }
    );
  };

  HZ.saveCat = async function (id) {
    const appliesTo = Array.prototype.slice.call(document.querySelectorAll('.c-org')).filter(function (x) { return x.checked; }).map(function (x) { return +x.value; });
    const body = {
      name: val('c-name'), frequency: val('c-freq'), dueBase: val('c-base'),
      dueOffsetDays: num('c-offset'), remindDays: num('c-remind'), appliesTo: appliesTo,
    };
    try {
      if (id) await api('/admin/categories/' + id, { method: 'PATCH', body: body });
      else await api('/admin/categories', { method: 'POST', body: body });
      HZ.closeModal(); HZ.toast('已保存', 'ok');
      S.meta = await api('/meta');
      HZ.pages.settings();
    } catch (e) { HZ.toast(e.message, 'err'); }
  };

  /* ---- 账号 ---- */
  HZ.userForm = function () {
    const orgs = (S.meta && S.meta.orgs) || [];
    HZ.modal(
      '<div class="modal-hd"><h3>开通账号</h3><button class="close-x" onclick="HZ.closeModal()">' + HZ.icon.x + '</button></div>' +
      '<div class="modal-bd"><div class="form-grid">' +
        '<div class="field"><label>登录账号<span class="req">*</span></label><input class="input" id="u-username" placeholder="如 js_clerk" /></div>' +
        '<div class="field"><label>初始密码<span class="req">*</span></label><input class="input" id="u-pwd" placeholder="至少 6 位" /></div>' +
        '<div class="field"><label>姓名<span class="req">*</span></label><input class="input" id="u-name" /></div>' +
        '<div class="field"><label>岗位</label><input class="input" id="u-title" placeholder="如 环保资料员" /></div>' +
        '<div class="field"><label>角色</label><select class="select" id="u-role">' +
          '<option value="clerk">资料员（仅录入）</option><option value="org_admin">公司负责人（录入+审核）</option>' +
          '<option value="tenant_admin">系统总负责人（全部）</option><option value="auditor">只读督察</option></select></div>' +
        '<div class="field"><label>所属公司</label><select class="select" id="u-org"><option value="">—</option>' +
          orgs.map(function (o) { return '<option value="' + o.id + '">' + esc(o.name) + '</option>'; }).join('') + '</select></div>' +
      '</div><div class="hint" style="margin-top:10px">资料员只能录入本公司资料；负责人可审核；总负责人可管理全部公司。</div></div>' +
      '<div class="modal-ft"><button class="btn" onclick="HZ.closeModal()">取消</button><button class="btn btn-primary" onclick="HZ.saveUser()">开通</button></div>',
      { wide: true }
    );
  };

  HZ.saveUser = async function () {
    try {
      await api('/admin/users', { method: 'POST', body: {
        username: val('u-username'), password: val('u-pwd'), name: val('u-name'),
        title: val('u-title'), role: val('u-role'), orgId: val('u-org') || null,
      } });
      HZ.closeModal(); HZ.toast('账号已开通', 'ok'); HZ.pages.settings();
    } catch (e) { HZ.toast(e.message, 'err'); }
  };

  HZ.toggleUser = async function (id, status) {
    try { await api('/admin/users/' + id, { method: 'PATCH', body: { status: status } }); HZ.toast('已更新', 'ok'); HZ.pages.settings(); }
    catch (e) { HZ.toast(e.message, 'err'); }
  };

  HZ.resetPwd = function (id, username) {
    HZ.modal(
      '<div class="modal-hd"><h3>重置密码</h3><button class="close-x" onclick="HZ.closeModal()">' + HZ.icon.x + '</button></div>' +
      '<div class="modal-bd"><div class="field"><label>账号</label><input class="input" value="' + esc(username) + '" disabled /></div>' +
      '<div class="field" style="margin-top:12px"><label>新密码<span class="req">*</span></label><input class="input" id="rp-pwd" placeholder="至少 6 位" /></div></div>' +
      '<div class="modal-ft"><button class="btn" onclick="HZ.closeModal()">取消</button><button class="btn btn-primary" onclick="HZ.doResetPwd(' + id + ')">确认重置</button></div>'
    );
  };

  HZ.doResetPwd = async function (id) {
    try { await api('/admin/users/' + id + '/reset', { method: 'POST', body: { password: val('rp-pwd') } }); HZ.closeModal(); HZ.toast('密码已重置', 'ok'); }
    catch (e) { HZ.toast(e.message, 'err'); }
  };

  /* ---- 系统维护 ---- */
  HZ.doBackup = async function () {
    try {
      const r = await api('/admin/backup', { method: 'POST', body: {} });
      HZ.toast('已备份：' + r.dir, 'ok');
      HZ.pages.settings();
    } catch (e) { HZ.toast(e.message, 'err'); }
  };

  HZ.confirmReset = function (mode) {
    const isClear = mode === 'clear';
    const need = isClear ? '确认清空' : '确认重置';
    HZ.modal(
      '<div class="modal-hd"><h3>' + (isClear ? '清空业务数据' : '恢复演示数据') + '</h3>' +
      '<button class="close-x" onclick="HZ.closeModal()">' + HZ.icon.x + '</button></div>' +
      '<div class="modal-bd">' +
        '<div style="background:var(--red-soft);color:var(--red);font-size:12.5px;padding:10px 12px;border-radius:8px;line-height:1.6">' +
          (isClear
            ? '将删除全部归档任务、档案记录和上传文件。<b>组织架构、分类规则和账号会保留</b>，并按规则重新生成当年任务。'
            : '将清空所有数据（含账号），恢复成出厂演示状态：4 家公司、8 个演示账号、2026 全年示例档案。<b>当前登录会失效</b>。') +
          '<br/>执行前会自动备份一份。' +
        '</div>' +
        '<div class="field" style="margin-top:16px"><label>请输入「' + need + '」以确认</label>' +
          '<input class="input" id="rs-confirm" placeholder="' + need + '" autocomplete="off" /></div>' +
      '</div>' +
      '<div class="modal-ft"><button class="btn" onclick="HZ.closeModal()">取消</button>' +
      '<button class="btn btn-danger" onclick="HZ.doReset(\'' + mode + '\')">' + need + '</button></div>'
    );
  };

  HZ.doReset = async function (mode) {
    const txt = (document.getElementById('rs-confirm') || {}).value || '';
    try {
      await api('/admin/reset', { method: 'POST', body: { mode: mode, confirm: txt.trim() } });
      HZ.closeModal();
      if (mode === 'demo') {
        HZ.toast('已恢复演示数据，请用 admin / admin123 重新登录', 'ok');
        setTimeout(function () { HZ.logout(true); }, 1000);
      } else {
        HZ.toast('业务数据已清空，任务已按规则重新生成', 'ok');
        HZ.pages.settings();
      }
    } catch (e) { HZ.toast(e.message, 'err'); }
  };
})();
