/**
 * NF points.bin v3 contract (H2 / §2-B)
 *
 * Header (9 bytes, approved 2026-09-12):
 *   0..3 magic   ASCII "NFPT"
 *   4     version uint8 = 3  (payload contract v3)
 *   5..8  count   uint32 little-endian
 * Payload (count * 5): little-endian <HHB, no padding
 *   offset 0 = x(u16) / 2 = y(u16) / 4 = idx(u8)
 * x increases right; y increases down (painting source space)
 * quantize: floor(v + 0.5); out-of-range throws, never silent wrap
 * JS: DataView.getUint16(o, true) — littleEndian true is required (Q10)
 * Do not use TypedArray views on this 5-byte stride (Q9)
 * Headerless files are rejected. Do not add fields beyond magic/version/count.
 */
(function (root) {
  "use strict";
  var MAGIC = "NFPT";
  var VERSION = 3;
  var HEADER_BYTES = 9;
  var STRIDE = 5;
  var OFF_X = 0;
  var OFF_Y = 2;
  var OFF_IDX = 4;

  function readU16LE(view, o) {
    return view.getUint16(o, true);
  }

  function readHeader(buffer) {
    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error("readHeader expects ArrayBuffer");
    }
    if (buffer.byteLength < HEADER_BYTES) {
      throw new Error("byteLength " + buffer.byteLength + " < HEADER_BYTES " + HEADER_BYTES);
    }
    var view = new DataView(buffer);
    var magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );
    if (magic !== MAGIC) {
      throw new Error("bad magic " + magic + " (want " + MAGIC + ")");
    }
    var version = view.getUint8(4);
    if (version !== VERSION) {
      throw new Error("bad version " + version + " (want " + VERSION + ")");
    }
    var count = view.getUint32(5, true);
    var expected = HEADER_BYTES + count * STRIDE;
    if (buffer.byteLength !== expected) {
      throw new Error("byteLength " + buffer.byteLength + " !== HEADER+count*STRIDE " + expected);
    }
    return {
      magic: magic,
      version: version,
      count: count,
      headerBytes: HEADER_BYTES
    };
  }

  function readPointsBin(buffer, count) {
    var header = readHeader(buffer);
    if (count != null && header.count !== count) {
      throw new Error("header.count " + header.count + " !== expected " + count);
    }
    var view = new DataView(buffer);
    var points = [];
    var i;
    var o;
    var n = header.count;
    for (i = 0; i < n; i++) {
      o = HEADER_BYTES + i * STRIDE;
      points.push({
        x: readU16LE(view, o + OFF_X),
        y: readU16LE(view, o + OFF_Y),
        idx: view.getUint8(o + OFF_IDX)
      });
    }
    return points;
  }

  function endianProbe1023(buffer) {
    readHeader(buffer);
    var view = new DataView(buffer);
    var o = HEADER_BYTES + OFF_Y;
    return {
      le: view.getUint16(o, true),
      be: view.getUint16(o, false)
    };
  }

  var api = {
    MAGIC: MAGIC,
    VERSION: VERSION,
    HEADER_BYTES: HEADER_BYTES,
    STRIDE: STRIDE,
    OFF_X: OFF_X,
    OFF_Y: OFF_Y,
    OFF_IDX: OFF_IDX,
    readU16LE: readU16LE,
    readHeader: readHeader,
    readPointsBin: readPointsBin,
    endianProbe1023: endianProbe1023
  };
  root.NFPointsBin = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
