// Luma preview reporter (classic script, loaded before main.js so it also sees module/import failures).
// Collects what happens in the page — build errors, files that failed to load, console errors/warnings — and
// sends it (1) to the Studio UI when the page is in the Preview tab (postMessage) and (2) to the Studio server
// (POST <page dir>/__luma/report), also when the preview is opened in its own tab, so the agent can read it
// with check_preview. Rendering/check servers ignore the report (no /p/ prefix → nothing is sent).
(function () {
  var dir = location.pathname.replace(/[^/]*$/, '');
  var serverOk = /^\/p\/[^/]+\/[^/]+\/$/.test(dir);
  var endpoint = dir + '__luma/report';
  var where = window.parent !== window ? 'preview' : 'tab';
  var queue = [];
  var timer = null;
  var sent = 0;

  function post(body) {
    if (!serverOk) return;
    try {
      body.where = where;
      fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(function () {});
    } catch (e) { /* ignore */ }
  }
  function flush() {
    timer = null;
    if (!queue.length) return;
    post({ logs: queue.splice(0, 50) });
  }
  function log(level, text) {
    text = String(text).slice(0, 1000);
    if (sent++ > 300) return; // don't flood
    queue.push({ level: level, text: text });
    try { parent.postMessage({ source: 'luma-preview', type: 'log', level: level, text: text }, '*'); } catch (e) { /* not framed */ }
    if (!timer) timer = setTimeout(flush, 800);
  }
  var fmt = function (args) {
    return Array.prototype.map.call(args, function (a) {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
      return String(a);
    }).join(' ');
  };
  ['error', 'warn'].forEach(function (level) {
    var orig = console[level].bind(console);
    console[level] = function () { log(level, fmt(arguments)); orig.apply(null, arguments); };
  });
  // files that fail to load (script, stylesheet, image, audio, font links) and uncaught errors
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && (t.src || t.href)) log('error', 'Failed to load ' + (t.tagName || '').toLowerCase() + ': ' + (t.src || t.href));
    else if (e.message) log('error', e.message + (e.filename ? ' (' + e.filename.replace(location.origin + dir, '') + ':' + e.lineno + ')' : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    log('error', 'Unhandled: ' + (r && r.message ? r.message : String(r)));
  });

  var reported = false;
  /** main.js calls this when the video is ready, empty or failed. */
  window.__lumaReport = function (status, message, duration) {
    reported = true;
    flush();
    post({ status: status, message: message, duration: duration });
  };
  // nothing at all after 25 s (e.g. a module that failed to load before main.js could start)
  setTimeout(function () {
    if (reported) return;
    var msg = 'The video did not start within 25 s — a script probably failed to load (see the console lines).';
    log('error', msg);
    flush();
    post({ status: 'error', message: msg });
    try { parent.postMessage({ source: 'luma-preview', type: 'error', message: msg }, '*'); } catch (e) { /* not framed */ }
  }, 25000);
})();
