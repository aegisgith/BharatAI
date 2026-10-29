// The GST invoice as a PDF, attached to the invoice email and served at
// /invoice/<token>/pdf. It is drawn to the layout the accounts team's own
// invoices use (the Excel sheet they printed to PDF by hand until 28 Oct 2026),
// so a buyer's finance team sees the same document whichever way it reached them.
//
// The same sheet is the payment receipt the app sends when a payment lands
// (receipt: true, since 29 Oct 2026): titled RECEIPT, "Received from" in place of
// the billing and shipping columns, marked Paid, no bank details, and a line that
// says the tax invoice is issued separately.
//
// Layout only: every figure arrives already formatted by the worker (rupees(),
// rupeesInWords(), invoiceDate()), so there is no second copy of the arithmetic.
// Helvetica is one of the PDF base fonts, so nothing is embedded but the logo.
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib'

export type InvoicePdfView = {
  receipt: boolean
  invoiceNo: string
  date: string
  billTo: string
  address: string
  buyerGstin: string
  itemDesc: string
  buyerName: string
  refLine: string
  sac: string
  gstRate: number
  taxable: string
  cgst: string
  sgst: string
  igst: string
  total: string
  words: string
  placeOfSupply: string
  seller: {
    brandLine: string
    legalName: string
    address: string
    pan: string
    gstin: string
    signatory: string
    bank: string
    footer: string
  }
}

// The base fonts only carry WinAnsi; anything outside it (a rupee sign, Devanagari
// in a name) would throw, so it is spelled out or dropped instead.
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
function winAnsi(s: string): string {
  return String(s ?? '').replace(/₹/g, 'Rs.').replace(/\t/g, ' ').split('').filter(ch => {
    const n = ch.charCodeAt(0)
    return ch === '\n' || (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff) || WIN_ANSI_EXTRA.includes(ch)
  }).join('')
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = []
  for (const para of winAnsi(text).split(/\r?\n/)) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next
      else { out.push(line); line = word }
    }
    out.push(line)
  }
  return out
}

