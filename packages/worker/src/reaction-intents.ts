/**
 * What a chat message is doing (thanking, congratulating, joking…) and the reactions people use
 * for it. Phrases are matched as whole words on the normalized text (lowercase, accents folded,
 * emoji and punctuation removed: "teşekkür" → "tesekkur", "d'accord" → "daccord"), so they cover
 * en, tr, es, fr, de, pt and it without a language router. Keep phrases short and unambiguous;
 * the message embedding already handles paraphrases (reaction-rank.ts).
 */
export interface Intent {
  name: string;
  /** `|`-separated whole-word phrases in normalized form, one line per language. */
  phrases: string;
  /** Patterns over the normalized text, for cues with many spellings ("hahaha", "kkkk"). */
  patterns?: readonly RegExp[];
  /** Reactions, best first. */
  reactions: string;
}

export const INTENTS: readonly Intent[] = [
  {
    name: "birthday",
    phrases:
      "happy birthday|birthday|bday|hbd" +
      "|dogum gunu|dogum gunun|iyi ki dogdun|mutlu yillar" +
      "|feliz cumpleanos|cumpleanos|joyeux anniversaire|bon anniversaire|geburtstag" +
      "|feliz aniversario|buon compleanno",
    reactions: "🎂 🥳 🎉 🎈 🎁 ❤️",
  },
  {
    name: "celebration",
    phrases:
      "congrats|congratulations|congratz|well done|great job|good job|nice work|great work|kudos" +
      "|nailed it|crushed it|we did it|hooray|yay|woohoo|shipped|launched|released|got the job" +
      "|promoted|engaged|graduated|we won|milestone" +
      "|tebrikler|tebrik ederim|helal|basardik|basardin|harika is" +
      "|felicidades|enhorabuena|felicitaciones|bien hecho|lo logramos" +
      "|felicitations|bravo|bien joue|gluckwunsch|gratuliere|gratulation|gut gemacht" +
      "|parabens|mandou bem|congratulazioni|complimenti",
    patterns: [/\b(?:hit|reached|passed) \d+\s?k\b/],
    reactions: "🎉 🙌 👏 🥳 🚀 🔥 🎊 💯",
  },
  {
    name: "thanks",
    phrases:
      "thanks|thank you|thx|tysm|ty|appreciate it|much appreciated|grateful" +
      "|tesekkur|tesekkurler|tesekkur ederim|sag ol|sagol|eyvallah" +
      "|gracias|merci|danke|dankeschon|vielen dank|obrigado|obrigada|valeu|grazie",
    reactions: "🙏 ❤️ 🙌 🫶 🤗 🥹",
  },
  {
    name: "sympathy",
    phrases:
      "sorry for your loss|condolences|rip|rest in peace|passed away|sorry to hear|so sorry|get well" +
      "|thinking of you|gutted|heartbroken" +
      "|basiniz sag olsun|bas sagligi|gecmis olsun|cok uzgunum|allah rahmet eylesin" +
      "|lo siento|mis condolencias|un abrazo|mejorate|desole|condoleances" +
      "|tut mir leid|beileid|gute besserung|sinto muito|meus pesames|condoglianze",
    reactions: "😢 ❤️ 🫂 🙏 💔 😭",
  },
  {
    name: "humor",
    phrases:
      "hilarious|so funny|im dead|cok komik|komik|muy gracioso|que risa|me muero|no puedo mas" +
      "|trop drole|mort de rire|so lustig|zu geil|que engracado|engracado|che ridere",
    patterns: [
      /\b(?:a?(?:ha|he|hi){2,}h?|(?:ja|je|ji){2,}j?|lo+l|lmf?ao+|rofl|k{3,}|(?:rs){2,}|x+d+|mdr|ptdr)\b/,
    ],
    reactions: "😂 🤣 💀 😆",
  },
  {
    name: "agreement",
    phrases:
      "agree|agreed|exactly|absolutely|sounds good|lets do it|makes sense|fair enough|on it|will do" +
      "|same here|katiliyorum|aynen|kesinlikle|anlastik|de acuerdo|exacto|totalmente" +
      "|daccord|tout a fait|exactement|on y va|einverstanden|genau|auf jeden fall|machen wir" +
      "|concordo|exatamente|com certeza|bora|fechado|daccordo",
    patterns: [/(?:^| )\+1(?: |$)/],
    reactions: "👍 💯 🙌 ✅ 👌 🤝",
  },
  {
    name: "frustration",
    phrases:
      "ugh|argh|failing|failed|broken|cancelled|canceled|delayed|annoying|frustrating|worst|sucks" +
      "|nightmare|stuck|mondays|not again|bozuldu|iptal|berbat|otra vez|que rabia|jen ai marre" +
      "|schon wieder|nervt|kaputt|de novo|que raiva",
    reactions: "😩 🤦 😫 😤 😬 🫠",
  },
  {
    name: "alert",
    phrases: "is down|outage|incident|urgent|asap|on fire|emergency|all hands|sev1|acil|urgente|dringend",
    reactions: "🚨 👀 😱 🫡 😬 🔥",
  },
  {
    name: "luck",
    phrases:
      "good luck|fingers crossed|you got this|youve got this|best of luck|rooting for you" +
      "|bol sans|basarilar|buena suerte|mucho exito|bonne chance|viel gluck|viel erfolg|boa sorte" +
      "|in bocca al lupo",
    reactions: "🤞 🍀 💪 🙏 ✨",
  },
  {
    name: "welcome",
    phrases:
      "welcome|good morning|hos geldin|hosgeldin|hos geldiniz|gunaydin|bienvenido|bienvenida" +
      "|buenos dias|bienvenue|willkommen|guten morgen|bem vindo|bem vinda|bom dia|benvenuto",
    reactions: "👋 🤗 🎉 🙌 ❤️",
  },
  {
    name: "love",
    phrases:
      "love you|love it|love this|miss you|so cute|adorable|so sweet|seni seviyorum|cok tatli" +
      "|ozledim|te quiero|te amo|que bonito|je taime|trop mignon|hab dich lieb|so suss|que lindo" +
      "|que fofo|ti amo",
    reactions: "❤️ 😍 🥰 🫶",
  },
  {
    name: "surprise",
    phrases:
      "wow|omg|no way|whoa|unbelievable|insane|mind blown|vay|inanilmaz|increible|no puede ser" +
      "|incroyable|unglaublich|wahnsinn|nossa|incrivel",
    reactions: "😮 🤯 😱 👀 🔥",
  },
  {
    name: "request",
    phrases: "can you|could you|please|pls|rica etsem|por favor|sil te plait|bitte",
    reactions: "👀 👍 ✅ 🫡",
  },
  {
    name: "tired",
    phrases: "tired|exhausted|sleepy|need coffee|yorgunum|cansado|cansada|fatigue|mude",
    reactions: "😴 🥱 ☕ 😩",
  },
];

const phraseLists = new WeakMap<Intent, string[]>();
const phrasesOf = (intent: Intent) => {
  let list = phraseLists.get(intent);
  if (!list) {
    list = intent.phrases.split("|").map((phrase) => ` ${phrase} `);
    phraseLists.set(intent, list);
  }
  return list;
};

/** The intents whose cues occur in the normalized text, in INTENTS order. */
export function detectIntents(normalized: string, intents: readonly Intent[] = INTENTS): Intent[] {
  const padded = ` ${normalized} `;
  return intents.filter(
    (intent) =>
      phrasesOf(intent).some((phrase) => padded.includes(phrase)) ||
      (intent.patterns ?? []).some((pattern) => pattern.test(normalized)),
  );
}
