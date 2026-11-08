/* 环智存 · 前端核心 */
(function () {
  'use strict';

  const HZ = (window.HZ = {
    state: {
      token: localStorage.getItem('hzc_token') || '',
      user: null, me: null, meta: null,
      wbOrg: '',
    },
    pages: {},
  });
  const S = HZ.state;

  /* ---------------- 基础工具 ---------------- */
  HZ.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const esc = HZ.esc;
  HZ.$ = (sel, root) => (root || document).querySelector(sel);
  HZ.pct = (v) => Math.round((v || 0) * 100) + '%';

  HZ.api = async function (path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if (S.token) headers.Authorization = 'Bearer ' + S.token;
    let body = opts.body;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const res = await fetch('/api' + path, { method: opts.method || 'GET', headers: headers, body: body });
    if (res.status === 401) { HZ.logout(true); throw new Error('登录已过期，请重新登录'); }
    if (!res.ok) {
      let msg = '请求失败';
      try { const j = await res.json(); msg = j.error || msg; } catch (e) {}
      throw new Error(msg);
    }
    return res.json();
  };

  HZ.download = async function (path, fallbackName) {
    const res = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + S.token } });
    if (!res.ok) { HZ.toast('下载失败', 'err'); return; }
    const blob = await res.blob();
    let name = fallbackName;
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    if (m) name = decodeURIComponent(m[1]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name || 'download';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };

  HZ.toast = function (msg, type) {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (type === 'err' ? 'err' : type === 'ok' ? 'ok' : '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; el.style.transition = '.3s'; }, 2300);
    setTimeout(function () { el.remove(); }, 2700);
  };

  HZ.modal = function (html, opts) {
    opts = opts || {};
    const root = document.getElementById('modal-root');
    root.innerHTML = '<div class="modal-backdrop"><div class="modal ' + (opts.wide ? 'wide' : '') + '">' + html + '</div></div>';
    const bd = root.firstElementChild;
    bd.addEventListener('mousedown', function (e) { if (e.target === bd) HZ.closeModal(); });
  };
  HZ.closeModal = function () { document.getElementById('modal-root').innerHTML = ''; };

  /* ---------------- 图标 ---------------- */
  const svg = (p, extra) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ' + (extra || '') + '>' + p + '</svg>';
  HZ.icon = {
    home: svg('<rect x="3" y="3" width="7.5" height="9" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.6"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.6"/><rect x="3" y="15" width="7.5" height="6" rx="1.6"/>'),
    folder: svg('<path d="M3 7.5A2 2 0 0 1 5 5.5h3.6a2 2 0 0 1 1.5.7l1 1.3H19a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
    chart: svg('<path d="M3.5 20.5h17"/><rect x="5" y="12" width="3.2" height="8.5" rx="1"/><rect x="10.4" y="6.5" width="3.2" height="14" rx="1"/><rect x="15.8" y="14.5" width="3.2" height="6" rx="1"/>'),
    settings: svg('<path d="M4 7h7M15 7h5M4 12h3M11 12h9M4 17h9M17 17h3"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="17" r="2"/>'),
    bell: svg('<path d="M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 6.5-2.5 8.5h17c0-2-2.5-2-2.5-8.5Z"/><path d="M13.8 20.5a2 2 0 0 1-3.6 0"/>'),
    upload: svg('<path d="M12 16V4.5m0 0L7.5 9M12 4.5 16.5 9"/><path d="M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2"/>'),
    download: svg('<path d="M12 4.5V16m0 0 4.5-4.5M12 16l-4.5-4.5"/><path d="M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.8-3.8"/>'),
    check: svg('<path d="m4.5 12.5 5 5 10-11"/>'),
    x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    logout: svg('<path d="M9.5 20.5h-3a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3"/><path d="m16 16.5 4.5-4.5L16 7.5"/><path d="M20 12H9.5"/>'),
    file: svg('<path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8Z"/><path d="M14 2.5V8h5.5"/>'),
    clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>'),
    alert: svg('<path d="M10.4 4.2 2.6 17.8a1.9 1.9 0 0 0 1.6 2.8h15.6a1.9 1.9 0 0 0 1.6-2.8L13.6 4.2a1.9 1.9 0 0 0-3.2 0Z"/><path d="M12 9.5v4M12 17h.01"/>'),
    empty: svg('<path d="M3 7.5A2 2 0 0 1 5 5.5h3.6a2 2 0 0 1 1.5.7l1 1.3H19a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M8 12h8"/>'),
    users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18.5 20c0-2.4-1.1-4.2-3-5.2"/>'),
    building: svg('<rect x="4" y="3.5" width="16" height="17" rx="1.6"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M10 20.5v-4h4v4"/>'),
    history: svg('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5V9H8"/><path d="M12 8v4.2l2.8 1.7"/>'),
  };

  /* ---------------- 登录 ---------------- */
  const DEMO = [
    ['admin', 'admin123', '集团总负责人', '可查看全部公司'],
    ['gx_clerk', '123456', '资料员', '总部 · 仅录入'],
    ['js_clerk', '123456', '资料员', '建设公司 · 仅录入'],
    ['gx_admin', '123456', '公司负责人', '总部 · 录入+审核'],
    ['auditor', '123456', '外部督察', '全部只读'],
  ];

  function renderLogin(err) {
    document.getElementById('app').innerHTML =
      '<div class="login-wrap"><div class="login-card">' +
        '<div class="login-aside">' +
          '<div class="login-brand"><div class="brand-mark">环</div><div><div class="brand-name" style="color:#fff">环智存</div><div class="brand-sub" style="color:rgba(255,255,255,.6)">HUANZHICUN</div></div></div>' +
          '<div><h2>环保台账归档<br/>与合规管理平台</h2>' +
          '<p>把"要交什么、什么时候交"变成规则，系统自动生成应归档清单。</p>' +
          '<ul class="login-points">' +
            '<li>' + HZ.icon.check + '<span>按频次自动生成任务，不再靠人催</span></li>' +
            '<li>' + HZ.icon.check + '<span>逾期标红、临期标黄，一屏看全集团</span></li>' +
            '<li>' + HZ.icon.check + '<span>上传—审核—归档—留痕，督察时可举证</span></li>' +
          '</ul></div>' +
          '<div style="font-size:11.5px;color:rgba(255,255,255,.45)">© 2026 环智存 · v0.1</div>' +
        '</div>' +
        '<div class="login-form">' +
          '<h3>登录</h3><div class="sub">请输入账号密码，角色由系统分配</div>' +
          (err ? '<div class="login-err">' + esc(err) + '</div>' : '') +
          '<div class="field"><label>账号</label><input class="input" id="lg-user" autocomplete="username" placeholder="请输入登录账号" /></div>' +
          '<div class="field"><label>密码</label><input class="input" id="lg-pwd" type="password" autocomplete="current-password" placeholder="请输入密码" /></div>' +
          '<button class="btn btn-primary" style="height:40px;margin-top:6px" onclick="HZ.doLogin()">登 录</button>' +
          '<div style="text-align:center;margin-top:14px;font-size:12.5px;color:var(--muted)">还没有账号？' +
            '<a onclick="HZ.showRegister()" style="cursor:pointer;font-weight:600">注册企业试用 →</a></div>' +
          '<div class="demo-accounts"><div class="t">演示账号（点击自动填充）</div>' +
            DEMO.map(function (d) {
              return '<div class="demo-chip" onclick="HZ.fillLogin(\'' + d[0] + '\',\'' + d[1] + '\')"><b>' + d[0] + '</b><span class="role">' + d[2] + ' · ' + d[3] + '</span></div>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div></div>';

    const pwd = document.getElementById('lg-pwd');
    pwd.addEventListener('keydown', function (e) { if (e.key === 'Enter') HZ.doLogin(); });
  }

  HZ.fillLogin = function (u, p) {
    document.getElementById('lg-user').value = u;
    document.getElementById('lg-pwd').value = p;
  };

  async function enterApp(token, greeting) {
    S.token = token;
    localStorage.setItem('hzc_token', token);
    const me = await HZ.api('/me');
    S.me = me; S.user = me.user;
    S.meta = await HZ.api('/meta');
    startRouter();
    if (greeting) HZ.toast(greeting, 'ok');
  }
  HZ.enterApp = enterApp;

  HZ.doLogin = async function () {
    const u = document.getElementById('lg-user').value.trim();
    const p = document.getElementById('lg-pwd').value;
    if (!u || !p) return HZ.toast('请输入账号和密码', 'err');
    try {
      const r = await HZ.api('/login', { method: 'POST', body: { username: u, password: p } });
      await enterApp(r.token, '欢迎回来，' + r.user.name);
    } catch (e) {
      renderLogin(e.message);
    }
  };

  /* ---------------- 企业注册 ---------------- */
  HZ.showRegister = function () {
    if (location.hash !== '#/register') history.replaceState(null, '', '#/register');
    renderRegister();
  };
  HZ.backToLogin = function () {
    history.replaceState(null, '', '#/');
    renderLogin();
  };

  function renderRegister(err) {
    document.getElementById('app').innerHTML =
      '<div class="login-wrap"><div class="login-card">' +
        '<div class="login-aside">' +
          '<div class="login-brand"><div class="brand-mark">环</div><div><div class="brand-name" style="color:#fff">环智存</div><div class="brand-sub" style="color:rgba(255,255,255,.6)">HUANZHICUN</div></div></div>' +
          '<div><h2>创建你的<br/>企业台账空间</h2>' +
          '<p>注册后系统会自动为你建好：</p>' +
          '<ul class="login-points">' +
            '<li>' + HZ.icon.check + '<span>组织架构（集团 + 总部）</span></li>' +
            '<li>' + HZ.icon.check + '<span>8 类环保台账分类与截止规则</span></li>' +
            '<li>' + HZ.icon.check + '<span>2026 年度全部应归档任务</span></li>' +
            '<li>' + HZ.icon.check + '<span>你的管理员账号，可直接登录</span></li>' +
          '</ul></div>' +
          '<div style="font-size:11.5px;color:rgba(255,255,255,.45)">新注册企业含 30 天试用期</div>' +
        '</div>' +
        '<div class="login-form">' +
          '<h3>注册企业</h3><div class="sub">注册人自动成为该企业的系统总负责人</div>' +
          (err ? '<div class="login-err">' + esc(err) + '</div>' : '') +
          '<div class="field"><label>企业名称<span class="req">*</span></label><input class="input" id="rg-company" placeholder="如：某某环保集团有限公司" /></div>' +
          '<div class="field"><label>你的姓名<span class="req">*</span></label><input class="input" id="rg-name" placeholder="如：张海涛" /></div>' +
          '<div class="field"><label>登录账号<span class="req">*</span></label><input class="input" id="rg-user" placeholder="3-20 位字母、数字或下划线" /></div>' +
          '<div class="field"><label>设置密码<span class="req">*</span></label><input class="input" id="rg-pwd" type="password" placeholder="至少 6 位" /></div>' +
          '<div class="field"><label>确认密码<span class="req">*</span></label><input class="input" id="rg-pwd2" type="password" placeholder="再输一次" /></div>' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-2);margin:4px 0 14px;cursor:pointer">' +
            '<input type="checkbox" id="rg-demo" checked /> 预填演示数据（方便直接看到效果，可随时清空）</label>' +
          '<button class="btn btn-primary" style="height:40px" onclick="HZ.doRegister()">创建企业空间</button>' +
          '<div style="text-align:center;margin-top:14px;font-size:12.5px;color:var(--muted)">' +
            '<a onclick="HZ.backToLogin()" style="cursor:pointer">← 已有账号，返回登录</a></div>' +
        '</div>' +
      '</div></div>';
  }

  HZ.doRegister = async function () {
    const g = (id) => document.getElementById(id).value.trim();
    const company = g('rg-company');
    const name = g('rg-name');
    const username = g('rg-user');
    const pwd = document.getElementById('rg-pwd').value;
    const pwd2 = document.getElementById('rg-pwd2').value;

    if (!company) return renderRegister('请填写企业名称');
    if (!name) return renderRegister('请填写你的姓名');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return renderRegister('登录账号需为 3-20 位字母、数字或下划线');
    if (pwd.length < 6) return renderRegister('密码至少 6 位');
    if (pwd !== pwd2) return renderRegister('两次输入的密码不一致');

    const withDemo = document.getElementById('rg-demo').checked;
    try {
      const r = await HZ.api('/register', { method: 'POST', body: { company, name, username, password: pwd, withDemo } });
      await enterApp(r.token, '企业空间已创建');
      HZ.welcomeModal(company);
    } catch (e) {
      renderRegister(e.message);
    }
  };

  HZ.welcomeModal = function (company) {
    HZ.modal(
      '<div class="modal-hd"><h3>' + esc(company) + ' 的空间已就绪</h3></div>' +
      '<div class="modal-bd">' +
        '<p style="margin-top:0;color:var(--muted);font-size:13px">系统已经帮你建好了组织架构、8 类环保台账分类，以及 2026 年度的全部应归档任务。接下来：</p>' +
        '<div style="display:flex;flex-direction:column;gap:12px;margin:16px 0">' +
          '<div style="display:flex;gap:10px"><div class="rank-no">1</div><div><b>添加下属公司</b><div class="muted" style="font-size:12px">配置 → 组织与公司 → 新增公司</div></div></div>' +
          '<div style="display:flex;gap:10px"><div class="rank-no">2</div><div><b>邀请同事</b><div class="muted" style="font-size:12px">配置 → 成员与权限 → 开通账号（资料员 / 公司负责人）</div></div></div>' +
          '<div style="display:flex;gap:10px"><div class="rank-no">3</div><div><b>上传第一批资料</b><div class="muted" style="font-size:12px">工作台 → 待办提醒 → 直接点「上传」</div></div></div>' +
        '</div>' +
        '<div class="login-err" style="background:var(--amber-soft);color:var(--amber)">提醒：演示数据只用于体验，正式使用前请在「配置 → 系统与维护」中清空。</div>' +
      '</div>' +
      '<div class="modal-ft"><button class="btn btn-primary" onclick="HZ.closeModal()">开始使用</button></div>'
    );
  };

  HZ.logout = function (force) {
    if (!force && S.token) HZ.api('/logout', { method: 'POST' }).catch(function () {});
    localStorage.removeItem('hzc_token');
    S.token = ''; S.user = null; S.me = null; S.meta = null;
    S.wbOrg = '';
    renderLogin();
  };

  /* ---------------- 外壳 ---------------- */
  const NAV = [
    ['workbench', '工作台', 'home'],
    ['ledger', '台账', 'folder'],
    ['stats', '进度统计', 'chart'],
    ['settings', '配置', 'settings'],
  ];
  const TITLES = { workbench: '工作台', ledger: '台账', stats: '进度统计', settings: '配置' };

  HZ.shell = function (active, sub, inner) {
    const u = S.user || {};
    const me = S.me || {};
    const initials = (u.name || 'U').slice(-2);
    const unread = me.unread || 0;
    const roleName = { tenant_admin: '系统总负责人', org_admin: '公司负责人', clerk: '资料员', auditor: '只读督察' }[u.role] || u.role;

    const capsOf = (S.me && S.me.caps) || {};
    const navList = NAV.filter(function (n) { return n[0] !== 'settings' || capsOf.admin; });
    const navHtml = navList.map(function (n) {
      const badge = n[0] === 'ledger' && me.pendingReview ? '<span class="nav-badge">' + me.pendingReview + '</span>' : '';
      return '<div class="nav-item ' + (active === n[0] ? 'active' : '') + '" onclick="HZ.go(\'' + n[0] + '\')">' +
        HZ.icon[n[2]] + '<span>' + n[1] + '</span>' + badge + '</div>';
    }).join('');

    document.getElementById('app').innerHTML =
      '<div class="shell">' +
        '<aside class="side">' +
          '<div class="brand"><div class="brand-mark">环</div><div class="brand-text"><div class="brand-name">环智存</div><div class="brand-sub">环保台账合规平台</div></div></div>' +
          '<nav class="nav">' +
            '<div class="nav-label">业务</div>' + navHtml +
            '<div class="nav-label">账号</div>' +
            '<div class="nav-item" onclick="HZ.logout()">' + HZ.icon.logout + '<span>退出登录</span></div>' +
          '</nav>' +
          '<div class="side-foot"><div class="tenant-box"><div class="avatar" style="background:#e8f1ec;color:#1e8e5a">' + (me.tenant ? me.tenant.name.slice(0, 1) : '环') + '</div>' +
            '<div style="min-width:0"><div class="t-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(me.tenant ? me.tenant.name : '') + '</div>' +
            '<div class="t-sub">' + esc(roleName) + '</div></div></div></div>' +
        '</aside>' +
        '<div class="main">' +
          '<header class="top">' +
            '<div class="top-title">' + (TITLES[active] || '') + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>' +
            '<div class="top-actions">' +
              '<div style="position:relative">' +
                '<button class="icon-btn" onclick="HZ.toggleNotif(event)">' + HZ.icon.bell +
                  (unread ? '<span class="dot num">' + (unread > 99 ? '99+' : unread) + '</span>' : '') + '</button>' +
                '<div id="notif-panel"></div>' +
              '</div>' +
              '<div class="user-chip" onclick="HZ.go(\'settings\')">' +
                '<div class="avatar">' + esc(initials) + '</div>' +
                '<div class="user-meta"><b>' + esc(u.name || '') + '</b><span>' + esc(roleName) + ' · ' + esc((me.org && me.org.name) || '全集团') + '</span></div>' +
              '</div>' +
            '</div>' +
          '</header>' +
          '<div class="content" id="view">' + inner + '</div>' +
        '</div>' +
      '</div>';
  };

  HZ.go = function (name) {
    if (location.hash === '#/' + name) { route(); return; }
    location.hash = '#/' + name;
  };

  /* ---------------- 通知 ---------------- */
  HZ.toggleNotif = async function (e) {
    if (e) e.stopPropagation();
    const p = document.getElementById('notif-panel');
    if (!p) return;
    if (p.innerHTML) { p.innerHTML = ''; return; }
    p.innerHTML = '<div class="notif-panel"><div class="notif-hd">通知中心</div><div class="notif-list"><div class="notif-empty">加载中…</div></div></div>';
    try {
      const d = await HZ.api('/notifications');
      const rows = d.rows || [];
      p.innerHTML = '<div class="notif-panel">' +
        '<div class="notif-hd"><span>通知中心' + (d.unread ? ' · ' + d.unread + ' 条未读' : '') + '</span>' +
        '<button class="btn btn-ghost btn-sm" onclick="HZ.markAllRead()">全部已读</button></div>' +
        '<div class="notif-list">' +
        (rows.length ? rows.map(function (n) {
          const cls = n.type === 'task_overdue' ? 'red' : n.type === 'task_due' ? 'amber' : 'blue';
          const ic = n.type === 'task_overdue' ? HZ.icon.alert : n.type === 'task_due' ? HZ.icon.clock : HZ.icon.check;
          return '<div class="notif-item ' + (n.read_at ? '' : 'unread') + '" onclick="HZ.notifClick(' + n.id + ',\'' + (n.ref_type || '') + '\',' + (n.ref_id || 0) + ')">' +
            '<div class="notif-ico ' + cls + '">' + ic + '</div>' +
            '<div style="min-width:0"><div class="notif-t">' + esc(n.title) + '</div><div class="notif-b">' + esc(n.body) + '</div></div></div>';
        }).join('') : '<div class="notif-empty">暂无通知</div>') +
        '</div></div>';
    } catch (err) {
      p.innerHTML = '<div class="notif-panel"><div class="notif-empty">' + esc(err.message) + '</div></div>';
    }
  };

  HZ.markAllRead = async function () {
    await HZ.api('/notifications/read', { method: 'POST', body: {} });
    if (S.me) S.me.unread = 0;
    const p = document.getElementById('notif-panel');
    if (p) p.innerHTML = '';
    route();
  };

  HZ.notifClick = function (id, refType, refId) {
    HZ.api('/notifications/read', { method: 'POST', body: { ids: [id] } }).catch(function () {});
    HZ.toggleNotif();
    if (refType === 'document') { if (HZ.openDoc) HZ.openDoc(refId); }
    else { HZ.go('ledger'); }
  };

  /* ---------------- 工作台 ---------------- */
  HZ.setWbOrg = function (v) { S.wbOrg = v; HZ.pages.workbench(); };

  HZ.pages.workbench = async function () {
    const q = S.wbOrg ? '?orgId=' + S.wbOrg : '';
    const d = await HZ.api('/workbench' + q);
    const k = d.kpi;
    const orgs = (S.meta && S.meta.orgs) || [];

    const orgSelect = '<select class="select" style="min-width:180px" onchange="HZ.setWbOrg(this.value)">' +
      '<option value="">全部公司（汇总）</option>' +
      orgs.map(function (o) { return '<option value="' + o.id + '"' + (String(S.wbOrg) === String(o.id) ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('') +
      '</select>';

    const kpis =
      '<div class="kpi"><div class="k-label">本月应归档</div><div class="k-value">' + k.monthTotal + '<small>项</small></div><div class="k-sub">' + d.year + ' 年 ' + d.month + ' 月到期</div></div>' +
      '<div class="kpi"><div class="k-label">本月已归档</div><div class="k-value green">' + k.monthDone + '<small>项</small></div><div class="k-sub">待审核 ' + k.pendingReview + ' 项</div></div>' +
      '<div class="kpi accent"><div class="k-label">本月归档率</div><div class="k-value green">' + HZ.pct(k.monthRate) + '</div><div class="k-sub">已归档 ÷ 应归档（按任务计数）</div></div>' +
      '<div class="kpi"><div class="k-label">年度归档率</div><div class="k-value">' + HZ.pct(k.yearRate) + '</div><div class="k-sub">' + k.yearDone + ' / ' + k.yearTotal + ' 项</div></div>' +
      '<div class="kpi ' + (k.overdue ? 'danger' : '') + '"><div class="k-label">待办事项</div><div class="k-value ' + (k.overdue ? 'red' : '') + '">' + (k.overdue + k.dueSoon) + '<small>项</small></div><div class="k-sub">逾期 ' + k.overdue + ' · 临期 ' + k.dueSoon + '</div></div>';

    const activeProgress = d.progress.filter(function (p) { return p.total > 0; });
    const idleCount = d.progress.length - activeProgress.length;
    const bars = activeProgress.map(function (p) {
      const rate = p.total ? p.done / p.total : 0;
      let cls = 'bar-fill';
      if (!p.total) cls += ' zero';
      else if (rate >= 1) cls += '';
      else if (rate >= 0.5) cls += ' amber';
      else cls += ' red';
      let chip = '';
      if (!p.total) chip = '<span class="chip chip-gray">本月无需归档</span>';
      else if (p.overdue) chip = '<span class="chip chip-red"><i class="chip-dot"></i>逾期 ' + p.overdue + ' 家</span>';
      else if (p.dueSoon) chip = '<span class="chip chip-amber"><i class="chip-dot"></i>临期 ' + p.dueSoon + ' 家</span>';
      else if (rate >= 1) chip = '<span class="chip chip-green"><i class="chip-dot"></i>已完成</span>';

      return '<div class="bar-item">' +
        '<div class="bar-head"><div class="bar-title">' + esc(p.name) + chip + '</div>' +
        '<div class="bar-frac"><b>' + p.done + '</b> / ' + p.total + ' · ' + HZ.pct(rate) + '</div></div>' +
        '<div class="bar-track"><div class="' + cls + '" style="width:' + (rate * 100) + '%"></div></div></div>';
    }).join('');

    const rank = d.orgRates.slice().sort(function (a, b) { return b.rate - a.rate; }).map(function (o, i) {
      return '<div class="rank-row"><div class="rank-no">' + (i + 1) + '</div>' +
        '<div class="rank-name">' + esc(o.name) + '</div>' +
        '<div class="rank-bar"><i style="width:' + (o.rate * 100) + '%;background:' + (o.rate >= 0.8 ? '#1e8e5a' : o.rate >= 0.6 ? '#c98a10' : '#cf4034') + '"></i></div>' +
        '<div class="rank-val">' + HZ.pct(o.rate) + '</div></div>';
    }).join('');

    const todos = d.todos.length ? d.todos.slice(0, 8).map(function (t) {
      const isOd = t.state === 'overdue';
      return '<div class="todo-row">' +
        '<span class="chip ' + (isOd ? 'chip-red' : 'chip-amber') + '">' + (isOd ? '逾期' + Math.abs(t.days_left) + '天' : '剩' + t.days_left + '天') + '</span>' +
        '<div class="todo-main"><div class="todo-title">' + esc(t.title) + '</div>' +
        '<div class="todo-sub">' + esc(t.org_name) + ' · 截止 ' + esc(t.due_date) + '</div></div>' +
        '<button class="btn btn-sm btn-soft" onclick="HZ.openUploadByTask(' + t.id + ')">上传</button></div>';
    }).join('') : '<div class="empty" style="padding:26px">' + HZ.icon.check + '<p>暂无逾期或临期事项</p><span>所有任务都在计划内</span></div>';

    const totalDocs = d.distribution.reduce(function (s, x) { return s + x.count; }, 0);
    const dist = d.distribution.length ? d.distribution.map(function (x) {
      const w = totalDocs ? (x.count / totalDocs) * 100 : 0;
      return '<div class="bar-item" style="padding:6px 0"><div class="bar-head" style="margin-bottom:4px">' +
        '<div class="bar-title" style="font-size:12.5px;font-weight:500">' + esc(x.name) + '</div>' +
        '<div class="bar-frac" style="font-size:12px">' + x.count + ' 项 · ' + Math.round(w) + '%</div></div>' +
        '<div class="bar-track" style="height:5px"><div class="bar-fill" style="width:' + w + '%"></div></div></div>';
    }).join('') : '<div class="empty" style="padding:26px">' + HZ.icon.empty + '<p>本年度还没有归档记录</p></div>';

    const inner =
      '<div class="page-head"><div><h1>工作台</h1><p>今天是 ' + esc(d.today) + ' · 当前查看：' + (S.wbOrg ? esc((orgs.find(function (o) { return String(o.id) === String(S.wbOrg); }) || {}).name || '本公司') : '全部公司（' + d.orgCount + ' 家汇总）') + '</p></div>' +
        '<div class="toolbar">' + orgSelect +
        '<button class="btn btn-primary" onclick="HZ.openUpload()">' + HZ.icon.upload + '上传资料</button></div></div>' +
      '<div class="kpi-row">' + kpis + '</div>' +
      '<div class="wb-grid">' +
        '<div class="stack">' +
          '<div class="card"><div class="card-hd"><h3>本月资料进度 <span class="sub">按截止日期落在本月统计</span></h3>' +
          '<button class="btn btn-ghost btn-sm" onclick="HZ.go(\'stats\')">查看统计 →</button></div>' +
          '<div class="card-bd" style="padding-top:6px">' + (bars || '<div class="empty" style="padding:22px">' + HZ.icon.check + '<p>本月没有到期任务</p></div>') +
          (idleCount ? '<div class="muted" style="font-size:12px;padding:8px 0 2px;border-top:1px dashed var(--line-2);margin-top:6px">另有 ' + idleCount + ' 个分类本月无需归档</div>' : '') + '</div></div>' +
          '<div class="card"><div class="card-hd"><h3>资料分类分布 <span class="sub">' + d.year + ' 年已归档</span></h3></div>' +
          '<div class="card-bd" style="padding-top:10px">' + dist + '</div></div>' +
        '</div>' +
        '<div class="stack">' +
          '<div class="card"><div class="card-hd"><h3>待办提醒</h3><button class="btn btn-ghost btn-sm" onclick="HZ.go(\'ledger\')">全部待办 →</button></div>' +
          '<div class="card-bd" style="padding-top:6px">' + todos + '</div></div>' +
          '<div class="card"><div class="card-hd"><h3>各公司年度归档率</h3></div>' +
          '<div class="card-bd" style="padding-top:8px">' + rank + '</div></div>' +
        '</div>' +
      '</div>';

    HZ.shell('workbench', d.today, inner);
  };

  /* ---------------- 路由 ---------------- */
  function route() {
    const raw = (location.hash || '').replace(/^#\/?/, '') || 'workbench';
    const name = raw.split('?')[0] || 'workbench';
    const fn = HZ.pages[name];
    if (!fn) { location.hash = '#/workbench'; return; }
    Promise.resolve()
      .then(fn)
      .catch(function (e) {
        if (String(e.message || '').indexOf('登录') === -1) HZ.toast(e.message || '页面加载失败', 'err');
      });
  }

  function startRouter() {
    window.addEventListener('hashchange', route);
    if (!location.hash) history.replaceState(null, '', '#/workbench');
    route();
  }

  HZ.refresh = route;

  /* ---------------- 启动 ---------------- */
  (async function boot() {
    if (!S.token) {
      if (location.hash === '#/register') renderRegister();
      else renderLogin();
      return;
    }
    try {
      const me = await HZ.api('/me');
      S.me = me; S.user = me.user;
      S.meta = await HZ.api('/meta');
      startRouter();
    } catch (e) {
      S.token = '';
      localStorage.removeItem('hzc_token');
      renderLogin();
    }
  })();
})();
