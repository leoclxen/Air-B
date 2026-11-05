import { GoogleGenAI, Type } from '@google/genai';

const CANDIDATE_FLASH_MODELS = [
  'gemini-flash-latest',
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite'
];

const OCR_PROMPT = `
Jsi špičkový OCR model pro digitalizaci ubytovacích lístků ("REGISTRATION FORM") pro místní poplatek z pobytu v hl. m. Praze dle zákona č. 565/1990 Sb.

Struktura formuláře (může být orientován svisle nebo vodorovně):
1. HLAVIČKA A IDENTIFIKACE:
   - Check-in (Příjezd) - např. Oct 1, 2026 -> převeď na ISO YYYY-MM-DD (2026-10-01).
   - Check-out (Odjezd) - např. Oct 8, 2026 -> převeď na ISO YYYY-MM-DD (2026-10-08).
   - Počet nocí (nights) - např. 7 nights -> číslo 7.
   - Označení jednotky (unit) - např. Unit E302.
   - Název rezidence / ubytování (např. Karolina Plazza - Karlín).
   - Adresa v Praze (např. Sokolovská 694/102, 186 00 Praha 8).
   - Městská část (např. 'praha8' pro Prahu 8, 'praha1' pro Prahu 1 atd.).
   - Ubytovatel / Hostitel (např. Bc. Michaela Heidenreichová).
   - IČO / Variabilní symbol (např. 17974305).

2. TABULKA UBYTOVANÝCH OSOB (až pro 3 osoby na formuláři):
   - Zpracuj pouze skutečně fyzicky vyplněné řádky! Prázdné řádky ignoruj.
   - Do hodnot polí vkládej POUZE čistá data (žádné vysvětlivky, komentáře ani úvahy).
   - Pokud je pole prázdné nebo přeškrtnuté, zadej prázdný řetězec "".
   - Pro každou zapsanou osobu extrahuj:
     * Příjmení (Last name) - např. Kinkaid
     * Jméno (First name) - např. Kenneth
     * Datum narození (Date of birth) - ve formátu YYYY-MM-DD (např. 01.10.1971 -> 1971-10-01)
     * Státní občanství (Citizenship) - např. USA, CZ, DE
     * Účel pobytu (Purpose of stay) - např. 10 turistika / leisure
     * Číslo cestovního dokladu / pasu (Passport No) - např. A50465791
     * Číslo víza (Visa No)
     * Trvalé bydliště v zahraničí (Home Address) - např. 6917 S Queen St Littleton Co
     * Osvobození: Pokud je věk osoby v den příjezdu nižší než 18 let, exemptionReason = 'under18', jinak 'none'.

DŮLEŽITÉ: Každou osobu zahrň do pole 'guests' pouze JEDNOU. Všechny osoby na jednom lístku sdílejí Check-in, Check-out a počet nocí z hlavičky lístku.
`;

export async function runClientGeminiOcr(
  imageBase64: string,
  apiKey: string,
  preferredModel?: string,
  mimeType: string = 'image/jpeg'
): Promise<{ data: any; modelUsed: string }> {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Chybí Gemini API klíč. Zadejte klíč v Nastavení nebo se připojte ke svému Google Sešitu.');
  }

  const ai = new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });

  const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');

  const modelQueue: string[] = [];
  if (preferredModel && preferredModel !== 'auto') {
    modelQueue.push(preferredModel);
  }
  CANDIDATE_FLASH_MODELS.forEach(m => {
    if (!modelQueue.includes(m)) modelQueue.push(m);
  });

  let lastError: any = null;
  let extractedData: any = null;
  let usedModel = '';

  for (const candidate of modelQueue) {
    try {
      const response = await ai.models.generateContent({
        model: candidate,
        contents: [
          {
            role: 'user',
            parts: [
              { text: OCR_PROMPT },
              {
                inlineData: {
                  mimeType,
                  data: cleanBase64
                }
              }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detectedPropertyName: { type: Type.STRING },
              detectedAddress: { type: Type.STRING },
              detectedDistrictKey: { type: Type.STRING },
              detectedHostName: { type: Type.STRING },
              detectedVS: { type: Type.STRING },
              detectedUnit: { type: Type.STRING },
              dateArrival: { type: Type.STRING },
              dateDeparture: { type: Type.STRING },
              nights: { type: Type.INTEGER },
              guests: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    lastName: { type: Type.STRING },
                    firstName: { type: Type.STRING },
                    birthDate: { type: Type.STRING },
                    nationality: { type: Type.STRING },
                    purposeOfStay: { type: Type.STRING },
                    passportNumber: { type: Type.STRING },
                    visaNumber: { type: Type.STRING },
                    homeAddress: { type: Type.STRING },
                    exemptionReason: { type: Type.STRING }
                  },
                  required: ['lastName', 'firstName']
                }
              }
            },
            required: ['dateArrival', 'dateDeparture', 'nights', 'guests']
          }
        }
      });

      const rawText = response.text;
      if (rawText) {
        extractedData = JSON.parse(rawText);
        usedModel = candidate;
        break;
      }
    } catch (err: any) {
      console.warn(`Client OCR model ${candidate} failed:`, err);
      lastError = err;
    }
  }

  if (!extractedData) {
    throw lastError || new Error('Žádný z modelů Gemini nedokázal zpracovat obrázek.');
  }

  return {
    data: extractedData,
    modelUsed: usedModel
  };
}

