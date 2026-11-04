import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as jsyaml from 'js-yaml';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Support JSON payloads up to 35MB for high-res mobile photos
app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));

// Allow iframe embedding inside Google Sites
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  // Avoid restrictive frame-ancestors so Google Sites can embed seamlessly
  res.removeHeader('X-Frame-Options');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Path to persistent data.yaml on server
const DATA_FILE = path.join(__dirname, 'data.yaml');

export interface Property {
  id: string;
  name: string;
  hostName: string;
  address: string;
  districtKey: string;
  variableSymbol: string;
}

export interface Guest {
  id: string;
  propertyId: string;
  unit: string;
  airbnbCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  birthDate: string;
  nationality: string;
  purposeOfStay: string;
  idDocumentNumber: string;
  idDocumentType: string;
  visaNumber: string;
  address: string;
  dateArrival: string;
  dateDeparture: string;
  nights: number;
  exemption: 'none' | 'under18' | 'ztp' | 'other';
  fee: number;
  createdAt: string;
}

interface AppData {
  meta: {
    version: string;
    description: string;
    lastUpdated: string;
    activePropertyId: string;
  };
  properties: Property[];
  guests: Guest[];
}

// Initial state: STRICTLY ZERO hardcoded properties and ZERO hardcoded guests
function getDefaultData(): AppData {
  return {
    meta: {
      version: '3.0',
      description: 'AirTax Praha - Evidence ubytovaných a poplatků z pobytu',
      lastUpdated: new Date().toISOString(),
      activePropertyId: ''
    },
    properties: [],
    guests: []
  };
}

function loadData(): AppData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = jsyaml.load(content) as any;
      if (parsed && typeof parsed === 'object') {
        return {
          meta: parsed.meta || {
            version: '3.0',
            description: 'AirTax Praha',
            lastUpdated: new Date().toISOString(),
            activePropertyId: ''
          },
          properties: Array.isArray(parsed.properties) ? parsed.properties : [],
          guests: Array.isArray(parsed.guests) ? parsed.guests : []
        };
      }
    }
  } catch (err) {
    console.error('Error reading data.yaml:', err);
  }
  const initial = getDefaultData();
  saveData(initial);
  return initial;
}

function saveData(data: AppData): void {
  try {
    data.meta.lastUpdated = new Date().toISOString();
    const yamlStr = jsyaml.dump(data, { indent: 2 });
    fs.writeFileSync(DATA_FILE, yamlStr, 'utf-8');
  } catch (err) {
    console.error('Error writing data.yaml:', err);
  }
}

// Ensure data file exists on server startup
loadData();

// ----------------------------------------------------
// API ROUTES FOR MULTI-DEVICE PERSISTENCE
// ----------------------------------------------------

// 1. Get full app state
app.get('/api/data', (_req, res) => {
  const data = loadData();
  res.json({
    properties: data.properties,
    guests: data.guests,
    activePropertyId: data.meta.activePropertyId || (data.properties[0]?.id ?? '')
  });
});

// 2. Add or update property
app.post('/api/properties', (req, res) => {
  const data = loadData();
  const { id, name, hostName, address, districtKey, variableSymbol } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Název ubytování je povinný' });
  }

  const propId = id || `prop_${Date.now()}`;
  const existingIdx = data.properties.findIndex(p => p.id === propId);

  const updatedProp: Property = {
    id: propId,
    name: name.trim(),
    hostName: (hostName || '').trim(),
    address: (address || '').trim(),
    districtKey: districtKey || 'praha8',
    variableSymbol: (variableSymbol || '').trim()
  };

  if (existingIdx >= 0) {
    data.properties[existingIdx] = updatedProp;
  } else {
    data.properties.push(updatedProp);
    if (!data.meta.activePropertyId) {
      data.meta.activePropertyId = propId;
    }
  }

  saveData(data);
  res.json({ success: true, property: updatedProp, properties: data.properties, activePropertyId: data.meta.activePropertyId });
});

// 3. Delete property
app.delete('/api/properties/:id', (req, res) => {
  const data = loadData();
  const propId = req.params.id;

  data.properties = data.properties.filter(p => p.id !== propId);
  data.guests = data.guests.filter(g => g.propertyId !== propId);

  if (data.meta.activePropertyId === propId) {
    data.meta.activePropertyId = data.properties[0]?.id || '';
  }

  saveData(data);
  res.json({ success: true, properties: data.properties, guests: data.guests, activePropertyId: data.meta.activePropertyId });
});

