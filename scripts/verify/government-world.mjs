// Shared by unit-government.mjs and smoke-government.mjs: runs public/government.html's
// own inline script in node:vm against a small stand-in for the page, so the nomination
// form's rules are tested as shipped, with no browser. Pass `fetch` to choose where the
// request goes.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../../', import.meta.url);
export const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

const inlineScript = () => {
  const blocks = [...read('public/government.html').matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (blocks.length !== 1) throw new Error('expected one inline script on /government, found ' + blocks.length);
  return blocks[0][1];
};

const IDS = ['gv-form', 'gv-error', 'gv-submit', 'gv-org', 'gv-initiative', 'gv-about', 'gv-name', 'gv-designation', 'gv-email', 'gv-phone', 'gv-website', 'gv-done', 'gv-done-text'];

export const GOOD = {
  org: 'Ministry of Tribal Affairs',
  initiative: 'Adi Vaani',
  about: 'Translates tribal languages for citizens.',
  name: 'Asha Rao',
  designation: 'Deputy Secretary',
  email: 'asha.rao@example.gov.in',
  phone: '011 2338 1234',
};

export function openPage({ search = '', fetch } = {}) {
  const focused = { id: null };
  let moved = null;
  const el = (id) => {
    const attrs = {};
    const listeners = {};
    const self = {
      id, value: '', hidden: false, textContent: '', innerHTML: '', disabled: false,
      setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; }, getAttribute(k) { return attrs[k]; }, attrs,
      focus() { focused.id = id; }, addEventListener(t, f) { listeners[t] = f; }, listeners,
      parentNode: { of: id, appendChild(child) { moved = { child: child.id, under: id }; }, insertBefore(child) { moved = { child: child.id, under: 'the button' }; } },
      nextSibling: null,
    };
    return self;
  };
  const els = Object.fromEntries(IDS.map((id) => [id, el(id)]));
  els['gv-error'].hidden = true;
  els['gv-done'].hidden = true;

  let formats = [];
  const form = els['gv-form'];
  form.querySelectorAll = (sel) => {
    if (sel === '[aria-invalid]') return Object.values(els).filter((e) => 'aria-invalid' in e.attrs);
    if (sel === 'input[name="format"]:checked') return formats.map((value) => ({ value }));
    return [];
  };

  const sent = [];
  const sandbox = {
    document: {
      getElementById: (id) => els[id] || null,
      querySelectorAll: () => [],
      querySelector: () => null,
    },
    location: { search },
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
  sandbox.window = sandbox; // no IntersectionObserver here, so the bar's code stands aside
  vm.runInNewContext(inlineScript(), sandbox);

  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
  return {
    els, sent, focused,
    moved: () => moved,
    async submit(input = {}, chosen = []) {
      const v = { org: '', initiative: '', about: '', name: '', designation: '', email: '', phone: '', website: '', ...input };
      els['gv-org'].value = v.org; els['gv-initiative'].value = v.initiative; els['gv-about'].value = v.about;
      els['gv-name'].value = v.name; els['gv-designation'].value = v.designation;
      els['gv-email'].value = v.email; els['gv-phone'].value = v.phone; els['gv-website'].value = v.website;
      formats = chosen;
      form.listeners.submit({ preventDefault() {} });
      await settle();
      return { error: els['gv-error'].hidden ? '' : els['gv-error'].textContent, done: !els['gv-done'].hidden, body: sent[sent.length - 1]?.body };
    },
  };
}
