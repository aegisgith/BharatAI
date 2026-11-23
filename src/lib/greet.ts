// The name after "Dear" / "Hi" in EVERY email, notification and message that goes out.
//
// The organiser, 23 Nov 2026: "when someone is Dr. address them as Dear Dr. Rajkumar,
// not Rajkumar; all govt officials should be addressed, if male, as Shri before name.
// These rules are applicable to all emails, photos, notification, update, any email
// which goes out."
//
//   Dr. Rajkumar Upadhyay      -> Dr. Rajkumar          (Dr. / Prof. + first name)
//   Prof. Dr. Jayantrao Patil  -> Prof. Dr. Jayantrao
//   Shri Sachin Itkar          -> Shri Sachin Itkar     (Hon'ble / Shri / Smt. + full name)
//   Shri. K.K. Singh           -> Shri K.K. Singh
//   Dr. Kunal Khemnar (IAS)    -> Dr. Kunal             ("(IAS)" is dropped)
//   Col. Rajesh Sharma         -> Col. Rajesh Sharma    (a rank, like Shri, takes the full name)
//   Mr. Prakash Ranjalkar      -> Prakash               (Mr / Ms / Mrs / Miss / Kum / Er / CA / CS / Adv dropped)
//   DR. RAJESH KUMAR, riddhi   -> Dr. Rajesh, Riddhi    (shouted or lower-case imports tidied)
//
// Titles come only from the stored name. Whether someone is an official, and Shri or
// Smt., is never guessed from a first name: the organiser puts the title in the name.
// '' when there is no usable name; each caller keeps its own fallback ("there", "team").

const TITLE = /^(hon[’']?ble|shri|sri|smt|dr|prof|col|capt|cdr|gen|maj|brig|lt|mr|mrs|ms|miss|kum|er|ca|cs|adv)\.?$/i
// A rank is kept like Shri, with the full name: "Col. Rajesh Sharma".
const RANK = /^(col|capt|cdr|gen|maj|brig|lt)$/

// Only a name typed all in capitals or all in small letters is re-cased, and never a
// word with a dot or of one or two letters (K.K., AV, the R of "R Sharma").
function tidy(w: string): string {
  if (/\./.test(w) || w.length <= 2) return w.length <= 2 && !/\./.test(w) ? w.toUpperCase() : w
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
}

export function titledName(name: any): string {
  const words = String(name ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim().split(/\s+/).filter(Boolean)
  const kept: string[] = []
  let formal = false
  while (words.length && TITLE.test(words[0])) {
    const t = words.shift()!.replace(/\.$/, '').toLowerCase()
    if (/^hon/.test(t)) { kept.push('Hon’ble'); formal = true }
    else if (t === 'shri') { kept.push('Shri'); formal = true }
    else if (t === 'sri') { kept.push('Sri'); formal = true }
    else if (RANK.test(t)) { kept.push(t.charAt(0).toUpperCase() + t.slice(1) + '.'); formal = true }
    else if (t === 'smt') { kept.push('Smt.'); formal = true }
    else if (t === 'dr') kept.push('Dr.')
    else if (t === 'prof') kept.push('Prof.')
  }
  if (!words.length || !/[a-z]/i.test(words[0])) return ''
  const joined = words.join(' ')
  const shouted = joined === joined.toUpperCase() || joined === joined.toLowerCase()
  // An initial ("K.K. Singh", "R Sharma", "AV Mahalakshmi") is no name to greet someone by.
  const bare = words[0].replace(/\./g, '')
  const initial = bare.length === 1 || (bare.length === 2 && (/\./.test(words[0]) || bare === bare.toUpperCase()))
  const shown = formal || initial ? words : [words[0]]
  return [...kept, ...(shouted ? shown.map(tidy) : shown)].join(' ')
}