// 4. Set active property
app.post('/api/active-property', (req, res) => {
  const data = loadData();
  const { propertyId } = req.body;
  data.meta.activePropertyId = propertyId || '';
  saveData(data);
  res.json({ success: true, activePropertyId: data.meta.activePropertyId });
});

// 5. Add or update guest
app.post('/api/guests', (req, res) => {
  const data = loadData();
  const g = req.body;

  const id = g.id || `g_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const nights = Math.max(1, parseInt(g.nights) || 1);
  const isExempt = g.exemption && g.exemption !== 'none';
  const fee = isExempt ? 0 : nights * 50;

  const guestRecord: Guest = {
    id,
    propertyId: g.propertyId || data.meta.activePropertyId,
    unit: (g.unit || '').trim(),
    airbnbCode: (g.airbnbCode || '').trim().toUpperCase(),
    firstName: (g.firstName || '').trim(),
    lastName: (g.lastName || '').trim(),
    fullName: (g.fullName || `${g.firstName || ''} ${g.lastName || ''}`).trim() || 'Host',
    birthDate: g.birthDate || '',
    nationality: (g.nationality || 'CZ').trim().toUpperCase(),
    purposeOfStay: g.purposeOfStay || '10 turistika / leisure',
    idDocumentNumber: (g.idDocumentNumber || '').trim(),
    idDocumentType: g.idDocumentType || 'PAS',
    visaNumber: (g.visaNumber || '').trim(),
    address: (g.address || '').trim(),
    dateArrival: g.dateArrival || '',
    dateDeparture: g.dateDeparture || '',
    nights,
    exemption: g.exemption || 'none',
    fee,
    createdAt: g.createdAt || new Date().toISOString()
  };

  const existingIdx = data.guests.findIndex(item => item.id === id);
  if (existingIdx >= 0) {
    data.guests[existingIdx] = guestRecord;
  } else {
    data.guests.unshift(guestRecord);
  }

  saveData(data);
  res.json({ success: true, guest: guestRecord, guests: data.guests });
});

// 6. Delete guest
app.delete('/api/guests/:id', (req, res) => {
  const data = loadData();
  data.guests = data.guests.filter(g => g.id !== req.params.id);
  saveData(data);
  res.json({ success: true, guests: data.guests });
});

// 7. Batch add guests (from OCR scan)
app.post('/api/batch-guests', (req, res) => {
  const data = loadData();
  const { property, guests: incomingGuests } = req.body;

  let propId = property?.id || data.meta.activePropertyId;

  // If a property was created or updated during the scan
  if (property && property.name) {
    const existingIdx = data.properties.findIndex(p => p.id === property.id || (p.name.toLowerCase() === property.name.toLowerCase() && p.districtKey === property.districtKey));
    if (existingIdx >= 0) {
      propId = data.properties[existingIdx].id;
    } else {
      propId = property.id || `prop_${Date.now()}`;
      const newProp: Property = {
        id: propId,
        name: property.name,
        hostName: property.hostName || '',
        address: property.address || '',
        districtKey: property.districtKey || 'praha8',
        variableSymbol: property.variableSymbol || ''
      };
      data.properties.push(newProp);
      if (!data.meta.activePropertyId) {
        data.meta.activePropertyId = propId;
      }
    }
  }

  if (Array.isArray(incomingGuests)) {
    incomingGuests.forEach((g: any) => {
      const nights = Math.max(1, parseInt(g.nights) || 1);
      const isExempt = g.exemption && g.exemption !== 'none';
      const fee = isExempt ? 0 : nights * 50;

      data.guests.unshift({
        id: g.id || `g_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        propertyId: propId,
        unit: (g.unit || '').trim(),
        airbnbCode: (g.airbnbCode || '').trim().toUpperCase(),
        firstName: (g.firstName || '').trim(),
        lastName: (g.lastName || '').trim(),
        fullName: (g.fullName || `${g.firstName || ''} ${g.lastName || ''}`).trim() || 'Host',
        birthDate: g.birthDate || '',
        nationality: (g.nationality || 'CZ').trim().toUpperCase(),
        purposeOfStay: g.purposeOfStay || '10 turistika / leisure',
        idDocumentNumber: (g.idDocumentNumber || '').trim(),
        idDocumentType: g.idDocumentType || 'PAS',
        visaNumber: (g.visaNumber || '').trim(),
        address: (g.address || '').trim(),
        dateArrival: g.dateArrival || '',
        dateDeparture: g.dateDeparture || '',
        nights,
        exemption: g.exemption || 'none',
        fee,
        createdAt: new Date().toISOString()
      });
    });
  }

  saveData(data);
  res.json({
    success: true,
    properties: data.properties,
    guests: data.guests,
    activePropertyId: data.meta.activePropertyId
  });
});

