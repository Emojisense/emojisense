/// Math that must give the same bits as the TypeScript reference engine.
enum ReferenceMath {
  /// Natural logarithm, bit-identical to V8's `Math.log` on arm64.
  ///
  /// V8 computes `Math.log` with fdlibm's `e_log.c`, and its arm64 builds contract `a * b + c`
  /// into fused multiply-adds. Darwin's `log` differs from it in the last bit for about 3% of
  /// inputs, which is enough to reorder emoji whose IDF-weighted scores tie. This port keeps the
  /// fdlibm algorithm and makes each contraction explicit with `addingProduct`. It matched Node 24
  /// (arm64) on 205,751 inputs, including every `1 + E / df` of the 0.1.0 packs.
  static func log(_ input: Double) -> Double {
    let ln2Hi = 6.93147180369123816490e-01
    let ln2Lo = 1.90821492927058770002e-10
    let two54 = 1.80143985094819840000e+16
    let lg1 = 6.666666666666735130e-01
    let lg2 = 3.999999999940941908e-01
    let lg3 = 2.857142874366239149e-01
    let lg4 = 2.222219843214978396e-01
    let lg5 = 1.818357216161805012e-01
    let lg6 = 1.531383769920937332e-01
    let lg7 = 1.479819860511658591e-01

    var x = input
    var highWord = Int32(bitPattern: UInt32(truncatingIfNeeded: x.bitPattern >> 32))
    let lowWord = UInt32(truncatingIfNeeded: x.bitPattern)
    var k: Int32 = 0
    if highWord < 0x0010_0000 {
      if (highWord & 0x7fff_ffff) == 0 && lowWord == 0 { return -.infinity }
      if highWord < 0 { return .nan }
      k -= 54
      x *= two54
      highWord = Int32(bitPattern: UInt32(truncatingIfNeeded: x.bitPattern >> 32))
    }
    if highWord >= 0x7ff0_0000 { return x + x }
    k += (highWord >> 20) - 1023
    highWord &= 0x000f_ffff
    let i0 = (highWord &+ 0x95f64) & 0x10_0000
    let normalizedHigh = UInt64(UInt32(bitPattern: highWord | (i0 ^ 0x3ff0_0000)))
    x = Double(bitPattern: (normalizedHigh << 32) | (x.bitPattern & 0xffff_ffff))
    k += i0 >> 20
    let f = x - 1.0
    let dk = Double(k)

    if (0x000f_ffff & (2 &+ highWord)) < 3 {
      if f == 0 {
        return k == 0 ? 0 : (dk * ln2Lo).addingProduct(dk, ln2Hi)
      }
      let r = f * f * (0.5).addingProduct(-0.33333333333333333, f)
      if k == 0 { return f - r }
      return (-(r.addingProduct(-dk, ln2Lo) - f)).addingProduct(dk, ln2Hi)
    }

    let s = f / (2.0 + f)
    let z = s * s
    let w = z * z
    let t1 = w * lg2.addingProduct(w, lg4.addingProduct(w, lg6))
    let t2 = z * lg1.addingProduct(w, lg3.addingProduct(w, lg5.addingProduct(w, lg7)))
    let r = t2 + t1
    if ((highWord &- 0x6147a) | (0x6b851 &- highWord)) > 0 {
      let hfsq = 0.5 * f * f
      if k == 0 { return f - hfsq.addingProduct(-s, hfsq + r) }
      let inner = hfsq - (dk * ln2Lo).addingProduct(s, hfsq + r)
      return (-(inner - f)).addingProduct(dk, ln2Hi)
    }
    if k == 0 { return f.addingProduct(-s, f - r) }
    let inner = (-(dk * ln2Lo)).addingProduct(s, f - r)
    return (-(inner - f)).addingProduct(dk, ln2Hi)
  }
}
