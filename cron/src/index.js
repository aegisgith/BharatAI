// bharatai-mail-cron: every minute, ask the site to send the panel email that is
// due. Nothing is decided here. The site keeps the queue, the pace and Stop
// (see docs/PROJECT-HANDBOOK.md, section 17); if the site answers 401 the
// CRON_SECRET here does not match the site's, and nothing is sent.
export default {
  async scheduled(event, env, ctx) {
    const site = (env.SITE || 'https://bharataiinnovation.com').replace(/\/$/, '');
    if (!env.CRON_SECRET) { console.error('mail-cron: CRON_SECRET is not set; run: npx wrangler secret put CRON_SECRET --config cron/wrangler.jsonc'); return; }
    const started = Date.now();
    try {
      // max_seconds 50: the site keeps sending within this call for up to 50 s,
      // so a gap shorter than a minute is honoured between two of these ticks.
      const res = await fetch(site + '/api/cron/tick', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + env.CRON_SECRET, 'Content-Type': 'application/json', 'User-Agent': 'bharatai-mail-cron' },
        body: JSON.stringify({ max_seconds: 50 }),
      });
      const text = await res.text();
      let j = null; try { j = JSON.parse(text); } catch {}
      const acted = (j && j.acted) || [];
      const running = j && j.jobs ? Object.values(j.jobs).filter(x => x.status === 'running').length : 0;
      console.log(`mail-cron: ${res.status} in ${Date.now() - started} ms; ${running} running; ` + (acted.length ? acted.map(a => `${a.kind}:${a.slug} sent ${a.sent}` + (a.failed ? ` failed ${a.failed}` : '')).join(', ') : 'nothing due'));
      if (res.status === 401) console.error('mail-cron: the site refused the secret. Set the same value as the site\'s CRON_SECRET (or its ADMIN_SECRET).');
    } catch (e) {
      console.error('mail-cron: could not reach the site:', e && e.message);
    }
  },
  async fetch() {
    return new Response('bharatai-mail-cron runs on a schedule; there is nothing to see here.', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  },
};
