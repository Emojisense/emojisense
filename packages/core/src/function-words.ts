/**
 * Function words (stopwords) per pack locale: pronouns, articles, prepositions, conjunctions,
 * auxiliaries, particles, intensifiers and question words. They carry little meaning in an emoji
 * query, so a sentence such as "我想躺平" or "aku lagi capek banget" is ranked by its content words
 * (PACK_FORMAT.md §4, "Function words"). Negations are never listed: "不开心", "не смешно" and
 * "gak lucu" must keep their sense.
 *
 * Every entry is one token, already normalized (§3): accents folded ("très" → "tres"), й → и,
 * Arabic hamza seats dropped ("أنا" → "انا"). Common romanized forms (Hinglish, Banglish, Arabizi,
 * Russian translit) belong to their locale. Changing a list is a ranking change: regenerate the
 * Swift golden file (sdks/swift/scripts/make-golden.ts), which also checks the Swift copy.
 */
export const FUNCTION_WORDS: Readonly<Record<string, readonly string[]>> = splitLists({
  en: [
    "a an the of to in on at for from by is are am be im i me my you your u it its this that so",
    "and or with just very really too we our they them he she his her",
  ],
  tr: ["bir ve ile bu su cok da de mi ben sen o icin gibi"],
  zh: [
    "我 你 您 他 她 它 我们 你们 他们 她们 它们 咱 咱们 自己 大家 的 得 之 了 着 过 吧 呢 吗 啊 呀 啦 嘛 哦 噢 喔 哟 是 在 有 会 能 可以 应该 很 太",
    "真 真的 非常 好 超 特别 挺 有点 有点儿 一点 一点儿 一下 都 也 还 就 才 又 再 只 只是 已经 刚 刚刚 正在 一直 总是 还是 就是 其实 到底 实在 简直 和 跟",
    "与 或 或者 但 但是 可是 因为 所以 如果 然后 而且 这 那 这个 那个 这些 那些 这样 那样 这么 那么 这里 那里 个 一个 一些 些 把 被 给 对 从 向 为 为了 比",
    "想 要",
  ],
  ru: [
    "я ты он она оно мы вы они меня тебя его ее нас вас их мне тебе ему еи нам вам им мнои тобои",
    "ним неи них себя себе мои моя мое твои твоя твое наш наша наше наши ваш ваша ваше ваши свои",
    "своя свое это этот эта эти тот та то те такои такая такое такие там тут здесь вот в во на с",
    "со к ко по о об от до из за для у при про и а но или что чтобы если когда как потому тоже",
    "также же ли бы быть был была было были буду будет будем будешь будут очень так уже еще",
    "просто только даже вообще совсем ну прям прямо реально весь вся все ya ty ona oni menya",
    "tebya mne tebe eto etot eta takoy takaya tam tut vot v s k po ot iz dlya pro ili chto chtoby",
    "esli kogda kak tozhe zhe li byl byla bylo ochen uzhe eshche esche prosto tolko dazhe",
    "voobshche nu vse vsyo хочу хочешь хочет хотим хотите хотят можно надо нужно",
  ],
  id: [
    "aku saya kamu kau engkau anda dia ia kita kami mereka gue gua gw lo lu elo beliau ini itu",
    "sini situ sana di ke dari pada untuk buat sama dengan dgn oleh tentang dalam kepada dan atau",
    "tapi tetapi karena karna krn soalnya jadi kalau kalo yang yg juga jg lagi lg sedang sudah",
    "udah udh sdh akan bisa harus boleh masih banget bgt sangat sekali amat terlalu agak cukup",
    "paling ya yah dong deh sih kok kan nih tuh lah kah pun loh lho ada adalah aja saja mau ingin",
    "pengen pingin",
  ],
  es: [
    "yo tu el ella ello nosotros nosotras vosotros vosotras ellos ellas usted ustedes me te se",
    "nos os le les mi mis tus su sus nuestro nuestra la los las un una unos unas lo al del a de",
    "en con por para desde hasta entre hacia y e o u pero que porque como cuando es soy eres",
    "somos son estoy estas esta estamos estan estar ser fue era he has ha hemos han hay tengo",
    "tienes tiene voy vas va muy mucho mucha muchos muchas tan tanto tanta demasiado bastante ya",
    "tambien aun todavia mas todo toda todos todas este esto estos ese esa eso esos esas aquel",
  ],
  fr: [
    "je j tu il elle on nous vous ils elles me m te t se s moi toi lui leur eux ca cela ce c ceci",
    "mon ma mes ton ta tes sa ses notre nos votre vos leurs le la les l un une des du de d au aux",
    "a en dans sur pour par avec chez et ou mais donc que qu qui si comme quand parce suis es est",
    "sommes etes sont ai as avons avez ont etre avoir vais vas va tres trop tellement vraiment",
    "assez beaucoup aussi encore deja juste tout tous toute toutes y cest jai jsuis quil quelle",
    "quest cetait jetais jvais ya veux veut",
  ],
  pt: [
    "eu tu voce vc ele ela nos voces vcs eles elas me te se lhe lhes meu minha meus minhas teu",
    "tua seu sua seus suas nosso dele dela deles delas o a os as um uma uns umas de do da dos das",
    "em no na nas num numa por pelo pela pelos pelas para pra pro com ao aos ate e ou mas que",
    "porque pq como quando sou somos sao estou to esta ta estamos estao estar ser foi era tenho",
    "tem temos ter vou vai muito muita muitos muitas mt mto tao tanto tanta bastante mais ja",
    "ainda tambem tb tbm so isso isto esse essa este aquele aquela ne la quero quer",
  ],
  ar: [
    "انا انت انتي هو هي نحن احنا انتم انتو في من الى على عن مع و او ثم لكن بس لان اذا ان هذا هذه",
    "ذلك تلك هاد هادا هاي هذي ده دي دا قد لقد كان كانت يكون عم رح عندي جدا كتير كثير كثيرا اوي",
    "شوي شوية كمان يا كل اللي الذي التي ana enta enti inta inti howa heya hiya ehna e7na fi fe",
    "min mn 3ala 3la 3an ma3 w wa aw bas iza eza kan kanet hada hadi haza gedan geddan awi awy",
    "ktir kteer shway shwaya kaman kamaan ya kol elli illi 3am ra7 بدي ابي",
  ],
  hi: [
    "मैं मै मुझे मुझको मेरा मेरी मेरे तुम तुम्हें तुमको तुम्हारा तुम्हारी तुम्हारे तू तुझे तेरा",
    "तेरी तेरे आप आपको आपका आपकी आपके हम हमें हमको हमारा हमारी हमारे वह वो वे उसे उसको उसका उसकी",
    "उसके उन्हें उनका उनकी उनके यह ये इसे इसको इसका इसकी इसके का की के को से में मे पर ने तक लिए",
    "है हैं हूँ हूं हो था थी थे रहा रही रहे गया गयी गई गए हुआ हुई हुए कर करता करती करते और या",
    "लेकिन कि क्योंकि तो भी ही जी बहुत बहोत ज़्यादा ज्यादा काफ़ी काफी एकदम बिल्कुल बिलकुल थोड़ा",
    "थोड़ी main mai mujhe mujhko mera meri mere tum tumhe tumhara tumhari tu tujhe tera teri tere",
    "aap aapka aapki aapke hum humein hamara hamari woh wo vo yeh ye ka ki ke ko se mein par ne",
    "tak liye hai hain hu hoon hun ho tha thi raha rahi rahe gaya gayi gaye hua hui kar karta",
    "karti karte aur ya lekin kyunki toh bhi ji bahut bohot bahot bhot bht zyada jyada kafi ekdam",
    "bilkul thoda thodi चाहिए chahiye",
  ],
  bn: [
    "আমি আমার আমাকে আমায় আমরা আমাদের তুমি তোমার তোমাকে তোমায় তোমরা তোমাদের তুই তোর তোকে আপনি",
    "আপনার আপনাকে সে তার তাকে তিনি ও ওর ওরা এ এর এই ওই সেই তাদের এটা ওটা সেটা এটি থেকে দিয়ে জন্য",
    "জন্যে সাথে সঙ্গে মধ্যে কাছে আছে আছি আছো আছেন আছিস ছিল ছিলাম ছিলে হয় হচ্ছে হবে হলো হল হয়েছে",
    "হয়ে গেছে গেছি করছি করছো করছে করেছি করেছে করে এবং আর কিন্তু অথবা বা যে কারণ তাই তো খুব অনেক",
    "বেশি একটু একদম ভীষণ ami amar amake amra amader tumi tomar tomake tomra tui tor toke apni",
    "apnar se tar take ora ei oi eta ota theke diye jonno sathe achi acho chilo chilam hoy hocche",
    "hobe holo hoyeche gechi ebong ar kintu ba je karon tai khub onek beshi ektu ekdom korchi",
    "korcho korche korechi kore চাই",
  ],
});

/** Lists that apply to every query whatever its locale, as the single en + tr list did before. */
const ALWAYS_ACTIVE = ["en", "tr"];

const activeByLocale = new Map<string, ReadonlySet<string>>();

/**
 * The function words of a query in `locale`: the locale's own list plus the English and Turkish
 * lists (only those for a locale without a list). Other locales' lists do not apply, because a
 * function word of one language can be a content word of another: es "son" ("they are") is en
 * "son", pt "no" ("in the") is en "no".
 */
export function functionWordsFor(locale: string): ReadonlySet<string> {
  const code = Object.hasOwn(FUNCTION_WORDS, locale) ? locale : "en";
  let words = activeByLocale.get(code);
  if (!words) {
    words = new Set([...ALWAYS_ACTIVE, code].flatMap((list) => FUNCTION_WORDS[list] ?? []));
    activeByLocale.set(code, words);
  }
  return words;
}

function splitLists(lists: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(lists).map(([code, lines]) => [code, lines.join(" ").split(" ")]));
}