export interface GeminiModelInfo {
  name: string; // e.g. "gemini-2.5-flash"
  displayName: string;
  description?: string;
  isRecommended?: boolean;
}

export const CURATED_OCR_MODELS: GeminiModelInfo[] = [
  {
    name: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    description: 'Nejnovější model s bleskovou rychlostí a vysokou přesností čtení.',
    isRecommended: true
  },
  {
    name: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash',
    description: 'Rychlý multimodální model pro standardní dokumenty a formuláře.',
    isRecommended: true
  },
  {
    name: 'gemini-flash-latest',
    displayName: 'Gemini Flash Latest',
    description: 'Dynamický alias vždy směřující na nejnovější stabilní verzi Flash.',
    isRecommended: true
  },
  {
    name: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    description: 'Maximální analytická přesnost pro obtížně čitelné a ručně psané lístky.',
    isRecommended: false
  },
  {
    name: 'gemini-1.5-flash',
    displayName: 'Gemini 1.5 Flash',
    description: 'Osvědčený lehký model s dlouhým kontextem.',
    isRecommended: false
  },
  {
    name: 'gemini-1.5-pro',
    displayName: 'Gemini 1.5 Pro',
    description: 'Pokročilý multimodální model pro komplexní úlohy.',
    isRecommended: false
  }
];

/**
 * Fetches available Gemini models using the user's API key
 */
export async function fetchAvailableGeminiModels(apiKey: string): Promise<GeminiModelInfo[]> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error('Chybí Gemini API klíč. Zadejte jej prosím v nastavení nebo připojte Google Sheet.');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`
  );

  if (!response.ok) {
    let errMsg = `Chyba při komunikaci s Gemini API (kód ${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson?.error?.message) {
        errMsg = errJson.error.message;
      }
    } catch {
      // ignore json parse error
    }
    throw new Error(errMsg);
  }

  const data = await response.json();
  const rawModels: any[] = Array.isArray(data.models) ? data.models : [];

  // Filter models that support content generation and are multimodal/gemini
  const validModels = rawModels.filter((m: any) => {
    const methods: string[] = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
    const name: string = m.name || '';
    const hasGenContent = methods.includes('generateContent');
    const isGemini = /gemini/i.test(name);
    const isNotUnsupported = !/embedding|aqa|imagen|learnlm|robotics/i.test(name);
    return hasGenContent && isGemini && isNotUnsupported;
  });

  if (validModels.length === 0) {
    return CURATED_OCR_MODELS;
  }

  const parsedList: GeminiModelInfo[] = validModels.map((m: any) => {
    const cleanId = String(m.name || '').replace(/^models\//, '');
    const isRecommended = /2\.5-flash|2\.0-flash|flash-latest/i.test(cleanId);
    return {
      name: cleanId,
      displayName: m.displayName || cleanId,
      description: m.description || '',
      isRecommended
    };
  });

  // Sort: recommended first, then alphabetically
  parsedList.sort((a, b) => {
    if (a.isRecommended && !b.isRecommended) return -1;
    if (!a.isRecommended && b.isRecommended) return 1;
    return a.name.localeCompare(b.name);
  });

  return parsedList;
}

