import { Property, Guest, PRAGUE_DISTRICTS } from '../types';

export interface SpreadsheetInfo {
  id: string;
  url: string;
  title: string;
  isNew: boolean;
}

export interface SheetDataPayload {
  properties: Property[];
  guests: Guest[];
  apiKey?: string;
  preferredModel?: string;
}

const DEFAULT_TITLE = 'AirTax Praha - Evidence ubytovaných';

// Headers for the 4 tabs
const HEADERS = {
  Ubytovani: ['ID', 'Nazev_ubytovani', 'Hostitel', 'Adresa_Praha', 'Mestska_cast', 'Variabilni_symbol_ICO'],
  Hoste: [
    'ID', 'Ubytovani_ID', 'Jednotka', 'Airbnb_kod', 'Prijmeni', 'Jmeno', 'Datum_narozeni',
    'Obcanstvi', 'Ucel_pobytu', 'Cislo_dokladu_pasu', 'Cislo_viza', 'Trvale_bydliste',
    'Prijezd', 'Odjezd', 'Pocet_noci', 'Osvobozeni', 'Poplatek_CZK', 'Vytvoreno'
  ],
  Prehled_odvodu: [
    'Mestska_cast', 'Aktivni_ubytovani', 'Celkem_hostu', 'Celkem_noci',
    'Osvobozeno_noci', 'K_uhrade_CZK', 'Cislo_uctu_MC', 'VS_platby', 'Datova_schranka'
  ],
  Nastaveni_API: ['Klic_parametr', 'Hodnota', 'Popis']
};

/**
 * Searches user's Google Drive for existing AirTax spreadsheet or creates a new one
 */
export async function findOrCreateAirTaxSpreadsheet(
  accessToken: string,
  customSpreadsheetId?: string
): Promise<SpreadsheetInfo> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };

  // 1. If user supplied an explicit Spreadsheet ID / URL
  if (customSpreadsheetId && customSpreadsheetId.trim()) {
    const cleanId = extractSpreadsheetId(customSpreadsheetId.trim());
    const verifyRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cleanId}`, {
      headers
    });
    if (verifyRes.ok) {
      const meta = await verifyRes.json();
      await ensureRequiredSheetsExist(accessToken, cleanId, meta.sheets || []);
      return {
        id: cleanId,
        url: `https://docs.google.com/spreadsheets/d/${cleanId}/edit`,
        title: meta.properties?.title || DEFAULT_TITLE,
        isNew: false
      };
    }
  }

  // 2. Search Drive for existing file named DEFAULT_TITLE
  try {
    const driveQuery = encodeURIComponent(
      `name='${DEFAULT_TITLE}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`
    );
    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${driveQuery}&fields=files(id,name,webViewLink)`,
      { headers }
    );
    if (driveRes.ok) {
      const driveData = await driveRes.json();
      if (Array.isArray(driveData.files) && driveData.files.length > 0) {
        const existing = driveData.files[0];
        const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${existing.id}`, { headers });
        if (metaRes.ok) {
          const meta = await metaRes.json();
          await ensureRequiredSheetsExist(accessToken, existing.id, meta.sheets || []);
        }
        return {
          id: existing.id,
          url: existing.webViewLink || `https://docs.google.com/spreadsheets/d/${existing.id}/edit`,
          title: existing.name,
          isNew: false
        };
      }
    }
  } catch (err) {
    console.warn('Drive search failed, falling back to create', err);
  }

  // 3. Create new spreadsheet with 4 dedicated sheets
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      properties: { title: DEFAULT_TITLE },
      sheets: [
        { properties: { title: 'Ubytovani', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Hoste', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Prehled_odvodu', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Nastaveni_API', gridProperties: { frozenRowCount: 1 } } }
      ]
    })
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Nepodařilo se vytvořit Google Sheet: ${errText}`);
  }

  const created = await createRes.json();
  const newId = created.spreadsheetId;

  // Initialize header rows and initial config
  await initializeHeadersAndInitialData(accessToken, newId);

  return {
    id: newId,
    url: created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${newId}/edit`,
    title: DEFAULT_TITLE,
    isNew: true
  };
}

/**
 * Ensure all 4 required sheets exist in an existing spreadsheet
 */