// 8. Reset data to pristine zero state
app.post('/api/reset-data', (_req, res) => {
  const fresh = getDefaultData();
  saveData(fresh);
  res.json({ success: true, properties: [], guests: [], activePropertyId: '' });
});

// 9. Export raw data.yaml content
app.get('/api/export/yaml', (_req, res) => {
  const data = loadData();
  const yamlContent = jsyaml.dump(data, { indent: 2 });
  res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="data.yaml"');
  res.send(yamlContent);
});

// 10. Import data.yaml content
app.post('/api/import/yaml', (req, res) => {
  try {
    const { yamlContent } = req.body;
    if (!yamlContent) {
      return res.status(400).json({ error: 'Nebyl zaslán obsah YAML' });
    }
    const parsed = jsyaml.load(yamlContent) as any;
    if (!parsed || typeof parsed !== 'object') {
      return res.status(400).json({ error: 'Neplatný YAML formát' });
    }

    const newData: AppData = {
      meta: parsed.meta || {
        version: '3.0',
        description: 'AirTax Praha',
        lastUpdated: new Date().toISOString(),
        activePropertyId: ''
      },
      properties: Array.isArray(parsed.properties) ? parsed.properties : [],
      guests: Array.isArray(parsed.guests) ? parsed.guests : []
    };

    if (!newData.meta.activePropertyId && newData.properties.length > 0) {
      newData.meta.activePropertyId = newData.properties[0].id;
    }

    saveData(newData);
    res.json({
      success: true,
      properties: newData.properties,
      guests: newData.guests,
      activePropertyId: newData.meta.activePropertyId
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Chyba při importu YAML' });
  }
});

// ----------------------------------------------------
// DYNAMIC OCR ENGINE ROUTE (GEMINI MULTI-MODEL FALLBACK)
// ----------------------------------------------------

const CANDIDATE_FLASH_MODELS = [
  'gemini-flash-latest',
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite'
];

app.post('/api/ocr', async (req, res) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg', userApiKey, preferredModel } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Chybí obrazová data formuláře (Base64).' });
    }

    const effectiveApiKey = (userApiKey && userApiKey.trim()) || process.env.GEMINI_API_KEY;

    if (!effectiveApiKey) {
      return res.status(401).json({
        error: 'Není nastaven API klíč. Zadejte klíč v nastavení aplikace nebo v prostředí AI Studio.'
      });
    }

    const ai = new GoogleGenAI({
      apiKey: effectiveApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');

    const promptInstructions = `
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

    // Cascade of models to attempt
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
        console.log(`[OCR] Trying model: ${candidate}`);
        const response = await ai.models.generateContent({
          model: candidate,
          contents: [
            {
              role: 'user',
              parts: [
                { text: promptInstructions },
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
        console.warn(`[OCR] Model ${candidate} failed:`, err.message || err);
        lastError = err;
        // Continue to next candidate if model not found, unsupported or quota issue
      }
    }

    if (!extractedData) {
      throw lastError || new Error('Žádný z dostupných modelů Gemini nedokázal zpracovat obrázek.');
    }

    res.json({
      success: true,
      modelUsed: usedModel,
      data: extractedData
    });
  } catch (error: any) {
    console.error('[OCR Error]', error);
    res.status(500).json({
      error: error.message || 'Nepodařilo se zpracovat dokument pomocí Gemini OCR.'
    });
  }
});

// ----------------------------------------------------
// VITE DEV SERVER OR STATIC PRODUCTION SERVING
// ----------------------------------------------------

async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT} (isProd: ${isProd})`);
  });
}

startServer();
