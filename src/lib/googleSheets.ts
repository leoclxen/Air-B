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
  feePerNight?: number;
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
  Nastaveni: ['Klic_parametr', 'Hodnota', 'Popis']
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
        { properties: { title: 'Nastaveni', gridProperties: { frozenRowCount: 1 } } }
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
  const hasSettings = existingTitles.some((t: string) => /nastaven/i.test(t));
  const required = ['Ubytovani', 'Hoste', 'Prehled_odvodu'];
  if (!hasSettings) required.push('Nastaveni');
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
    if (sheetName === 'Nastaveni') {
      updateData.push({
        range: `'Nastaveni'!A1:C5`,
        values: [
          HEADERS.Nastaveni,
          ['GEMINI_API_KEY', '', 'Váš Google Gemini API klíč pro automatické OCR rozpoznávání'],
          ['PREFEROVANY_MODEL', 'gemini-flash-latest', 'Aktivní model Gemini (gemini-flash-latest / 3.8-flash / 3.1-flash-lite)'],
          ['POPLATEK_ZA_NOC', '50', 'Sazba poplatku z pobytu v Kč za noc (výchozí 50 Kč)'],
          ['POSLEDNI_AKTUALIZACE', new Date().toISOString(), 'Čas vytvoření listu']
        ]
      });
    } else {
      const h = (HEADERS as any)[sheetName];
      if (h) {
        updateData.push({
          range: `'${sheetName}'!A1:${getColumnLetter(h.length)}1`,
          values: [h]
        });
      }
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
 * Write initial headers and default Nastaveni rows
 */
async function initializeHeadersAndInitialData(accessToken: string, spreadsheetId: string) {
  const data = [
    { range: 'Ubytovani!A1:F1', values: [HEADERS.Ubytovani] },
    { range: 'Hoste!A1:R1', values: [HEADERS.Hoste] },
    { range: 'Prehled_odvodu!A1:I1', values: [HEADERS.Prehled_odvodu] },
    {
      range: 'Nastaveni!A1:C5',
      values: [
        HEADERS.Nastaveni,
        ['GEMINI_API_KEY', '', 'Váš Google Gemini API klíč pro automatické OCR rozpoznávání'],
        ['PREFEROVANY_MODEL', 'gemini-flash-latest', 'Aktivní model Gemini (gemini-flash-latest / 3.8-flash / 3.1-flash-lite)'],
        ['POPLATEK_ZA_NOC', '50', 'Sazba poplatku z pobytu v Kč za noc (výchozí 50 Kč)'],
        ['POSLEDNI_AKTUALIZACE', new Date().toISOString(), 'Čas vytvoření listu']
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
  feePerNight: number;
}> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  // 1. Inspect existing sheet titles from spreadsheet metadata
  let sheetTitles: string[] = [];
  try {
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
      { headers }
    );
    if (metaRes.ok) {
      const meta = await metaRes.json();
      sheetTitles = (meta.sheets || []).map((s: any) => s.properties?.title || '');
    }
  } catch (e) {
    console.warn('Failed to query sheet metadata, fallback to defaults', e);
  }

  // Match sheet titles case-insensitively / with variations
  const findTitle = (pattern: RegExp, fallback: string) => {
    return sheetTitles.find(t => pattern.test(t)) || fallback;
  };

  const propSheet = findTitle(/ubytov/i, 'Ubytovani');
  const guestSheet = findTitle(/host/i, 'Hoste');
  const settingsSheet = findTitle(/nastaven|api|config/i, 'Nastaveni');

  // If Nastaveni tab is missing completely, create it
  if (sheetTitles.length > 0 && !sheetTitles.includes(settingsSheet)) {
    try {
      await ensureRequiredSheetsExist(accessToken, spreadsheetId, sheetTitles.map(t => ({ properties: { title: t } })));
    } catch (e) {
      console.warn('Could not auto-add missing sheet', e);
    }
  }

  // Read data: ranges quoted with single quotes to support spaces/special chars
  const ranges = [
    `'${propSheet}'!A2:F1000`,
    `'${guestSheet}'!A2:R5000`,
    `'${settingsSheet}'!A1:E50`
  ];
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

  // Parse Nastaveni first so feePerNight is available for guest calculation
  const configRows = valueRanges[2]?.values || [];
  let apiKey = '';
  let preferredModel = 'gemini-flash-latest';
  let feePerNight = 50;

  for (const row of configRows) {
    if (!Array.isArray(row)) continue;

    // Check all cells in the row for Google/Gemini key format (AIzaSy...)
    for (const cell of row) {
      const val = typeof cell === 'string' ? cell.trim() : '';
      if (/^AIzaSy[A-Za-z0-9_-]{30,45}$/.test(val)) {
        apiKey = val;
      }
    }

    const colA = (row[0] ? String(row[0]) : '').trim();
    const colB = (row[1] ? String(row[1]) : '').trim();
    const colC = (row[2] ? String(row[2]) : '').trim();

    const normalizedA = colA.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (
      normalizedA.includes('api') ||
      normalizedA.includes('klic') ||
      normalizedA.includes('gemini') ||
      normalizedA.includes('key')
    ) {
      if (!apiKey) {
        if (colB && colB.length > 10) apiKey = colB;
        else if (colC && colC.length > 10) apiKey = colC;
      }
    }

    if (normalizedA.includes('model') && colB) {
      preferredModel = colB;
    }

    // Configurable fee per night (e.g. POPLATEK_ZA_NOC, POPLATEK, SAZBA, FEE)
    if (
      normalizedA.includes('poplatek') ||
      normalizedA.includes('sazba') ||
      normalizedA.includes('fee') ||
      normalizedA.includes('noc')
    ) {
      const parsedFee = parseInt(colB) || parseInt(colC);
      if (!isNaN(parsedFee) && parsedFee > 0) {
        feePerNight = parsedFee;
      }
    }
  }

  // Fallback: search ALL retrieved valueRanges for any cell starting with AIzaSy...
  if (!apiKey) {
    for (const vr of valueRanges) {
      const rows = vr?.values || [];
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        for (const cell of row) {
          const val = typeof cell === 'string' ? cell.trim() : '';
          if (/^AIzaSy[A-Za-z0-9_-]{30,45}$/.test(val)) {
            apiKey = val;
            break;
          }
        }
        if (apiKey) break;
      }
      if (apiKey) break;
    }
  }

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
    const calculatedFee = exemption !== 'none' ? 0 : nights * feePerNight;
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
      fee: parseInt(r[16]) || calculatedFee,
      createdAt: r[17] || new Date().toISOString()
    };
  }).filter((g: Guest) => (g.lastName || g.firstName || g.idDocumentNumber));

  return { properties, guests, apiKey, preferredModel, feePerNight };
}