async function ensureRequiredSheetsExist(accessToken: string, spreadsheetId: string, currentSheets: any[]) {
  const existingTitles = currentSheets.map(s => s.properties?.title);
  const required = ['Ubytovani', 'Hoste', 'Prehled_odvodu', 'Nastaveni_API'];
  const missing = required.filter(title => !existingTitles.includes(title));

  if (missing.length === 0) return;

  const requests = missing.map(title => ({
    addSheet: {
      properties: {
        title,
        gridProperties: { frozenRowCount: 1 }
      }
    }
  }));

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests })
  });

  // Write headers to any newly created sheets
  const updateData: any[] = [];
  missing.forEach(sheetName => {
    const h = (HEADERS as any)[sheetName];
    if (h) {
      updateData.push({
        range: `${sheetName}!A1:${getColumnLetter(h.length)}1`,
        values: [h]
      });
    }
  });

  if (updateData.length > 0) {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: updateData
      })
    });
  }
}

/**
 * Write initial headers and default Nastaveni_API rows
 */
async function initializeHeadersAndInitialData(accessToken: string, spreadsheetId: string) {
  const data = [
    { range: 'Ubytovani!A1:F1', values: [HEADERS.Ubytovani] },
    { range: 'Hoste!A1:R1', values: [HEADERS.Hoste] },
    { range: 'Prehled_odvodu!A1:I1', values: [HEADERS.Prehled_odvodu] },
    {
      range: 'Nastaveni_API!A1:C4',
      values: [
        HEADERS.Nastaveni_API,
        ['GEMINI_API_KEY', '', 'Váš Google Gemini API klíč pro automatické OCR rozpoznávání'],
        ['PREFEROVANY_MODEL', 'gemini-flash-latest', 'Aktivní model Gemini (gemini-flash-latest / 3.8-flash / 3.1-flash-lite)'],
        ['POSLEDNI_AKTUALIZACE', new Date().toISOString(), 'Čas poslední synchronizace']
      ]
    }
  ];

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data
    })
  });
}

/**
 * Load all data from Google Sheet into application state
 */
