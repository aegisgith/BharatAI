/* A fingerprint of a photo that survives being saved and uploaded again.
 *
 * Used by /app before a profile photo is uploaded, and by
 * scripts/gen-site-photo-fingerprints.py to fingerprint every people-photo on the
 * website - the SAME file, so the two can never compute it differently.
 *
 * Computed from the pixels of the exact square canvas that gets uploaded, by a box
 * average rather than the browser's own scaling, so every browser that decodes the
 * same image produces the same numbers. Two parts, 256 bits each, "d:a" in hex:
 *   d - 17x16 grid, one bit per horizontal neighbour, brighter or darker
 *       (a difference hash: follows the shape of the picture)
 *   a - 16x16 grid, one bit per cell, above or below the mean
 *       (an average hash: follows where the light and dark areas sit)
 *
 * Calibrated on 14 Sep 2026 against every uploaded avatar (208) and every image on
 * the site (254): saving a photo and uploading it again moves d by at most 46 bits
 * and a by at most 4; a 60% screenshot moves them 61 and 17. The two closest
 * photos of DIFFERENT people were 91+ apart on d. The server matches on d <= 64
 * AND a <= 16. See PHOTO_FP_MAX_D / PHOTO_FP_MAX_A in src/index.tsx.
 */
(function (global) {
  function fromCanvas(canvas) {
    var w = canvas.width, h = canvas.height;
    var px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    function grid(cols, rows) {
      var sum = new Float64Array(cols * rows), cnt = new Float64Array(cols * rows);
      for (var y = 0; y < h; y++) {
        var gy = Math.min(rows - 1, Math.floor(y * rows / h));
        for (var x = 0; x < w; x++) {
          var gx = Math.min(cols - 1, Math.floor(x * cols / w));
          var i = (y * w + x) * 4, k = gy * cols + gx;
          sum[k] += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          cnt[k] += 1;
        }
      }
      for (var j = 0; j < sum.length; j++) sum[j] = cnt[j] ? sum[j] / cnt[j] : 0;
      return sum;
    }
    function toHex(bits) {
      var out = '';
      for (var b = 0; b < bits.length; b += 4) {
        out += ((bits[b] << 3) | (bits[b + 1] << 2) | (bits[b + 2] << 1) | bits[b + 3]).toString(16);
      }
      return out;
    }
    var dg = grid(17, 16), dbits = [];
    for (var r = 0; r < 16; r++) for (var c = 0; c < 16; c++) dbits.push(dg[r * 17 + c] < dg[r * 17 + c + 1] ? 1 : 0);
    var ag = grid(16, 16), mean = 0;
    for (var m = 0; m < ag.length; m++) mean += ag[m];
    mean /= ag.length;
    var abits = [];
    for (var n = 0; n < ag.length; n++) abits.push(ag[n] > mean ? 1 : 0);
    return toHex(dbits) + ':' + toHex(abits);
  }

  /* The square the pass and the card draw: the centred square, at most `size`
   * pixels, on white. The app uploads exactly this canvas, so the fingerprint and
   * the uploaded image are of the same pixels. */
  function squareCanvas(img, size) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var side = Math.min(iw, ih);
    var sx = (iw - side) / 2, sy = (ih - side) / 2;
    var out = Math.min(size || 400, side);
    var canvas = document.createElement('canvas');
    canvas.width = out; canvas.height = out;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out, out);
    ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
    return canvas;
  }

  /* The same fingerprint of the canvas flipped left to right. A mirror is one tap
   * in any phone's photo editor, and it moves both hashes far past the match
   * threshold, so a saved photo flipped once used to go straight through. The
   * server compares this one as well: flipping an uploaded image back gives the
   * original's fingerprint again. Drawn at scale -1 on whole pixels, so it is an
   * exact mirror with no resampling. */
  function mirroredFromCanvas(canvas) {
    var m = document.createElement('canvas');
    m.width = canvas.width; m.height = canvas.height;
    var ctx = m.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(canvas, 0, 0);
    return fromCanvas(m);
  }

  global.BhaiPhotoFingerprint = { fromCanvas: fromCanvas, squareCanvas: squareCanvas, mirroredFromCanvas: mirroredFromCanvas };
})(window);
