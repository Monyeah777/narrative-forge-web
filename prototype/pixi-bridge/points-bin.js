/**
 * NF points.bin v3 contract (H2 / §2-B)
 *
 * stride=5, little-endian <HHB, no padding, no file header
 * offset 0 = x(u16) / 2 = y(u16) / 4 = idx(u8)
 * x increases right; y increases down (painting source space)
 * quantize: floor(v + 0.5); out-of-range throws, never silent wrap
 * JS: DataView.getUint16(o, true) — littleEndian true is required (Q10)
 * Do not use TypedArray views on this 5-byte stride (Q9)
 */
(function (root) {
  "use strict";
  var STRIDE = 5;
  var OFF_X = 0;
  var OFF_Y = 2;
  var OFF_IDX = 4;

  function readU16LE(view, o) {
    return view.getUint16(o, true);
  }

  function readPointsBin(buffer, count) {
    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error("readPointsBin expects ArrayBuffer");
    }
    var expected = count * STRIDE;
    if (buffer.byteLength !== expected) {
      throw new Error("byteLength " + buffer.byteLength + " !== count*STRIDE " + expected);
    }
    var view = new DataView(buffer);
    var points = [];
    var i;
    var o;
    for (i = 0; i < count; i++) {
      o = i * STRIDE;
      points.push({
        x: readU16LE(view, o + OFF_X),
        y: readU16LE(view, o + OFF_Y),
        idx: view.getUint8(o + OFF_IDX)
      });
    }
    return points;
  }

  function endianProbe1023(buffer) {
    var view = new DataView(buffer);
    return {
      le: view.getUint16(2, true),
      be: view.getUint16(2, false)
    };
  }

  var api = {
    STRIDE: STRIDE,
    OFF_X: OFF_X,
    OFF_Y: OFF_Y,
    OFF_IDX: OFF_IDX,
    readU16LE: readU16LE,
    readPointsBin: readPointsBin,
    endianProbe1023: endianProbe1023
  };
  root.NFPointsBin = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
