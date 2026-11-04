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
