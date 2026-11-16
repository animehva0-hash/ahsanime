/**
 * Shared 54-language catalog for subtitle translation.
 * Reception format: ISO-ish codes with friendly labels. Hinglish is a
 * pseudo-language (Roman script Hindi-English mix) handled via prompt rules.
 */

export type SubtitleLanguage = {
  code: string;
  label: string;
  native?: string;
  /** Extra steering passed into the translation prompt. */
  instruction?: string;
};

export const SUBTITLE_LANGUAGES: SubtitleLanguage[] = [
  { code: "en", label: "English", native: "English" },
  {
    code: "hinglish",
    label: "Hinglish (Roman)",
    native: "Hinglish",
    instruction: [
      "Translate into PURE Hinglish — Hindi written in Roman (Latin) script ONLY.",
      "STRICT RULES:",
      "1. NO English words allowed. Every word must be Hindi/Urdu written in Roman script.",
      "2. Convert ALL English words to their Hindi equivalents: 'I'→'main', 'you'→'tu/tum', 'is'→'hai', 'the'→'wo', 'a/an'→'ek', 'and'→'aur', 'but'→'par/lekin', 'or'→'ya', 'to'→'ko', 'for'→'ke liye', 'with'→'ke saath', 'from'→'se', 'in'→'mein', 'on'→'pe', 'at'→'par', 'my'→'mera', 'your'→'tera', 'his/her'→'uska', 'our'→'hamara', 'their'→'unka', 'this'→'yeh', 'that'→'woh', 'what'→'kya', 'who'→'kaun', 'where'→'kahan', 'when'→'kab', 'why'→'kyun', 'how'→'kaise', 'yes'→'haan/ji', 'no'→'nahi', 'okay'→'theek hai', 'thanks'→'shukriya', 'please'→'meherbani', 'sorry'→'maaf karna'.",
      "3. Keep ONLY: character names, Japanese honorifics (-san, -kun, -chan, -sama, -sensei, -senpai), numbers, punctuation.",
      "4. Use natural spoken Hinglish: 'yaar', 'arre', 'matlab', 'bas', 'bilkul', 'thoda', 'bahut', 'kya', 'kyun', 'mera', 'tera', 'chal', 'chalo', 'dekho', 'suno', 'accha', 'waah', 'oh ho', 'arre yaar', 'chal na', 'dekh na'.",
      "5. Preserve tone/emotion exactly. Keep sentence order same as English for caption sync.",
      "6. Example: 'I can't believe this!' → 'Yaar main believe nahi kar sakta yeh!' ❌ WRONG → 'Yaar main yakeen nahi kar sakta yeh!' ✓ CORRECT",
      "7. Example: 'Let's go!' → 'Chalo jaate hain!' ✓",
    ].join(" "),
  },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "ur", label: "Urdu", native: "اردو" },
  { code: "bn", label: "Bengali", native: "বাংলা" },
  { code: "ta", label: "Tamil", native: "தமிழ்" },
  { code: "te", label: "Telugu", native: "తెలుగు" },
  { code: "mr", label: "Marathi", native: "मराठी" },
  { code: "gu", label: "Gujarati", native: "ગુજરાતી" },
  { code: "pa", label: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "kn", label: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ml", label: "Malayalam", native: "മലയാളം" },
  { code: "ne", label: "Nepali", native: "नेपाली" },
  { code: "si", label: "Sinhala", native: "සිංහල" },
  { code: "ja", label: "Japanese", native: "日本語" },
  { code: "ko", label: "Korean", native: "한국어" },
  { code: "zh-CN", label: "Chinese (Simplified)", native: "简体中文" },
  { code: "zh-TW", label: "Chinese (Traditional)", native: "繁體中文" },
  { code: "th", label: "Thai", native: "ไทย" },
  { code: "vi", label: "Vietnamese", native: "Tiếng Việt" },
  { code: "id", label: "Indonesian", native: "Bahasa Indonesia" },
  { code: "ms", label: "Malay", native: "Bahasa Melayu" },
  { code: "fil", label: "Filipino", native: "Filipino" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "fr", label: "French", native: "Français" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "it", label: "Italian", native: "Italiano" },
  { code: "nl", label: "Dutch", native: "Nederlands" },
  { code: "pl", label: "Polish", native: "Polski" },
  { code: "cs", label: "Czech", native: "Čeština" },
  { code: "sk", label: "Slovak", native: "Slovenčina" },
  { code: "hu", label: "Hungarian", native: "Magyar" },
  { code: "ro", label: "Romanian", native: "Română" },
  { code: "bg", label: "Bulgarian", native: "Български" },
  { code: "hr", label: "Croatian", native: "Hrvatski" },
  { code: "sr", label: "Serbian", native: "Српски" },
  { code: "sl", label: "Slovenian", native: "Slovenščina" },
  { code: "el", label: "Greek", native: "Ελληνικά" },
  { code: "ru", label: "Russian", native: "Русский" },
  { code: "uk", label: "Ukrainian", native: "Українська" },
  { code: "tr", label: "Turkish", native: "Türkçe" },
  { code: "ar", label: "Arabic", native: "العربية" },
  { code: "fa", label: "Persian", native: "فارسی" },
  { code: "he", label: "Hebrew", native: "עברית" },
  { code: "sw", label: "Swahili", native: "Kiswahili" },
  { code: "af", label: "Afrikaans", native: "Afrikaans" },
  { code: "sv", label: "Swedish", native: "Svenska" },
  { code: "no", label: "Norwegian", native: "Norsk" },
  { code: "da", label: "Danish", native: "Dansk" },
  { code: "fi", label: "Finnish", native: "Suomi" },
  { code: "et", label: "Estonian", native: "Eesti" },
  { code: "lv", label: "Latvian", native: "Latviešu" },
  { code: "lt", label: "Lithuanian", native: "Lietuvių" },
];

export function languageFor(code: string): SubtitleLanguage | null {
  return (
    SUBTITLE_LANGUAGES.find(
      (l) => l.code.toLowerCase() === code.trim().toLowerCase(),
    ) ?? null
  );
}
