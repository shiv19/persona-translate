const LANG_MAP: Record<string, string> = {
  vietnamese: "vi-VN",
  viet: "vi-VN",
  korean: "ko-KR",
  japanese: "ja-JP",
  chinese: "zh-CN",
  mandarin: "zh-CN",
  cantonese: "zh-HK",
  spanish: "es-ES",
  french: "fr-FR",
  german: "de-DE",
  portuguese: "pt-BR",
  italian: "it-IT",
  thai: "th-TH",
  tagalog: "fil-PH",
  filipino: "fil-PH",
  hindi: "hi-IN",
  tamil: "ta-IN",
  arabic: "ar-SA",
  russian: "ru-RU",
  indonesian: "id-ID",
  malay: "ms-MY",
  english: "en-US",
}

export function resolveLangCode(language: string): string | undefined {
  const lower = language.toLowerCase().trim()
  for (const [key, code] of Object.entries(LANG_MAP)) {
    if (lower.includes(key)) return code
  }
  return undefined
}
