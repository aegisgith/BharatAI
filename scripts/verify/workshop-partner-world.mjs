// Shared by unit-workshop-partner.mjs and smoke-workshop-partner.mjs: runs the call for
// workshop partners' own inline script from public/training-workshop.html in node:vm
// against a small stand-in for the page, so the form's rules are tested as shipped, with
// no browser. Pass `fetch` to choose where the request goes.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../../', import.meta.url);
export const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

const inlineScript = () => {
  const blocks = [...read('public/training-workshop.html').matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (blocks.length !== 1) throw new Error('expected one inline script on /training-workshop, found ' + blocks.length);
  return blocks[0][1];
};

const BOXES = { topic: 'wp-topic', brief: 'wp-brief', min: 'wp-min', max: 'wp-max', audience: 'wp-audience', attend: 'wp-attend', prereq: 'wp-prereq', setup: 'wp-setup', company: 'wp-company', salutation: 'wp-salutation', first: 'wp-first', last: 'wp-last', email: 'wp-email', mobile: 'wp-mobile', website: 'wp-website' };
const IDS = [...Object.values(BOXES), 'wp-form', 'wp-error', 'wp-submit', 'wp-done', 'wp-done-text', 'wp-format-set', 'wp-format-hands', 'wp-as-set', 'wp-as-person'];

export const GOOD = {
  topic: 'Speech models for Indian languages',
  brief: 'Build a working voice bot from open models.',
  format: 'Hands-on',
  min: '60',
  max: '90',
  audience: 'Enterprise teams and startups',
  attend: 'Software developers with some Python',
  prereq: 'Basic Python',
  setup: 'Projector, internet, GPU access',
  as: 'AI company',
  company: 'Vaani Labs',
  salutation: 'Dr.',
  first: 'Asha',
  last: 'Rao',
  email: 'asha@vaanilabs.example',
  mobile: '98765 43210',
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
      appendChild(child) { moved = { child: child.id, under: id }; },
      parentNode: { of: id, appendChild(child) { moved = { child: child.id, under: id }; }, insertBefore(child) { moved = { child: child.id, under: 'the button' }; } },
      nextSibling: null,
    };
    return self;
  };
  const els = Object.fromEntries(IDS.map((id) => [id, el(id)]));
  els['wp-error'].hidden = true;
  els['wp-done'].hidden = true;

  let chosen = {};
  const form = els['wp-form'];
  form.querySelectorAll = (sel) => (sel === '[aria-invalid]' ? Object.values(els).filter((e) => 'aria-invalid' in e.attrs) : []);
  form.querySelector = (sel) => {
    const m = sel.match(/name="([a-z_]+)"/);
    return m && chosen[m[1]] ? { value: chosen[m[1]] } : null;
  };

  const sent = [];
  const sandbox = {
    document: { getElementById: (id) => els[id] || null },
    location: { search },
    URLSearchParams, JSON, Error, Array, Object, Number, console,
    fetch: (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return (fetch || (async () => ({ ok: true, json: async () => ({ success: true }) })))(url, init);
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(inlineScript(), sandbox);

  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
  return {
    els, sent, focused,
    moved: () => moved,
    async submit(input = {}) {
      const v = { website: '', ...input };
      for (const [key, id] of Object.entries(BOXES)) els[id].value = v[key] || '';
      chosen = { format: v.format || '', applying_as: v.as || '' };
      form.listeners.submit({ preventDefault() {} });
      await settle();
      return { error: els['wp-error'].hidden ? '' : els['wp-error'].textContent, done: !els['wp-done'].hidden, body: sent[sent.length - 1]?.body };
    },
  };
}