export async function invoicePdf(v: InvoicePdfView, logoPng: Uint8Array | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle((v.receipt ? 'Receipt ' : 'Tax Invoice ') + v.invoiceNo)
  doc.setAuthor(v.seller.legalName)
  doc.setSubject('Bharat AI Innovation 2026')
  doc.setCreator('bharataiinnovation.com')
  doc.setProducer('bharataiinnovation.com')
  const page: PDFPage = doc.addPage([595.28, 841.89])
  const H = page.getHeight()
  const reg = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const black = rgb(0, 0, 0)
  const L = 40, R = 555.28, W = R - L
  const PAD = 5, SIZE = 9, LEAD = 11.5

  type Cell = { w: number; text?: string; bold?: boolean; align?: 'left' | 'center' | 'right'; size?: number }
  const text = (s: string, x: number, top: number, o: { bold?: boolean; size?: number; align?: 'left' | 'center' | 'right'; width?: number } = {}) => {
    const f = o.bold ? bold : reg, sz = o.size || SIZE, t = winAnsi(s)
    const tw = f.widthOfTextAtSize(t, sz)
    const dx = o.align === 'center' ? (o.width! - tw) / 2 : o.align === 'right' ? o.width! - tw : 0
    page.drawText(t, { x: x + dx, y: H - top - sz, size: sz, font: f, color: black })
  }
  const box = (x: number, top: number, w: number, h: number) =>
    page.drawRectangle({ x, y: H - top - h, width: w, height: h, borderColor: black, borderWidth: 0.75 })
  const lines = (c: Cell) => c.text ? wrap(c.text, c.bold ? bold : reg, c.size || SIZE, c.w - 2 * PAD) : []
  // One row of bordered cells, as tall as its tallest cell; returns the next top.
  const row = (top: number, cells: Cell[], minH = 0): number => {
    const h = Math.max(minH, ...cells.map(c => lines(c).length * LEAD + 2 * PAD))
    let x = L
    for (const c of cells) {
      box(x, top, c.w, h)
      lines(c).forEach((ln, i) => text(ln, x + PAD, top + PAD + i * LEAD, { bold: c.bold, size: c.size, align: c.align, width: c.w - 2 * PAD }))
      x += c.w
    }
    return top + h
  }

  let top = 40
  text(v.receipt ? 'RECEIPT' : 'TAX INVOICE', L, top, { bold: true, size: 13, align: 'center', width: W })
  top += 24

  // Seller on the left, the event logo on the right.
  const seller = [v.seller.brandLine, v.seller.legalName, v.seller.address].filter(Boolean).join('\n')
  const sellerLines = wrap(seller, bold, SIZE, W * 0.6)
  sellerLines.forEach((ln, i) => text(ln, L + PAD, top + i * LEAD, { bold: true }))
  let logoH = 0
  if (logoPng) {
    try {
      const img = await doc.embedPng(logoPng)
      const w = 170, h = img.height * (w / img.width)
      page.drawImage(img, { x: R - w - PAD, y: H - top - h + 4, width: w, height: h })
      logoH = h
    } catch { /* an invoice without the logo is still an invoice */ }
  }
  top += Math.max(sellerLines.length * LEAD, logoH) + 10

  if (v.receipt) {
    const r1 = W * 0.20, r2 = W * 0.48, r3 = W * 0.16, r4 = W - r1 - r2 - r3
    top = row(top, [
      { w: r1, text: 'Received from', bold: true }, { w: r2, text: v.billTo },
      { w: r3, text: 'Receipt No.', bold: true, align: 'center' }, { w: r4, text: v.invoiceNo, bold: true, align: 'center' },
    ])
    top = row(top, [
      { w: r1, text: 'Address', bold: true }, { w: r2, text: v.address || '-' },
      { w: r3, text: 'Date', bold: true, align: 'center' }, { w: r4, text: v.date, align: 'center' },
    ])
    top = row(top, [
      { w: r1, text: 'GST No.', bold: true }, { w: r2, text: v.buyerGstin || 'Unregistered' },
      { w: r3, text: 'Status', bold: true, align: 'center' }, { w: r4, text: 'Paid', bold: true, align: 'center' },
    ])
  } else {
    const c1 = W * 0.08, c2 = W * 0.30, c3 = W * 0.30, c4 = W * 0.16, c5 = W - c1 - c2 - c3 - c4
    top = row(top, [
      { w: c1, text: 'To,', bold: true }, { w: c2, text: 'Billing Address', bold: true, align: 'center' },
      { w: c3, text: 'Shipping Address', bold: true, align: 'center' }, { w: c4, text: 'Invoice No.', bold: true, align: 'center' },
      { w: c5, text: v.invoiceNo, bold: true, align: 'center' },
    ])
    top = row(top, [
      { w: c1 }, { w: c2, text: v.billTo, align: 'center' }, { w: c3, text: v.billTo, align: 'center' },
      { w: c4, text: 'Date', bold: true, align: 'center' }, { w: c5, text: v.date, align: 'center' },
    ])
    top = row(top, [
      { w: c1 }, { w: c2, text: v.address }, { w: c3, text: v.address },
      { w: c4, text: 'Due Date', bold: true, align: 'center' }, { w: c5, text: '-', align: 'center' },
    ], 40)
    top = row(top, [
      { w: c1 + c2 + c3, text: 'GST No: - ' + (v.buyerGstin || 'Unregistered'), bold: true, align: 'center' },
      { w: c4 + c5 },
    ])
  }

  const d1 = W * 0.08, d2 = W * 0.60, d3 = W * 0.16, d4 = W - d1 - d2 - d3
  top = row(top, [
    { w: d1, text: 'Sr. No.', bold: true, align: 'center' }, { w: d2, text: 'Description of Service', bold: true, align: 'center' },
    { w: d3, text: 'SAC Code', bold: true, align: 'center' }, { w: d4, text: 'Amount (INR)', bold: true, align: 'center' },
  ])
  // The item: what was bought, then whose pass it is, then the payment it answers.
  const item = v.itemDesc + '\n\n' + v.buyerName + (v.refLine ? '\n\n' + v.refLine : '')
  top = row(top, [
    { w: d1, text: '1', align: 'center' }, { w: d2, text: item },
    { w: d3, text: v.sac, align: 'center' }, { w: d4, text: v.taxable, align: 'right' },
  ], 100)

  // Place of supply and the seller's numbers beside the four tax rows.
  const half = v.gstRate / 2
  const taxRows: [string, string][] = [
    [v.receipt ? 'Taxable Value' : 'Total', v.taxable], ['Add: CGST @ ' + half + '%', v.cgst],
    ['Add: SGST @ ' + half + '%', v.sgst], ['Add: IGST @ ' + v.gstRate + '%', v.igst],
  ]
  const rowH = LEAD + 2 * PAD
  box(L, top, d1 + d2, rowH * 4)
  text('Place of Supply: ' + v.placeOfSupply, L + PAD, top + PAD + 2, { bold: true })
  text('PAN No.:', L + PAD, top + PAD + 2 + LEAD * 2.2, { bold: true })
  text(v.seller.pan, L + PAD + 60, top + PAD + 2 + LEAD * 2.2, { bold: true })
  text('GST. No.:', L + PAD, top + PAD + 2 + LEAD * 3.2, { bold: true })
  text(v.seller.gstin, L + PAD + 60, top + PAD + 2 + LEAD * 3.2, { bold: true })
  taxRows.forEach(([label, amount], i) => {
    const t = top + i * rowH
    box(L + d1 + d2, t, d3, rowH)
    box(L + d1 + d2 + d3, t, d4, rowH)
    text(label, L + d1 + d2 + PAD, t + PAD, { bold: true })
    text(amount, L + d1 + d2 + d3 + PAD, t + PAD, { bold: i === 0, align: 'right', width: d4 - 2 * PAD })
  })
  top += rowH * 4
  top = row(top, [
    { w: d1 + d2, text: 'In Words: ' + v.words, bold: true },
    { w: d3, text: v.receipt ? 'Amount Received' : 'Grand Total', bold: true }, { w: d4, text: v.total, bold: true, align: 'right' },
  ])

  if (v.receipt) {
    top += 12
    for (const ln of wrap('This receipt acknowledges the payment above. It is not a tax invoice: the GST tax invoice for this payment is issued separately.', reg, SIZE, W - 2 * PAD)) { text(ln, L + PAD, top); top += LEAD }
  }

  top += 18
  text('For ' + v.seller.legalName, L + PAD, top, { bold: true })
  top += 52
  text(v.seller.signatory, L + PAD, top, { bold: true })
  top += 24

  if (v.seller.bank && !v.receipt) {
    text('Online Transfer Details :-', L + PAD, top, { bold: true })
    top += LEAD + 2
    for (const ln of wrap(v.seller.bank, reg, SIZE, W - 2 * PAD)) { text(ln, L + PAD, top); top += LEAD }
  }
  if (v.seller.footer) {
    top += 14
    for (const ln of wrap(v.seller.footer, bold, 8.5, W - 2 * PAD)) { text(ln, L + PAD, top, { bold: true, size: 8.5, align: 'center', width: W - 2 * PAD }); top += LEAD }
  }

  // The whole sheet inside one frame, as the accountant's template has it.
  box(L - 10, 30, W + 20, top - 30 + 12)
  return doc.save()
}
