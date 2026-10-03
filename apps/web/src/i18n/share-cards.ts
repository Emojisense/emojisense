/**
 * Share-card words that the page catalogs do not already have (src/og/registry.ts). Headlines,
 * leads and plan words come from the catalogs; only these short labels live here. Every locale
 * must have every field (the type requires it).
 */
import type { Locale } from "./locales";

export interface ShareCardCopy {
  /** The home card's headline: shorter than the hero's. */
  homeHeadline: string;
  homeFootnote: string;
  /** Panel header of the home card: the left and the right column. */
  whatPeopleType: string;
  topResults: string;
  pricingSub: string;
  /** Panel header of the pricing card: the left and the right column. */
  plans: string;
  perMonth: string;
  /** Panel header of the integrations card. */
  wherePeopleType: string;
  /** `{integrations}` and `{languages}` are numbers. */
  integrationsFootnote: string;
}

export const SHARE_CARD_COPY: Record<Locale, ShareCardCopy> = {
  en: {
    homeHeadline: "Everything emoji, for every app.",
    homeFootnote: "Search · Reactions · Hosted sets · Analytics",
    whatPeopleType: "what people type",
    topResults: "top results",
    pricingSub: "Search and reaction suggestions are free on every plan.",
    plans: "plans",
    perMonth: "per month",
    wherePeopleType: "where people type",
    integrationsFootnote: "{integrations} integrations · {languages} languages · one engine",
  },
  zh: {
    homeHeadline: "每个应用的emoji，都在这里。",
    homeFootnote: "搜索 · 表情回应 · 托管表情集 · 分析",
    whatPeopleType: "人们输入的内容",
    topResults: "最佳结果",
    pricingSub: "每个套餐都免费提供搜索和表情回应建议。",
    plans: "套餐",
    perMonth: "每月",
    wherePeopleType: "输入场景",
    integrationsFootnote: "{integrations} 个集成 · {languages} 种语言 · 一个引擎",
  },
  hi: {
    homeHeadline: "हर ऐप के लिए emoji की हर सुविधा।",
    homeFootnote: "खोज · प्रतिक्रियाएँ · होस्टेड सेट · एनालिटिक्स",
    whatPeopleType: "लोग क्या लिखते हैं",
    topResults: "सबसे अच्छे नतीजे",
    pricingSub: "खोज और प्रतिक्रिया सुझाव हर प्लान पर मुफ़्त हैं।",
    plans: "प्लान",
    perMonth: "प्रति माह",
    wherePeopleType: "लोग कहाँ लिखते हैं",
    integrationsFootnote: "{integrations} इंटीग्रेशन · {languages} भाषाएँ · एक इंजन",
  },
  es: {
    homeHeadline: "Todo para tus emoji, en cada app.",
    homeFootnote: "Búsqueda · Reacciones · Sets alojados · Analítica",
    whatPeopleType: "lo que escribe la gente",
    topResults: "mejores resultados",
    pricingSub: "La búsqueda y las sugerencias de reacciones son gratis en todos los planes.",
    plans: "planes",
    perMonth: "al mes",
    wherePeopleType: "dónde escribe la gente",
    integrationsFootnote: "{integrations} integraciones · {languages} idiomas · un motor",
  },
  ar: {
    homeHeadline: "كل ما يخص الإيموجي، لكل تطبيق.",
    homeFootnote: "بحث · تفاعلات · مجموعات مستضافة · تحليلات",
    whatPeopleType: "ما يكتبه الناس",
    topResults: "أفضل النتائج",
    pricingSub: "البحث واقتراحات التفاعل مجانية في كل الخطط.",
    plans: "الخطط",
    perMonth: "شهريًا",
    wherePeopleType: "أين يكتب الناس",
    // Label form: Arabic counted nouns change with the number.
    integrationsFootnote: "التكاملات: {integrations} · اللغات: {languages} · محرك واحد",
  },
  fr: {
    homeHeadline: "Tout pour les emoji, dans toutes les applications.",
    homeFootnote: "Recherche · Réactions · Jeux hébergés · Statistiques",
    whatPeopleType: "ce que les gens tapent",
    topResults: "meilleurs résultats",
    pricingSub: "La recherche et les suggestions de réactions sont gratuites dans toutes les offres.",
    plans: "offres",
    perMonth: "par mois",
    wherePeopleType: "où l’on écrit",
    integrationsFootnote: "{integrations} intégrations · {languages} langues · un seul moteur",
  },
  bn: {
    homeHeadline: "প্রতিটি অ্যাপের জন্য ইমোজির সবকিছু।",
    homeFootnote: "অনুসন্ধান · প্রতিক্রিয়া · হোস্ট করা সেট · অ্যানালিটিক্স",
    whatPeopleType: "মানুষ যা লেখে",
    topResults: "সেরা ফলাফল",
    pricingSub: "অনুসন্ধান ও প্রতিক্রিয়ার পরামর্শ প্রতিটি প্ল্যানে বিনামূল্যে।",
    plans: "প্ল্যান",
    perMonth: "প্রতি মাসে",
    wherePeopleType: "মানুষ যেখানে লেখে",
    integrationsFootnote: "{integrations}টি ইন্টিগ্রেশন · {languages}টি ভাষা · একটি ইঞ্জিন",
  },
  pt: {
    homeHeadline: "Tudo para usar emoji, em qualquer app.",
    homeFootnote: "Busca · Reações · Conjuntos hospedados · Análises",
    whatPeopleType: "o que as pessoas digitam",
    topResults: "melhores resultados",
    pricingSub: "Busca e sugestões de reações são grátis em todos os planos.",
    plans: "planos",
    perMonth: "por mês",
    wherePeopleType: "onde as pessoas digitam",
    integrationsFootnote: "{integrations} integrações · {languages} idiomas · um motor",
  },
  ru: {
    homeHeadline: "Всё для emoji. Для любого приложения.",
    homeFootnote: "Поиск · Реакции · Наборы emoji · Аналитика",
    whatPeopleType: "что пишут люди",
    topResults: "лучшие результаты",
    pricingSub: "Поиск и подсказки реакций бесплатны на любом тарифе.",
    plans: "тарифы",
    perMonth: "в месяц",
    wherePeopleType: "где пишут люди",
    // Label form: Russian counted nouns change with the number.
    integrationsFootnote: "Интеграций: {integrations} · языков: {languages} · один движок",
  },
  id: {
    homeHeadline: "Semua kebutuhan emoji, untuk setiap aplikasi.",
    homeFootnote: "Pencarian · Reaksi · Set yang di-host · Analitik",
    whatPeopleType: "yang diketik orang",
    topResults: "hasil teratas",
    pricingSub: "Pencarian dan saran reaksi gratis di setiap paket.",
    plans: "paket",
    perMonth: "per bulan",
    wherePeopleType: "tempat orang mengetik",
    integrationsFootnote: "{integrations} integrasi · {languages} bahasa · satu mesin",
  },
  tr: {
    homeHeadline: "Her uygulama için emojiye dair her şey.",
    homeFootnote: "Arama · Tepkiler · Barındırılan setler · Analitik",
    whatPeopleType: "insanların yazdığı",
    topResults: "en iyi sonuçlar",
    pricingSub: "Arama ve tepki önerileri her planda ücretsiz.",
    plans: "planlar",
    perMonth: "aylık",
    wherePeopleType: "insanların yazdığı yer",
    integrationsFootnote: "{integrations} entegrasyon · {languages} dil · tek motor",
  },
};
