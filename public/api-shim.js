/* GitHub Pages has no server, so on *.github.io every /api call is sent to the NERO Caffe API workflow on n8n.
   Anywhere else (Render, localhost) this file does nothing and the Express server answers as before.
   To try the n8n backend from localhost: localStorage.setItem("nero-n8n", "1") and reload. */
(function () {
  var API = "https://n8n.luvias.in/webhook/nero-api";
  var on = /\.github\.io$/.test(location.hostname);
  try { if (localStorage.getItem("nero-n8n") === "1") on = true; } catch (e) {}
  if (!on || !window.fetch) return;
  window.NERO_N8N = true; // the back office shows its change-password form only on this backend

  var TOKEN_KEY = "nero-admin-token";
  var real = window.fetch.bind(window);
  var token = {
    get: function () { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } },
    set: function (v) { try { localStorage.setItem(TOKEN_KEY, v); } catch (e) {} },
    clear: function () { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} },
  };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // The text/plain body keeps this a "simple" cross-origin request, so the browser sends no preflight.
  // n8n answers retry:true when two people saved at the same moment; trying again picks up the fresh data.
  function call(envelope, attempt) {
    return real(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(envelope), credentials: "omit", cache: "no-store" })
      .then(function (res) { return res.json(); })
      .then(function (out) {
        if (out && out.retry && attempt < 5) return wait(150 + Math.random() * 400 * (attempt + 1)).then(function () { return call(envelope, attempt + 1); });
        return out;
      });
  }

  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf("/api/") !== 0) return real(input, init);
    init = init || {};
    var parsed = new URL(url, location.href), query = {}, body = {};
    parsed.searchParams.forEach(function (v, k) { query[k] = v; });
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch (e) {} }
    var path = parsed.pathname;
    return call({ m: String(init.method || "GET").toUpperCase(), p: path, q: query, b: body, t: token.get() }, 0).then(function (out) {
      var status = Number(out && out.s) || 500, data = (out && out.b) || {};
      if (data.token && (path === "/api/admin/login" || path === "/api/admin/password")) token.set(data.token);
      if (path === "/api/admin/logout" || (status === 401 && path !== "/api/admin/login")) token.clear();
      if (data.token) { data = Object.assign({}, data); delete data.token; } // page code never needs to see the token
      return new Response(JSON.stringify(data), { status: status, headers: { "Content-Type": "application/json" } });
    });
  };
})();
