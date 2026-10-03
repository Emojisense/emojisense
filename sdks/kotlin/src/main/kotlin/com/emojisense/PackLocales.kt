package com.emojisense

import java.util.Locale

/**
 * The languages that have a pack, and the user's languages among them, as
 * packages/core/src/locales.ts. Load and search only the user's languages
 * ([AliasSearchOptions.locales]), so a user of English and Turkish never gets a match from a
 * Portuguese alias.
 */
public object PackLocales {
    /** Languages with a published pack. English is always loaded: it carries the shortcodes. */
    @JvmField
    public val ALL: List<String> = listOf("en", "zh", "hi", "es", "ar", "fr", "bn", "pt", "ru", "id", "tr")

    /** Old language codes that systems still report (Java and Android give Indonesian as "in"). */
    private val RENAMED = mapOf("in" to "id")

    /**
     * The pack locale of a BCP 47 tag, case-insensitive ("pt-BR" → "pt", "zh_Hans" → "zh"), or null
     * when its language has no pack.
     */
    @JvmStatic
    @JvmOverloads
    public fun packLocaleOf(tag: String, supported: List<String> = ALL): String? {
        val language = tag.trim().lowercase(Locale.ROOT).split('-', '_')[0]
        val locale = RENAMED[language] ?: language
        return locale.takeIf { it in supported }
    }

    /**
     * The user's languages that have a pack, most preferred first, always with English (it carries the
     * shortcodes): ["tr-TR", "en-US", "de"] → ["tr", "en"]. Load and search only these. The first one
     * is the locale to prefer in search.
     *
     * @param languages BCP 47 tags, most preferred first. Default: [deviceLanguages].
     * @param supported pack locales to choose from. Default: [ALL].
     */
    @JvmStatic
    @JvmOverloads
    public fun userLocales(languages: List<String> = deviceLanguages(), supported: List<String> = ALL): List<String> {
        val locales = mutableListOf<String>()
        for (tag in languages) {
            val locale = packLocaleOf(tag, supported) ?: continue
            if (locale !in locales) locales.add(locale)
        }
        if ("en" !in locales) locales.add("en")
        return locales
    }

    /**
     * The device's languages as BCP 47 tags, most preferred first: Android's `LocaleList.getDefault()`
     * (Android 7+), else `Locale.getDefault()` (older Android, the JVM). On a server, pass the user's
     * languages to [userLocales] instead: the device's languages there are the server's.
     */
    @JvmStatic
    public fun deviceLanguages(): List<String> = androidLanguages() ?: listOf(Locale.getDefault().toLanguageTag())

    /** `LocaleList.getDefault()` through reflection: the library has no Android dependency. Null on the JVM. */
    private fun androidLanguages(): List<String>? = try {
        val localeList = Class.forName("android.os.LocaleList")
        val tags = localeList.getMethod("toLanguageTags").invoke(localeList.getMethod("getDefault").invoke(null)) as String
        tags.split(',').filter { it.isNotEmpty() }.ifEmpty { null }
    } catch (missing: ReflectiveOperationException) {
        null
    }
}