/**
 * Save all properties and guests to Google Sheet with settlement overview & settings
 */
export async function syncAllToGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  payload: SheetDataPayload
): Promise<void> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const currentFee = payload.feePerNight || 50;

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
    const fee = (totalNights - exemptNights) * currentFee;

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

  // First, clear old contents below headers for data tabs ONLY (DO NOT clear Nastaveni to avoid wiping API key)
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ranges: ['Ubytovani!A2:F500', 'Hoste!A2:R10000', 'Prehled_odvodu!A2:I500']
    })
  });

  // Then batch write rows
  const data: any[] = [];

  // Update Nastaveni tab
  if (payload.apiKey && payload.apiKey.trim().length > 0) {
    const configRows = [
      ['GEMINI_API_KEY', payload.apiKey.trim(), 'Váš Google Gemini API klíč pro automatické OCR rozpoznávání'],
      ['PREFEROVANY_MODEL', payload.preferredModel || 'gemini-flash-latest', 'Aktivní model Gemini'],
      ['POPLATEK_ZA_NOC', String(currentFee), 'Sazba poplatku z pobytu v Kč za noc (výchozí 50 Kč)'],
      ['POSLEDNI_AKTUALIZACE', new Date().toISOString(), 'Čas poslední synchronizace']
    ];
    data.push({ range: 'Nastaveni!A2:C5', values: configRows });
  } else {
    // Only update preferredModel, feePerNight, and timestamp, leaving row 2 (GEMINI_API_KEY) intact
    data.push({
      range: 'Nastaveni!A3:C5',
      values: [
        ['PREFEROVANY_MODEL', payload.preferredModel || 'gemini-flash-latest', 'Aktivní model Gemini'],
        ['POPLATEK_ZA_NOC', String(currentFee), 'Sazba poplatku z pobytu v Kč za noc (výchozí 50 Kč)'],
        ['POSLEDNI_AKTUALIZACE', new Date().toISOString(), 'Čas poslední synchronizace']
      ]
    });
  }

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
 * Save API key, preferred model, and fee per night to Nastaveni sheet
 */
export async function saveSettingsToSheet(
  accessToken: string,
  spreadsheetId: string,
  apiKey: string,
  preferredModel: string,
  feePerNight: number = 50
): Promise<void> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const rows = [
    ['GEMINI_API_KEY', apiKey || '', 'Váš Google Gemini API klíč pro automatické OCR rozpoznávání'],
    ['PREFEROVANY_MODEL', preferredModel || 'gemini-flash-latest', 'Aktivní model Gemini'],
    ['POPLATEK_ZA_NOC', String(feePerNight || 50), 'Sazba poplatku z pobytu v Kč za noc (výchozí 50 Kč)'],
    ['POSLEDNI_AKTUALIZACE', new Date().toISOString(), 'Čas poslední synchronizace']
  ];

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Nastaveni!A2:C5?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ values: rows })
  });
}

// Backward-compatible alias
export const saveApiKeyToSheet = saveSettingsToSheet;

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
