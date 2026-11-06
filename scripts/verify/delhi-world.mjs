// Shared by unit-delhi.mjs and smoke-delhi.mjs: runs public/delhi.html's own inline
// script in node:vm against a small stand-in for the page, so the form's rules are
// tested as shipped, with no browser. Pass `fetch` to choose where the request goes.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../../', import.meta.url);
export const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

const inlineScript = () => {
  const blocks = [...read('public/delhi.html').matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (blocks.length !== 1) throw new Error('expected one inline script on /delhi, found ' + blocks.length);
  return blocks[0][1];
};

const IDS = ['dl-form', 'dl-error', 'dl-submit', 'dl-phone-hint', 'dl-name', 'dl-email', 'dl-phone', 'dl-org', 'dl-job', 'dl-city', 'dl-job-box', 'dl-city-box', 'dl-org-hint', 'dl-form-title', 'dl-form-text', 'dl-done-title', 'dl-website', 'dl-done', 'dl-done-text', 'dl-save-date', 'dl-save-date-2', 'dl-chosen'];

export function openPage({ search = '', userAgent = 'Mozilla/5.0 (iPhone)', fetch, links = [] } = {}) {
  const focused = { id: null };
  const el = (id) => {
    const attrs = {};
    const listeners = {};
    return {
      id, value: '', hidden: false, textContent: '', innerHTML: '', disabled: false, href: '/delhi-2027.ics', target: '', rel: '',
      setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; }, getAttribute(k) { return attrs[k]; }, attrs,
      focus() { focused.id = id; }, addEventListener(t, f) { listeners[t] = f; }, listeners,
    };
  };
  const els = Object.fromEntries(IDS.map((id) => [id, el(id)]));
  els['dl-error'].hidden = true;
  els['dl-done'].hidden = true;
  els['dl-save-date'].attrs.download = 'x.ics';
  els['dl-save-date-2'].attrs.download = 'x.ics';

  let chosen = 'attend';
  const form = els['dl-form'];
  const radio = (v) => ({ value: v, get checked() { return chosen === v; }, set checked(on) { if (on) chosen = v; } });
  form.querySelector = (sel) => {
    if (sel === 'input[name="interest"]:checked') return radio(chosen);
    const m = sel.match(/^input\[name="interest"\]\[value="(.*)"\]$/);
    return m && ['attend', 'exhibit', 'sponsor', 'speak'].includes(m[1]) ? radio(m[1]) : null;
  };
  form.querySelectorAll = (sel) => (sel === '[aria-invalid]' ? Object.values(els).filter((e) => 'aria-invalid' in e.attrs) : []);

  const linkEls = links.map((v) => { const a = el('link'); const [interest, item] = String(v).split('|'); a.setAttribute('data-interest', interest); if (item) a.setAttribute('data-item', item); return a; });
  const sent = [];
  const sandbox = {
    document: {
      getElementById: (id) => els[id] || null,
      querySelectorAll: (sel) => (sel === 'a[data-interest]' ? linkEls : []),
      querySelector: () => null,
    },
    location: { search },
    navigator: { userAgent },
    URLSearchParams,
    JSON,
    Error,
    Array,
    Object,
    console,
    fetch: (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return (fetch || (async () => ({ ok: true, json: async () => ({ success: true }) })))(url, init);
    },
  };
  sandbox.window = sandbox; // no IntersectionObserver here, so the offer bar's code stands aside
  vm.runInNewContext(inlineScript(), sandbox);

  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
  return {
    els, sent, links: linkEls, focused,
    interest: () => chosen,
    choose(v) { chosen = v; form.listeners.change({ target: { name: 'interest' } }); },
    async submit({ name = '', email = '', phone = '', org = '', job = '', city = '', website = '' } = {}) {
      els['dl-name'].value = name; els['dl-email'].value = email; els['dl-phone'].value = phone; els['dl-org'].value = org; els['dl-job'].value = job; els['dl-city'].value = city; els['dl-website'].value = website;
      form.listeners.submit({ preventDefault() {} });
      await settle();
      return { error: els['dl-error'].hidden ? '' : els['dl-error'].textContent, done: !els['dl-done'].hidden, body: sent[sent.length - 1]?.body, url: sent[sent.length - 1]?.url };
    },
  };
}
