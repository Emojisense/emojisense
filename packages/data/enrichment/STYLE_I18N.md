# Enrichment style guide: other languages

This guide is for the languages after English and Turkish (src/locales.ts). Read STYLE.md first:
its categories, quality bar and rules all apply. This file only lists what is different.

## Record shape (one language per record)

```json
{
  "hexcode": "1F382",
  "emoji": "🎂",
  "desc": "one line in the target language: how people use it in chat",
  "synonym": [], "slang": [], "pop_culture": [], "dev": [], "typo": [], "intent": [],
  "low": []
}
```

All seven arrays must exist. Use `[]` when a category does not apply. The optional `top` list (STYLE.md) works the
same here: the 1–3 strongest real-world phrases for this emoji (zh 😂 `笑死`), placed before every category; it is
the only way to beat the category order and reach the core pack.

## Input you get per emoji

| Field | Meaning |
|---|---|
| `en_label`, `en_desc`, `en_aliases` | The English meaning, for grounding only. **Do not translate the list.** Use it to understand what the emoji is used for. |
| `label`, `tags` | CLDR name and keywords in the target language. They are indexed already, so do not repeat them. |

## Size

| | Unique aliases |
|---|---|
| Most emoji | 15–35 |
| Very popular emoji (😂 👍 ❤️ 🔥 🎉 🙏 😭 💀 ✅ 👀 🥳 😍) | up to 50 |
| Flags and rare symbols | 6–20. Do not pad. |

## What good looks like

- **Write what native speakers type**, not translations. Use real chat slang, idioms, holidays,
  greetings, sports, TV, music and food of the cultures that speak the language. Examples: Spanish
  `feliz cumple`, `qué risa`, `olé`; Portuguese `parabéns`, `kkkk`; Hindi `बधाई हो`, `shubh
  deepawali`; Arabic `مبروك`, `ههههه`, `عيد مبارك`; Indonesian `wkwk`, `selamat ultah`;
  Russian `ахаха`, `с днём рождения`; Chinese `哈哈哈`, `生日快乐`, `加油`; Bengali `শুভ নববর্ষ`;
  French `mdr`, `bon anniv`.
- **Romanized typing.** When people commonly type the language in Latin letters (see
  `romanized` in src/locales.ts: Hinglish, Arabizi, pinyin without tones, Banglish, Russian
  translit), add the most common romanized forms as aliases too (for example `badhai ho`,
  `mabrook`, `jiayou`, `s dnem rozhdeniya`). Put them in `slang`, or in `synonym` for plain words.
- **Regional variants.** Cover the big regions (Spanish: Spain and Latin America; Portuguese:
  Brazil first, then Portugal; Arabic: Modern Standard plus common Gulf, Egyptian and Levantine
  chat words; French: France plus Québec and West Africa where common).
- `dev`: only real developer jargon that speakers use in this language (often English loanwords).
  Usually `[]`.
- `typo`: real misspellings, missing accents only where people also misspell the letters (the
  normalizer already folds á→a, ñ→n, ç→c and ё→е, so do not add accent-stripped copies).
- Lowercase in the target language. Chinese, Arabic, Hindi and Bengali have no case.
- Same safety rules as STYLE.md: PG-13, no slurs, no real people's names, sensitive items in `low`.

## Check

```
cd /Users/peker/GitHub/emojisense/packages/data && unset -f node npm npx pnpm 2>/dev/null; export PATH="$HOME/.nvm/versions/node/v24.5.0/bin:$PATH"; /Users/peker/GitHub/emojisense/node_modules/.bin/tsx scripts/check-locale.ts <locale> enrichment/_batches/<locale>/bNN.input.json enrichment/_batches/<locale>/bNN.p*.json
```
