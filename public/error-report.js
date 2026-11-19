// Reports script errors on this page to the control room's Errors list (error-tracker.js on the server).
// Sends only the error message, the file and line, and the page's path: nothing typed, no account details.
// At most 5 reports per page load, each different error once.
(function () {
  var sent = 0, seen = {};
  var NOISE = /^script error\.?$|resizeobserver loop|failed to fetch|load failed|networkerror|network connection was lost|aborterror|operation was aborted/i;
  function send(message, stack, src, line, col) {
    message = String(message || '').slice(0, 500);
    if (!message || sent >= 5 || NOISE.test(message)) return;
    if (/-extension:\/\//i.test(String(src || '') + String(stack || ''))) return;
    var key = message + '|' + (src || '') + '|' + (line || '');
    if (seen[key]) return;
    seen[key] = 1; sent++;
    try {
      fetch('/api/client-error', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ message: message, stack: String(stack || '').slice(0, 3000), src: String(src || '').slice(0, 300), line: line || 0, col: col || 0, page: location.pathname }),
      }).catch(function () {});
    } catch (e) {}
  }
  window.addEventListener('error', function (e) {
    if (!e || (!e.message && !e.error)) return; // a missing image or file, not a script error
    send(e.message || (e.error && e.error.message), e.error && e.error.stack, e.filename, e.lineno, e.colno);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    send(r && r.message ? r.message : String(r), r && r.stack, '', 0, 0);
  });
})();
