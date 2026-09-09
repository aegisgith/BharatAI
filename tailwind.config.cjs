/** Tailwind is compiled at build time (npm run css) instead of by the Play CDN
 *  in the browser. Pinned to v3: brandThemeCSS() overrides v3's gradient custom
 *  properties (--tw-gradient-from-position, --tw-gradient-stops) by name, and v4
 *  renames them.
 */
module.exports = {
  content: [
    './src/index.tsx',
    './src/routes/**/*.ts',
    './public/static/*.js',
    './public/js/pass-render.js',
  ],
  // Class names these files build by concatenation, so the scanner never sees
  // them whole: statCard()'s 'text-'+color+'-400', the contact/admin inquiry
  // type maps (bg-/text-/border- triples), the announcement icon backgrounds,
  // and the two admin funnel bars. Every value set is a hard-coded literal map
  // in the same file, so this list is closed. Explicit strings, not regex
  // patterns, so it stays auditable.
  safelist: [
    'bg-amber-500/20','bg-amber-500/60','bg-blue-500/60','bg-emerald-500/60','bg-gray-500/20','bg-gray-500/60','bg-green-500/20','bg-green-500/60','bg-orange-500/20','bg-primary-500/20','bg-purple-500/20','bg-red-500/20','bg-red-500/60','bg-rose-500/20','bg-violet-500/60','bg-yellow-500/20',
    'border-amber-500/30','border-gray-500/30','border-green-500/30','border-orange-500/30','border-primary-500/30','border-purple-500/30','border-rose-500/30',
    'text-accent-400','text-amber-300','text-amber-400','text-blue-400','text-emerald-400','text-gray-300','text-gray-400','text-green-300','text-green-400','text-orange-300','text-orange-400','text-pink-400','text-primary-300','text-primary-400','text-purple-300','text-purple-400','text-red-400','text-rose-300','text-rose-400','text-teal-400','text-violet-400',
  ],
  theme: {
    extend: {
      colors: {
        // The app's scales. The admin and marketplace heads carried a different
        // accent (orange) and dark, but neither page uses a single accent-* or
        // dark-* class, so merging on the app's values loses nothing.
        primary: { 50:'#fff3e9',100:'#ffe0c7',200:'#ffc194',300:'#ff9d55',400:'#ff8524',500:'#FF6B00',600:'#e05a00',700:'#b84800',800:'#933a08',900:'#79300c' },
        accent:  { 50:'#fdf4ff',100:'#fbe8ff',200:'#f5d0fe',300:'#f0abfc',400:'#e879f9',500:'#7c3aed',600:'#c026d3',700:'#a21caf',800:'#86198f',900:'#701a75' },
        dark:    { 700:'#1e2240',800:'#141730',900:'#0b0d1a' },
      },
    },
  },
}
