// Records when a Campus Series recording starts playing on this site, through the
// YouTube player's own "playing" signal, so the organiser can see which videos
// people watch. Who is watching is known only when this phone asked for the
// reports on /insights (the form kept a signed link); otherwise the play is
// counted with nobody's name on it. Each iframe carries data-report and
// enablejsapi=1 in its src; this file loads YouTube's IFrame API and listens.
(function () {
  var frames = Array.prototype.slice.call(document.querySelectorAll('iframe[data-report]'));
  if (!frames.length) return;
  var KEY = 'bhai_insights_links';
  var sent = {};

  // The signed link this phone holds for that report, if it asked on /insights.
  function tokenFor(report) {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      var r = saved && saved.reports && saved.reports.filter(function (x) { return x.slug === report; })[0];
      var m = r && /[?&]t=([^&#]+)/.exec(r.url || '');
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  }

  function record(report) {
    if (sent[report]) return;
    sent[report] = true;
    var body = JSON.stringify({ report: report, t: tokenFor(report), source: 'site', page: location.pathname });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/reports/watch', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/reports/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
      }
    } catch (e) { /* a play that cannot be recorded is still a play */ }
  }

  var previous = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = function () {
    if (typeof previous === 'function') { try { previous(); } catch (e) {} }
    frames.forEach(function (frame) {
      var report = frame.getAttribute('data-report');
      try {
        new YT.Player(frame, { events: { onStateChange: function (e) { if (e.data === YT.PlayerState.PLAYING) record(report); } } });
      } catch (e) { /* the player refused; nothing to record */ }
    });
  };
  var s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  s.async = true;
  document.head.appendChild(s);
})();