export async function loadAllDataFromGoogleSheet(
  accessToken: string,
  spreadsheetId: string
): Promise<{
  properties: Property[];
  guests: Guest[];
  apiKey: string;
  preferredModel: string;
}> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const ranges = ['Ubytovani!A2:F1000', 'Hoste!A2:R5000', 'Nastaveni_API!A2:B10'];
  const query = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${query}`,
    { headers }
  );

  if (!res.ok) {
    throw new Error('Chyba při čtení dat z Google Sheetu.');
  }

  const result = await res.json();
  const valueRanges = result.valueRanges || [];

  // Parse Ubytovani
  const propRows = valueRanges[0]?.values || [];
  const properties: Property[] = propRows.map((r: any[]) => ({
    id: r[0] || `prop_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
    name: r[1] || '',
    hostName: r[2] || '',
    address: r[3] || '',
    districtKey: r[4] || 'praha8',
    variableSymbol: r[5] || ''
  })).filter((p: Property) => p.name.trim().length > 0);

  // Parse Hoste
  const guestRows = valueRanges[1]?.values || [];
  const guests: Guest[] = guestRows.map((r: any[]) => {
    const nights = Math.max(1, parseInt(r[14]) || 1);
    const exemption = (r[15] as any) || 'none';
    const fee = exemption !== 'none' ? 0 : nights * 50;
    return {
      id: r[0] || `g_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      propertyId: r[1] || '',
      unit: r[2] || '',
      airbnbCode: r[3] || '',
      lastName: r[4] || '',
      firstName: r[5] || '',
      fullName: `${r[5] || ''} ${r[4] || ''}`.trim() || 'Host',
      birthDate: r[6] || '',
      nationality: (r[7] || 'CZ').toUpperCase(),
      purposeOfStay: r[8] || '10 turistika / leisure',
      idDocumentNumber: r[9] || '',
      idDocumentType: 'PAS',
      visaNumber: r[10] || '',
      address: r[11] || '',
      dateArrival: r[12] || '',
      dateDeparture: r[13] || '',
      nights,
      exemption,
      fee: parseInt(r[16]) || fee,
      createdAt: r[17] || new Date().toISOString()
    };
  }).filter((g: Guest) => (g.lastName || g.firstName || g.idDocumentNumber));

  // Parse Nastaveni_API
  const configRows = valueRanges[2]?.values || [];
  let apiKey = '';
  let preferredModel = 'gemini-flash-latest';

  configRows.forEach((r: any[]) => {
    const param = (r[0] || '').trim();
    const val = (r[1] || '').trim();
    if (param === 'GEMINI_API_KEY') apiKey = val;
    if (param === 'PREFEROVANY_MODEL' && val) preferredModel = val;
  });

  return { properties, guests, apiKey, preferredModel };
}

/**
 * Save all properties and guests to Google Sheet with settlement overview & API key
 */
export async function syncAllToGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  payload: SheetDataPayload
): Promise<void> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  // 1. Prepare Ubytovani rows
  const propRows = payload.properties.map(p => [
    p.id,
    p.name,
    p.hostName || '',
    p.address || '',
    p.districtKey || 'praha8',
    p.variableSymbol || ''
  ]);

  // 2. Prepare Hoste rows
  const guestRows = payload.guests.map(g => [
    g.id,
    g.propertyId || '',
    g.unit || '',
    g.airbnbCode || '',
    g.lastName || '',
    g.firstName || '',
    g.birthDate || '',
    g.nationality || 'CZ',
    g.purposeOfStay || '',
    g.idDocumentNumber || '',
    g.visaNumber || '',
    g.address || '',
    g.dateArrival || '',
    g.dateDeparture || '',
    g.nights || 1,
    g.exemption || 'none',
    g.fee || 0,
    g.createdAt || new Date().toISOString()
  ]);

  // 3. Prepare Prehled_odvodu rows calculated per property
  const settlementRows = payload.properties.map(p => {
    const dist = PRAGUE_DISTRICTS[p.districtKey] || PRAGUE_DISTRICTS.praha1;
    const pGuests = payload.guests.filter(g => g.propertyId === p.id);
    const totalNights = pGuests.reduce((s, g) => s + g.nights, 0);
    const exemptNights = pGuests.reduce((s, g) => s + (g.exemption !== 'none' ? g.nights : 0), 0);
    const fee = (totalNights - exemptNights) * 50;

    return [
      dist.name,
      p.name,
      pGuests.length,
      totalNights,
      exemptNights,
      fee,
      dist.fullAccount,
      p.variableSymbol || '',
      dist.datovaschranka
    ];
  });

  // 4. Prepare Nastaveni_API rows
  const configRows = [
    ['GEMINI_API_KEY', payload.apiKey || '', 'Váš Google Gemini API klíč pro automatické OCR rozpoznávání'],
    ['PREFEROVANY_MODEL', payload.preferredModel || 'gemini-flash-latest', 'Aktivní model Gemini'],
    ['POSLEDNI_AKTUALIZACE', new Date().toISOString(), 'Čas poslední synchronizace']
  ];

  // First, clear old contents below headers to avoid orphaned rows
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ranges: ['Ubytovani!A2:F500', 'Hoste!A2:R10000', 'Prehled_odvodu!A2:I500', 'Nastaveni_API!A2:C10']
    })
  });

  // Then batch write all rows
  const data: any[] = [
    { range: `Nastaveni_API!A2:C${configRows.length + 1}`, values: configRows }
  ];

  if (propRows.length > 0) {
    data.push({ range: `Ubytovani!A2:F${propRows.length + 1}`, values: propRows });
  }
  if (guestRows.length > 0) {
    data.push({ range: `Hoste!A2:R${guestRows.length + 1}`, values: guestRows });
  }
  if (settlementRows.length > 0) {
    data.push({ range: `Prehled_odvodu!A2:I${settlementRows.length + 1}`, values: settlementRows });
  }

  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data
      })
    }
  );

  if (!writeRes.ok) {
    const err = await writeRes.text();
    throw new Error(`Zápis do Google Sheetu selhal: ${err}`);
  }
}

/**
 * Save API key and preferred model specifically to Nastaveni_API sheet
 */
export async function saveApiKeyToSheet(
  accessToken: string,
  spreadsheetId: string,
  apiKey: string,
  preferredModel: string
): Promise<void> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const rows = [
    ['GEMINI_API_KEY', apiKey || '', 'Váš Google Gemini API klíč pro automatické OCR rozpoznávání'],
    ['PREFEROVANY_MODEL', preferredModel || 'gemini-flash-latest', 'Aktivní model Gemini'],
    ['POSLEDNI_AKTUALIZACE', new Date().toISOString(), 'Čas poslední synchronizace']
  ];

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Nastaveni_API!A2:C4?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ values: rows })
  });
}

function extractSpreadsheetId(input: string): string {
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return input;
}

function getColumnLetter(colIndex: number): string {
  let letter = '';
  while (colIndex > 0) {
    const rem = (colIndex - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    colIndex = Math.floor((colIndex - 1) / 26);
  }
  return letter;
}
