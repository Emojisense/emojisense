package com.emojisense

import java.math.BigDecimal

/** Math that must give the same bits as the TypeScript reference engine. */
internal object ReferenceMath {
    /**
     * Natural logarithm, bit-identical to V8's `Math.log` on arm64.
     *
     * V8 computes `Math.log` with fdlibm's `e_log.c`, and its arm64 builds contract `a * b + c`
     * into fused multiply-adds. `StrictMath.log` (plain fdlibm) differs from it in the last bit
     * for a few percent of inputs, which is enough to reorder emoji whose IDF-weighted scores tie.
     * This port keeps the fdlibm algorithm and makes each contraction an explicit [fma], as the
     * Swift SDK does.
     */
    fun log(input: Double): Double {
        var x = input
        var highWord = (x.toRawBits() ushr 32).toInt()
        val lowWord = x.toRawBits().toInt()
        var k = 0
        if (highWord < 0x0010_0000) {
            if ((highWord and 0x7fff_ffff) == 0 && lowWord == 0) return Double.NEGATIVE_INFINITY
            if (highWord < 0) return Double.NaN
            k -= 54
            x *= TWO54
            highWord = (x.toRawBits() ushr 32).toInt()
        }
        if (highWord >= 0x7ff0_0000) return x + x
        k += (highWord shr 20) - 1023
        highWord = highWord and 0x000f_ffff
        val i0 = (highWord + 0x95f64) and 0x10_0000
        val normalizedHigh = (highWord or (i0 xor 0x3ff0_0000)).toLong() and 0xffff_ffffL
        x = Double.fromBits((normalizedHigh shl 32) or (x.toRawBits() and 0xffff_ffffL))
        k += i0 shr 20
        val f = x - 1.0
        val dk = k.toDouble()

        if ((0x000f_ffff and (2 + highWord)) < 3) {
            if (f == 0.0) return if (k == 0) 0.0 else fma(dk, LN2_HI, dk * LN2_LO)
            val r = f * f * fma(-0.33333333333333333, f, 0.5)
            if (k == 0) return f - r
            return fma(dk, LN2_HI, -(fma(-dk, LN2_LO, r) - f))
        }

        val s = f / (2.0 + f)
        val z = s * s
        val w = z * z
        val t1 = w * fma(w, fma(w, LG6, LG4), LG2)
        val t2 = z * fma(w, fma(w, fma(w, LG7, LG5), LG3), LG1)
        val r = t2 + t1
        if (((highWord - 0x6147a) or (0x6b851 - highWord)) > 0) {
            val hfsq = 0.5 * f * f
            if (k == 0) return f - fma(-s, hfsq + r, hfsq)
            val inner = hfsq - fma(s, hfsq + r, dk * LN2_LO)
            return fma(dk, LN2_HI, -(inner - f))
        }
        if (k == 0) return fma(-s, f - r, f)
        val inner = fma(s, f - r, -(dk * LN2_LO))
        return fma(dk, LN2_HI, -(inner - f))
    }

    /** `a * b + c` with one rounding. Runtimes without `Math.fma` (Java 8, older Android) use [exactFma]. */
    fun fma(a: Double, b: Double, c: Double): Double =
        if (hasPlatformFma) {
            try {
                Math.fma(a, b, c)
            } catch (missing: NoSuchMethodError) {
                hasPlatformFma = false
                exactFma(a, b, c)
            }
        } else {
            exactFma(a, b, c)
        }

    /** The exact product and sum, rounded once (finite inputs only, which is all `log` needs). */
    fun exactFma(a: Double, b: Double, c: Double): Double {
        val exact = BigDecimal(a).multiply(BigDecimal(b)).add(BigDecimal(c))
        if (exact.signum() == 0) return a * b + c
        return exact.toDouble()
    }

    @Volatile
    private var hasPlatformFma = true

    private const val LN2_HI = 6.93147180369123816490e-01
    private const val LN2_LO = 1.90821492927058770002e-10
    private const val TWO54 = 1.80143985094819840000e+16
    private const val LG1 = 6.666666666666735130e-01
    private const val LG2 = 3.999999999940941908e-01
    private const val LG3 = 2.857142874366239149e-01
    private const val LG4 = 2.222219843214978396e-01
    private const val LG5 = 1.818357216161805012e-01
    private const val LG6 = 1.531383769920937332e-01
    private const val LG7 = 1.479819860511658591e-01
}
