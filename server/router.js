'use strict';
// 极简路由：/api/documents/:id 风格
class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/\/:([A-Za-z_]+)/g, (_, k) => {
          keys.push(k);
          return '/([^/]+)';
        }) +
        '$'
    );
    this.routes.push({ method: method.toUpperCase(), re, keys, handler });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  del(p, h) { return this.add('DELETE', p, h); }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method.toUpperCase()) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { handler: r.handler, params };
    }
    return null;
  }
}

module.exports = { Router };
