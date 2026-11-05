import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import * as jsyaml from 'js-yaml';
import {
  Camera,
  Image as ImageIcon,
  Edit3,
  Building,
  ShieldCheck,
  Download,
  UploadCloud,
  FileSpreadsheet,
  FileCode,
  QrCode as QrCodeIcon,
  BookOpen,
  HelpCircle,
  Scan,
  Plus,
  Trash2,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
  ChevronDown,
  RotateCcw,
  Sliders,
  Check,
  Zap,
  RefreshCw,
  ExternalLink,
  Laptop,
  LogOut,
  User as UserIcon
} from 'lucide-react';
import { Property, Guest, PRAGUE_DISTRICTS, generateCzechIBAN } from './types';
import { User } from 'firebase/auth';
import {
  initAuth,
  googleSignIn,
  googleLogout,
  getAccessToken,
  firebaseProjectId,
  firebaseConsoleAuthorizedDomainsUrl
} from './lib/googleAuth';
import {
  findOrCreateAirTaxSpreadsheet,
  loadAllDataFromGoogleSheet,
  syncAllToGoogleSheet,
  saveApiKeyToSheet,
  SpreadsheetInfo
} from './lib/googleSheets';
import { runClientGeminiOcr } from './lib/geminiClientOcr';

// Safe localStorage wrapper for Google Sites iframe sandboxes
const safeStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return (window as any).__fallbackStorage?.[key] || null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {}
    if (!(window as any).__fallbackStorage) (window as any).__fallbackStorage = {};
    (window as any).__fallbackStorage[key] = value;
  },
  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {}
    if ((window as any).__fallbackStorage) delete (window as any).__fallbackStorage[key];
  }
};

export default function App() {
  // App State - INITIAL CLEAN STATE (Zero hardcoded data)
  const [properties, setProperties] = useState<Property[]>([]);
  const [activePropertyId, setActivePropertyId] = useState<string>('');
  const [guests, setGuests] = useState<Guest[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'scan' | 'ledger' | 'payout' | 'info'>('scan');
  const [ledgerFilter, setLedgerFilter] = useState<'all' | 'chargeable' | 'exempt'>('all');

  // OCR & Model State
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanStatus, setScanStatus] = useState<string>('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [activeModelName, setActiveModelName] = useState<string>(
    safeStorage.getItem('airtax_model_pref') || 'gemini-flash-latest'
  );
  const [userApiKey, setUserApiKey] = useState<string>(
    safeStorage.getItem('airtax_user_api_key') || ''
  );

  // Google Workspace & Sheets State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [isGoogleLoading, setIsGoogleLoading] = useState<boolean>(false);
  const [connectedSheet, setConnectedSheet] = useState<SpreadsheetInfo | null>(null);
  const [customSheetId, setCustomSheetId] = useState<string>(
    safeStorage.getItem('airtax_sheet_id') || ''
  );
  const [isSyncingSheet, setIsSyncingSheet] = useState<boolean>(false);

  // Modals State
  const [isPropModalOpen, setIsPropModalOpen] = useState<boolean>(false);
  const [propModalMode, setPropModalMode] = useState<'list' | 'form'>('list');
  const [editingPropId, setEditingPropId] = useState<string | null>(null);

  const [isGuestModalOpen, setIsGuestModalOpen] = useState<boolean>(false);
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);

  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isDataModalOpen, setIsDataModalOpen] = useState<boolean>(false);
  const [isWebcamOpen, setIsWebcamOpen] = useState<boolean>(false);
  const [isDesktopCameraPromptOpen, setIsDesktopCameraPromptOpen] = useState<boolean>(false);
  const [isDomainModalOpen, setIsDomainModalOpen] = useState<boolean>(false);

  // Scan Verification / Accommodation Match Modal State
  const [isScanConfirmModalOpen, setIsScanConfirmModalOpen] = useState<boolean>(false);
  const [pendingScanData, setPendingScanData] = useState<{
    detected: any;
    guests: any[];
  } | null>(null);
  const [scanTargetChoice, setScanTargetChoice] = useState<'existing' | 'new'>('existing');
  const [selectedScanPropId, setSelectedScanPropId] = useState<string>('');
  const [scanNewPropForm, setScanNewPropForm] = useState({
    name: '',
    hostName: '',
    address: '',
    districtKey: 'praha8',
    variableSymbol: ''
  });

  // QR Code State
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [paymentMessage, setPaymentMessage] = useState<string>('');

  // Toast State
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'info' } | null>(null);

  // Refs for hidden inputs
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const webcamCanvasRef = useRef<HTMLCanvasElement>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);

  // Property form state
  const [propForm, setPropForm] = useState({
    name: '',
    hostName: '',
    address: '',
    districtKey: 'praha8',
    variableSymbol: ''
  });

  // Guest form state
  const [guestForm, setGuestForm] = useState({
    unit: '',
    airbnbCode: '',
    firstName: '',
    lastName: '',
    birthDate: '',
    nationality: 'CZ',
    purposeOfStay: '10 turistika / leisure',
    idDocumentNumber: '',
    idDocumentType: 'PAS',
    visaNumber: '',
    address: '',
    dateArrival: '',
    dateDeparture: '',
    nights: 1,
    exemption: 'none' as 'none' | 'under18' | 'ztp' | 'other'
  });

  const showToast = (message: string, type: 'success' | 'warning' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  // Local persistence helper (works on static hosts like GitHub Pages and inside iframes)
  const persistLocalState = (props: Property[], gst: Guest[], activeId?: string) => {
    try {
      safeStorage.setItem('airtax_local_yaml', jsyaml.dump({
        meta: {
          version: '3.0',
          lastUpdated: new Date().toISOString(),
          activePropertyId: activeId || activePropertyId || props[0]?.id || ''
        },
        properties: props,
        guests: gst
      }));
    } catch (e) {
      console.warn('Failed to persist to local storage', e);
    }
  };

  // 1. Fetch initial data from server on mount with static fallback (GitHub Pages)
  const fetchCloudData = async () => {
    try {
      setIsLoading(true);
      let loadedFromServer = false;
      try {
        const res = await fetch('/api/data');
        if (res.ok) {
          const data = await res.json();
          setProperties(data.properties || []);
          setGuests(data.guests || []);
          setActivePropertyId(data.activePropertyId || (data.properties?.[0]?.id ?? ''));
          loadedFromServer = true;
        }
      } catch {
        // Expected when hosted statically without Node backend (e.g. GitHub Pages)
      }

      if (!loadedFromServer) {
        // Fallback to local storage
        const localYaml = safeStorage.getItem('airtax_local_yaml');
        if (localYaml) {
          try {
            const parsed = jsyaml.load(localYaml) as any;
            if (parsed) {
              setProperties(parsed.properties || []);
              setGuests(parsed.guests || []);
              setActivePropertyId(parsed.meta?.activePropertyId || (parsed.properties?.[0]?.id ?? ''));
            }
          } catch {}
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Google Sheets Auto-Connect and Sync
  const autoConnectSheet = async (token: string, explicitId?: string) => {
    try {
      setIsSyncingSheet(true);
      const sheet = await findOrCreateAirTaxSpreadsheet(token, explicitId || customSheetId);
      setConnectedSheet(sheet);
      safeStorage.setItem('airtax_sheet_id', sheet.id);

      // Read current content from sheet
      const sheetData = await loadAllDataFromGoogleSheet(token, sheet.id);

      // ALWAYS load API key and preferred model from sheet if found!
      let loadedKey = false;
      if (sheetData.apiKey && sheetData.apiKey.trim().length > 0) {
        const cleanKey = sheetData.apiKey.trim();
        setUserApiKey(cleanKey);
        safeStorage.setItem('airtax_user_api_key', cleanKey);
        loadedKey = true;
      }
      if (sheetData.preferredModel && sheetData.preferredModel.trim().length > 0) {
        const cleanModel = sheetData.preferredModel.trim();
        setActiveModelName(cleanModel);
        safeStorage.setItem('airtax_model_pref', cleanModel);
      }

      // If sheet has properties/guests, update local & server state
      if (sheetData.properties.length > 0 || sheetData.guests.length > 0) {
        setProperties(sheetData.properties);
        setGuests(sheetData.guests);
        if (sheetData.properties[0]) {
          setActivePropertyId(sheetData.properties[0].id);
        }
        // Persist to server data.yaml
        fetch('/api/import/yaml', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            yamlContent: jsyaml.dump({
              meta: { version: '3.0', lastUpdated: new Date().toISOString(), activePropertyId: sheetData.properties[0]?.id || '' },
              properties: sheetData.properties,
              guests: sheetData.guests
            })
          })
        }).catch(err => console.warn('Server sync error', err));

        const keyMsg = loadedKey ? ' a Gemini API klíč' : '';
        showToast(`Načteno z Google Sheetu: ${sheetData.properties.length} ubytování, ${sheetData.guests.length} hostů${keyMsg}!`, 'success');
      } else if (properties.length > 0 || guests.length > 0) {
        // Sheet has no properties/guests yet, push local state to the sheet without wiping API key
        await syncAllToGoogleSheet(token, sheet.id, {
          properties,
          guests,
          apiKey: sheetData.apiKey || userApiKey,
          preferredModel: sheetData.preferredModel || activeModelName
        });
        const keyMsg = loadedKey ? ' API klíč byl úspěšně načten ze Sheetu.' : '';
        showToast(`Google Sheet inicializován a synchronizován s vašimi daty.${keyMsg}`, 'success');
      } else if (loadedKey) {
        showToast('Google Sheet propojen a API klíč Gemini byl úspěšně načten!', 'success');
      } else {
        showToast('Google Sheet propojen a připraven k zápisu.', 'info');
      }
    } catch (err: any) {
      console.error('Google Sheet connect error:', err);
      showToast('Chyba Google Sheet: ' + err.message, 'warning');
    } finally {
      setIsSyncingSheet(false);
    }
  };

  const handleGoogleLoginClick = async () => {
    try {
      setIsGoogleLoading(true);
      const res = await googleSignIn();
      if (res) {
        setCurrentUser(res.user);
        setGoogleToken(res.accessToken);
        await autoConnectSheet(res.accessToken);
      }
    } catch (err: any) {
      if (err?.code === 'auth/unauthorized-domain' || err?.message?.includes('unauthorized-domain')) {
        setIsDomainModalOpen(true);
      } else {
        showToast('Přihlášení k Google selhalo: ' + (err.message || err), 'warning');
      }
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleGoogleLogoutClick = async () => {
    try {
      await googleLogout();
      setCurrentUser(null);
      setGoogleToken(null);
      setConnectedSheet(null);
      showToast('Odhlášeno z Google účtu.', 'info');
    } catch (err: any) {
      showToast('Chyba při odhlašování: ' + err.message, 'warning');
    }
  };

  const syncToSheetIfConnected = async (newProps: Property[], newGuests: Guest[], apiKey?: string, model?: string) => {
    if (googleToken && connectedSheet) {
      try {
        await syncAllToGoogleSheet(googleToken, connectedSheet.id, {
          properties: newProps,
          guests: newGuests,
          apiKey: apiKey ?? userApiKey,
          preferredModel: model ?? activeModelName
        });
      } catch (e: any) {
        console.warn('Google Sheet background sync warning', e);
      }
    }
  };

  useEffect(() => {
    fetchCloudData();
    initAuth(
      async (user, token) => {
        setCurrentUser(user);
        setGoogleToken(token);
        autoConnectSheet(token);
      },
      () => {
        setCurrentUser(null);
        setGoogleToken(null);
        setConnectedSheet(null);
      }
    );
  }, []);

  // Active property lookup
  const activeProperty = properties.find(p => p.id === activePropertyId) || properties[0] || null;
  const activeDistrict = activeProperty ? PRAGUE_DISTRICTS[activeProperty.districtKey] || PRAGUE_DISTRICTS.praha1 : null;

  // Filtered guests for active property
  const activeGuests = guests.filter(g => activeProperty && g.propertyId === activeProperty.id);

  // Financial calculations
  const totalNights = activeGuests.reduce((sum, g) => sum + g.nights, 0);
  const exemptNights = activeGuests.reduce((sum, g) => sum + (g.exemption !== 'none' ? g.nights : 0), 0);
  const chargeableNights = totalNights - exemptNights;
  const totalFee = chargeableNights * 50;

  // Update SPAYD QR code whenever active property, guests, or message changes
  useEffect(() => {
    if (!activeProperty || !activeDistrict || totalFee <= 0) {
      setQrDataUrl('');
      return;
    }

    const iban = generateCzechIBAN(activeDistrict.prefix, activeDistrict.account, activeDistrict.bankCode);
    const vs = activeProperty.variableSymbol || '';
    const date = new Date();
    const monthYear = `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
    const defaultMsg = paymentMessage || `Airbnb ${activeProperty.name} - Poplatek ${monthYear}`;
    const cleanMsg = defaultMsg.normalize("NFD").replace(/[\u0300-\u036f]/g, "").substring(0, 60);

    let spaydString = `SPD*1.0*ACC:${iban}*AM:${totalFee.toFixed(2)}*CC:CZK*`;
    if (vs) spaydString += `X-VS:${vs}*`;
    if (cleanMsg) spaydString += `MSG:${cleanMsg}*`;

    QRCode.toDataURL(spaydString, {
      width: 240,
      margin: 1,
      color: { dark: '#0F172A', light: '#FFFFFF' }
    })
      .then(url => setQrDataUrl(url))
      .catch(err => console.error('QR Error:', err));
  }, [activeProperty, activeDistrict, totalFee, paymentMessage]);

  // Switch active property
  const handleSelectProperty = async (propId: string) => {
    setActivePropertyId(propId);
    try {
      await fetch('/api/active-property', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: propId })
      });
    } catch (e) {
      console.warn('Failed to sync active property to server', e);
    }
  };

  // Open property modal for adding/editing
  const openNewPropertyModal = () => {
    setPropForm({
      name: '',
      hostName: '',
      address: '',
      districtKey: 'praha8',
      variableSymbol: ''
    });
    setEditingPropId(null);
    setPropModalMode('form');
    setIsPropModalOpen(true);
  };

  const openEditPropertyModal = (prop: Property) => {
    setPropForm({
      name: prop.name,
      hostName: prop.hostName || '',
      address: prop.address || '',
      districtKey: prop.districtKey || 'praha8',
      variableSymbol: prop.variableSymbol || ''
    });
    setEditingPropId(prop.id);
    setPropModalMode('form');
    setIsPropModalOpen(true);
  };

  const handleSaveProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!propForm.name.trim()) {
      showToast('Vyplňte prosím název ubytování.', 'warning');
      return;
    }

    try {
      const propId = editingPropId || `prop_${Date.now()}`;
      let newProps = [...properties];
      const existingIdx = newProps.findIndex(p => p.id === propId);
      const updatedProp: Property = {
        id: propId,
        ...propForm
      };
      if (existingIdx >= 0) {
        newProps[existingIdx] = updatedProp;
      } else {
        newProps.push(updatedProp);
      }

      try {
        const res = await fetch('/api/properties', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingPropId,
            ...propForm
          })
        });
        if (res.ok) {
          const data = await res.json();
          newProps = data.properties;
        }
      } catch {
        // Static hosting fallback (GitHub Pages)
      }

      setProperties(newProps);
      setActivePropertyId(propId);
      setIsPropModalOpen(false);
      persistLocalState(newProps, guests, propId);
      syncToSheetIfConnected(newProps, guests);
      showToast('Ubytovací místo uloženo!', 'success');
    } catch (err: any) {
      showToast('Chyba při ukládání ubytování: ' + err.message, 'warning');
    }
  };

  const handleDeleteProperty = async (propId: string) => {
    if (!window.confirm('Opravdu chcete smazat toto ubytování a všechny jeho hosty?')) return;

    try {
      let newProps = properties.filter(p => p.id !== propId);
      let newGuests = guests.filter(g => g.propertyId !== propId);
      let newActiveId = activePropertyId === propId ? (newProps[0]?.id || '') : activePropertyId;

      try {
        const res = await fetch(`/api/properties/${propId}`, { method: 'DELETE' });
        if (res.ok) {
          const data = await res.json();
          newProps = data.properties;
          newGuests = data.guests;
          newActiveId = data.activePropertyId;
        }
      } catch {
        // Static hosting fallback (GitHub Pages)
      }

      setProperties(newProps);
      setGuests(newGuests);
      setActivePropertyId(newActiveId);
      persistLocalState(newProps, newGuests, newActiveId);
      syncToSheetIfConnected(newProps, newGuests);
      showToast('Ubytování bylo smazáno.', 'info');
    } catch (err: any) {
      showToast('Chyba při mazání: ' + err.message, 'warning');
    }
  };

  // Manual Guest Operations
  const openNewGuestModal = () => {
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    setGuestForm({
      unit: '',
      airbnbCode: '',
      firstName: '',
      lastName: '',
      birthDate: '',
      nationality: 'CZ',
      purposeOfStay: '10 turistika / leisure',
      idDocumentNumber: '',
      idDocumentType: 'PAS',
      visaNumber: '',
      address: '',
      dateArrival: today,
      dateDeparture: tomorrow,
      nights: 1,
      exemption: 'none'
    });
    setEditingGuest(null);
    setIsGuestModalOpen(true);
  };

  const openEditGuestModal = (g: Guest) => {
    setGuestForm({
      unit: g.unit || '',
      airbnbCode: g.airbnbCode || '',
      firstName: g.firstName || '',
      lastName: g.lastName || '',
      birthDate: g.birthDate || '',
      nationality: g.nationality || 'CZ',
      purposeOfStay: g.purposeOfStay || '10 turistika / leisure',
      idDocumentNumber: g.idDocumentNumber || '',
      idDocumentType: g.idDocumentType || 'PAS',
      visaNumber: g.visaNumber || '',
      address: g.address || '',
      dateArrival: g.dateArrival || '',
      dateDeparture: g.dateDeparture || '',
      nights: g.nights || 1,
      exemption: g.exemption || 'none'
    });
    setEditingGuest(g);
    setIsGuestModalOpen(true);
  };

  const handleSaveGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProperty) {
      showToast('Nejprve vytvořte nebo vyberte ubytovací místo.', 'warning');
      return;
    }

    try {
      const gId = editingGuest?.id || `g_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const nights = Math.max(1, guestForm.nights || 1);
      const isExempt = guestForm.exemption !== 'none';
      const fee = isExempt ? 0 : nights * 50;
      const guestObj: Guest = {
        id: gId,
        propertyId: activeProperty.id,
        ...guestForm,
        fullName: `${guestForm.firstName} ${guestForm.lastName}`.trim(),
        fee,
        createdAt: editingGuest?.createdAt || new Date().toISOString()
      };

      let newGuests = [...guests];
      const existingIdx = newGuests.findIndex(g => g.id === gId);
      if (existingIdx >= 0) {
        newGuests[existingIdx] = guestObj;
      } else {
        newGuests.unshift(guestObj);
      }

      try {
        const res = await fetch('/api/guests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingGuest?.id,
            propertyId: activeProperty.id,
            ...guestForm
          })
        });
        if (res.ok) {
          const data = await res.json();
          newGuests = data.guests;
        }
      } catch {
        // Static hosting fallback (GitHub Pages)
      }

      setGuests(newGuests);
      setIsGuestModalOpen(false);
      persistLocalState(properties, newGuests);
      syncToSheetIfConnected(properties, newGuests);
      showToast('Host byl úspěšně uložen do knihy!', 'success');
    } catch (err: any) {
      showToast('Chyba při ukládání hosta: ' + err.message, 'warning');
    }
  };

  const handleDeleteGuest = async (id: string) => {
    if (!window.confirm('Opravdu smazat tohoto hosta z knihy?')) return;
    try {
      let newGuests = guests.filter(g => g.id !== id);
      try {
        const res = await fetch(`/api/guests/${id}`, { method: 'DELETE' });
        if (res.ok) {
          const data = await res.json();
          newGuests = data.guests;
        }
      } catch {
        // Static hosting fallback (GitHub Pages)
      }
      setGuests(newGuests);
      persistLocalState(properties, newGuests);
      syncToSheetIfConnected(properties, newGuests);
      showToast('Záznam hosta smazán.', 'info');
    } catch (err: any) {
      showToast('Chyba při mazání hosta: ' + err.message, 'warning');
    }
  };

  // Image Compression Helper
  const compressImage = (file: File, maxDim: number = 1600, quality: number = 0.85): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > height) {
            if (width > maxDim) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            }
          } else {
            if (height > maxDim) {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Canvas context unavailable'));
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Trigger Camera / Photo Picker (On-Demand only)
  const handleTakePhotoClick = () => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && !window.matchMedia('(pointer: fine)').matches);

    if (isMobile) {
      // Mobile native camera picker opens on tap (system prompts on demand)
      cameraInputRef.current?.click();
    } else {
      // Desktop: do NOT trigger camera permission immediately; open desktop choice dialog
      setIsDesktopCameraPromptOpen(true);
    }
  };

  const startWebcam = async () => {
    setIsWebcamOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      setWebcamStream(stream);
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = stream;
        webcamVideoRef.current.play();
      }
    } catch (err) {
      console.warn('Webcam failed, redirecting to gallery', err);
      setIsWebcamOpen(false);
      galleryInputRef.current?.click();
    }
  };

  const stopWebcam = () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach(t => t.stop());
      setWebcamStream(null);
    }
    setIsWebcamOpen(false);
  };

  const captureWebcam = () => {
    if (!webcamVideoRef.current || !webcamCanvasRef.current) return;
    const video = webcamVideoRef.current;
    const canvas = webcamCanvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    stopWebcam();
    processImageForOCR(dataUrl);
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressedDataUrl = await compressImage(file, 1600, 0.85);
      processImageForOCR(compressedDataUrl);
    } catch (err: any) {
      showToast('Chyba při přípravě obrázku: ' + err.message, 'warning');
    }
    e.target.value = '';
  };

  // Drag & Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    dropZoneRef.current?.classList.add('border-rose-500', 'bg-rose-950/20');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dropZoneRef.current?.classList.remove('border-rose-500', 'bg-rose-950/20');
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dropZoneRef.current?.classList.remove('border-rose-500', 'bg-rose-950/20');
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const dataUrl = await compressImage(file, 1600, 0.85);
      processImageForOCR(dataUrl);
    } else {
      showToast('Přetáhněte prosím obrázek formuláře (JPG nebo PNG).', 'warning');
    }
  };

  // Batch guest saving helper (works with and without backend)
  const saveBatchGuests = async (targetProp: Property, newGuestList: any[]) => {
    let updatedProps = [...properties];
    const existingIdx = updatedProps.findIndex(p => p.id === targetProp.id || (p.name.toLowerCase() === targetProp.name.toLowerCase() && p.districtKey === targetProp.districtKey));
    if (existingIdx >= 0) {
      updatedProps[existingIdx] = targetProp;
    } else {
      updatedProps.push(targetProp);
    }

    const formattedGuests: Guest[] = newGuestList.map((g: any) => {
      const nights = Math.max(1, parseInt(g.nights) || 1);
      const isExempt = g.exemption && g.exemption !== 'none';
      return {
        id: g.id || `g_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        propertyId: targetProp.id,
        unit: (g.unit || '').trim(),
        airbnbCode: (g.airbnbCode || '').trim().toUpperCase(),
        firstName: (g.firstName || '').trim(),
        lastName: (g.lastName || '').trim(),
        fullName: (g.fullName || `${g.firstName || ''} ${g.lastName || ''}`).trim() || 'Host',
        birthDate: g.birthDate || '',
        nationality: (g.nationality || 'CZ').trim().toUpperCase(),
        purposeOfStay: g.purposeOfStay || '10 turistika / leisure',
        idDocumentNumber: (g.idDocumentNumber || '').trim(),
        idDocumentType: (g.idDocumentType || 'PAS'),
        visaNumber: (g.visaNumber || '').trim(),
        address: (g.address || '').trim(),
        dateArrival: g.dateArrival || '',
        dateDeparture: g.dateDeparture || '',
        nights,
        exemption: g.exemption || 'none',
        fee: isExempt ? 0 : nights * 50,
        createdAt: new Date().toISOString()
      };
    });

    let updatedGuests = [...formattedGuests, ...guests];

    try {
      const batchRes = await fetch('/api/batch-guests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property: targetProp,
          guests: formattedGuests
        })
      });
      if (batchRes.ok) {
        const batchData = await batchRes.json();
        updatedProps = batchData.properties;
        updatedGuests = batchData.guests;
      }
    } catch {
      // Backend not available (static host such as GitHub Pages)
    }

    setProperties(updatedProps);
    setGuests(updatedGuests);
    setActivePropertyId(targetProp.id);
    persistLocalState(updatedProps, updatedGuests, targetProp.id);
    syncToSheetIfConnected(updatedProps, updatedGuests);
    return { updatedProps, updatedGuests };
  };

  // OCR Processing Core (Supports both Cloud Server and Client-side Gemini on GitHub Pages)
  const processImageForOCR = async (dataUrl: string) => {
    setImagePreview(dataUrl);
    setIsScanning(true);
    setScanStatus(`Čtu formulář pomocí ${activeModelName}...`);

    try {
      let data: any = null;
      let modelUsed: string = activeModelName;

      // 1. Try server OCR route (if running with Express backend)
      try {
        const res = await fetch('/api/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: dataUrl,
            mimeType: 'image/jpeg',
            userApiKey: userApiKey || undefined,
            preferredModel: activeModelName
          })
        });
        if (res.ok) {
          const json = await res.json();
          data = json.data;
          modelUsed = json.modelUsed || activeModelName;
        }
      } catch {
        // Backend not available (e.g. GitHub Pages static host)
      }

      // 2. Fallback to client-side Gemini OCR (e.g. on GitHub Pages)
      if (!data) {
        if (!userApiKey) {
          throw new Error('Pro OCR skenování na GitHub Pages zadejte Gemini API klíč v Nastavení nebo se připojte ke svému Google Sešitu (list Nastaveni_API).');
        }
        setScanStatus(`Čtu formulář v prohlížeči (${activeModelName})...`);
        const clientRes = await runClientGeminiOcr(
          dataUrl,
          userApiKey,
          activeModelName,
          'image/jpeg'
        );
        data = clientRes.data;
        modelUsed = clientRes.modelUsed;
      }

      setActiveModelName(modelUsed || activeModelName);

      // Prepare detected accommodation values
      const detectedName = data.detectedPropertyName || (data.detectedUnit ? `Rezidence Unit ${data.detectedUnit}` : 'Nové ubytování Praha');
      const detectedDistrict = (data.detectedDistrictKey && PRAGUE_DISTRICTS[data.detectedDistrictKey])
        ? data.detectedDistrictKey
        : 'praha8';

      // Convert extracted guests
      const arrival = data.dateArrival || new Date().toISOString().split('T')[0];
      const departure = data.dateDeparture || new Date(Date.now() + 86400000).toISOString().split('T')[0];
      const nights = data.nights || 1;
      const unit = data.detectedUnit || '';

      // Deduplicate extracted guests
      const rawGuests = Array.isArray(data.guests) ? data.guests : [];
      const deduplicatedGuests = rawGuests.filter((g: any, index: number, self: any[]) =>
        index === self.findIndex((t: any) =>
          (t.lastName && g.lastName && t.lastName.trim().toLowerCase() === g.lastName.trim().toLowerCase() &&
           t.firstName && g.firstName && t.firstName.trim().toLowerCase() === g.firstName.trim().toLowerCase()) ||
          (t.passportNumber && g.passportNumber && t.passportNumber.trim() === g.passportNumber.trim())
        )
      );

      const parsedGuests = deduplicatedGuests.map((g: any) => {
        let exemption = g.exemptionReason || 'none';
        if (g.birthDate && exemption === 'none') {
          const birth = new Date(g.birthDate);
          if (!isNaN(birth.getTime())) {
            const age = new Date().getFullYear() - birth.getFullYear();
            if (age < 18) exemption = 'under18';
          }
        }
        return {
          id: `g_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          propertyId: '',
          unit,
          airbnbCode: '',
          firstName: g.firstName || '',
          lastName: g.lastName || '',
          fullName: `${g.firstName || ''} ${g.lastName || ''}`.trim() || 'Host',
          birthDate: g.birthDate || '',
          nationality: (g.nationality || 'CZ').toUpperCase(),
          purposeOfStay: g.purposeOfStay || '10 turistika / leisure',
          idDocumentNumber: g.passportNumber || '',
          idDocumentType: 'PAS',
          visaNumber: g.visaNumber || '',
          address: g.homeAddress || '',
          dateArrival: arrival,
          dateDeparture: departure,
          nights,
          exemption
        };
      });

      // Check whether detected accommodation agrees with any existing property
      const matchedProperty = findMatchingProperty(data, properties);

      if (matchedProperty) {
        await saveBatchGuests(matchedProperty, parsedGuests);
        showToast(`Lístek přiřazen k ubytování "${matchedProperty.name}" (${parsedGuests.length} hostů)!`, 'success');
        setActiveTab('ledger');
      } else {
        // Discrepancy or no accommodation yet: open confirmation dialog
        setPendingScanData({
          detected: data,
          guests: parsedGuests
        });
        setScanTargetChoice(properties.length > 0 ? 'existing' : 'new');
        setSelectedScanPropId(activePropertyId || properties[0]?.id || '');
        setScanNewPropForm({
          name: detectedName,
          hostName: data.detectedHostName || '',
          address: data.detectedAddress || 'Praha',
          districtKey: detectedDistrict,
          variableSymbol: data.detectedVS || ''
        });
        setIsScanConfirmModalOpen(true);
      }
    } catch (err: any) {
      console.error('Scan Error:', err);
      showToast(err.message || 'Chyba při čtení lístku.', 'warning');
    } finally {
      setIsScanning(false);
    }
  };

  // Matching helper function
  const findMatchingProperty = (detected: any, existingProps: Property[]): Property | null => {
    if (!existingProps || existingProps.length === 0) return null;

    const detVS = (detected.detectedVS || '').trim();
    const detName = (detected.detectedPropertyName || '').trim().toLowerCase();
    const detAddr = (detected.detectedAddress || '').trim().toLowerCase();

    // 1. Check if matches active property first (user might have selected it)
    if (activeProperty) {
      const actVS = (activeProperty.variableSymbol || '').trim();
      const actName = activeProperty.name.trim().toLowerCase();
      const actAddr = (activeProperty.address || '').trim().toLowerCase();
      if (detVS && actVS && detVS === actVS) return activeProperty;
      if (detName && (actName === detName || (actName.length > 5 && actName.includes(detName)) || (detName.length > 5 && detName.includes(actName)))) return activeProperty;
      if (detAddr && actAddr && (actAddr.includes(detAddr) || detAddr.includes(actAddr))) return activeProperty;
    }

    // 2. Check by Variable Symbol / ICO
    if (detVS && detVS.length >= 4) {
      const matchVS = existingProps.find(p => p.variableSymbol && p.variableSymbol.trim() === detVS);
      if (matchVS) return matchVS;
    }

    // 3. Check by Name
    if (detName && detName.length >= 3) {
      const matchName = existingProps.find(p => {
        const pn = p.name.trim().toLowerCase();
        return pn === detName || (pn.length > 5 && (pn.includes(detName) || detName.includes(pn)));
      });
      if (matchName) return matchName;
    }

    // 4. Check by Address
    if (detAddr && detAddr.length >= 6) {
      const matchAddr = existingProps.find(p => {
        const pa = p.address.trim().toLowerCase();
        return pa && (pa.includes(detAddr) || detAddr.includes(pa));
      });
      if (matchAddr) return matchAddr;
    }

    return null;
  };

  // Confirm assignment from verification modal
  const handleConfirmScanAssignment = async () => {
    if (!pendingScanData) return;

    try {
      let targetProp: Property | null = null;

      if (scanTargetChoice === 'existing') {
        targetProp = properties.find(p => p.id === selectedScanPropId) || activeProperty;
        if (!targetProp) {
          showToast('Zvolte prosím existující ubytovací místo.', 'warning');
          return;
        }
      } else {
        if (!scanNewPropForm.name.trim()) {
          showToast('Zadejte prosím název nového ubytování.', 'warning');
          return;
        }
        targetProp = {
          id: `prop_${Date.now()}`,
          name: scanNewPropForm.name.trim(),
          hostName: scanNewPropForm.hostName.trim(),
          address: scanNewPropForm.address.trim(),
          districtKey: scanNewPropForm.districtKey,
          variableSymbol: scanNewPropForm.variableSymbol.trim()
        };
      }

      await saveBatchGuests(targetProp, pendingScanData.guests);
      setIsScanConfirmModalOpen(false);
      setPendingScanData(null);
      showToast(`Uloženo ${pendingScanData.guests.length} hostů pro "${targetProp.name}"!`, 'success');
      setActiveTab('ledger');
    } catch (err: any) {
      showToast('Chyba: ' + err.message, 'warning');
    }
  };

  // Reset entire database to pristine zero-state
  const handleResetData = async () => {
    if (!window.confirm('POZOR: Opravdu chcete vymazat celou databázi ubytování a hostů do čistého nulového stavu?')) return;
    try {
      const res = await fetch('/api/reset-data', { method: 'POST' });
      if (res.ok) {
        setProperties([]);
        setGuests([]);
        setActivePropertyId('');
        safeStorage.removeItem('airtax_local_yaml');
        syncToSheetIfConnected([], []);
        showToast('Databáze byla resetována do čistého stavu.', 'info');
      }
    } catch (err: any) {
      showToast('Chyba při resetování: ' + err.message, 'warning');
    }
  };

  // Save Settings & API key
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    safeStorage.setItem('airtax_user_api_key', userApiKey);
    safeStorage.setItem('airtax_model_pref', activeModelName);
    if (googleToken && connectedSheet) {
      try {
        await saveApiKeyToSheet(googleToken, connectedSheet.id, userApiKey, activeModelName);
        showToast('Nastavení a API klíč uloženy do Google Sheetu!', 'success');
      } catch (err: any) {
        showToast('Klíč uložen lokálně, zápis do Sheetu selhal: ' + err.message, 'warning');
      }
    } else {
      showToast('Nastavení OCR uloženo!', 'success');
    }
    setIsSettingsModalOpen(false);
  };

  // Copy payment details
  const handleCopyPayment = () => {
    if (!activeProperty || !activeDistrict) return;
    const text = `Platební příkaz MČ Praha – Poplatek z pobytu:
Příjemce: ${activeDistrict.name}
Číslo účtu: ${activeDistrict.fullAccount}
Částka k odvodu: ${totalFee} Kč
Variabilní symbol (VS): ${activeProperty.variableSymbol || 'Chybí VS!'}
Datová schránka MČ: ${activeDistrict.datovaschranka}
Zpráva: ${paymentMessage || `Airbnb ${activeProperty.name}`}`;

    navigator.clipboard.writeText(text);
    showToast('Platební údaje zkopírovány do schránky!', 'success');
  };

  // Export CSV
  const handleExportCSV = () => {
    if (!activeProperty || activeGuests.length === 0) {
      showToast('Kniha hostů je prázdná.', 'warning');
      return;
    }

    const headers = [
      'Jednotka', 'Příjmení', 'Jméno', 'Datum narození', 'Státní občanství',
      'Účel pobytu', 'Číslo pasu/dokladu', 'Číslo víza', 'Bydliště',
      'Příjezd', 'Odjezd', 'Počet nocí', 'Osvobození', 'Sazba (Kč)', 'Celkový poplatek (Kč)'
    ];

    const rows = activeGuests.map(g => [
      `"${g.unit.replace(/"/g, '""')}"`,
      `"${g.lastName.replace(/"/g, '""')}"`,
      `"${g.firstName.replace(/"/g, '""')}"`,
      `"${g.birthDate.replace(/"/g, '""')}"`,
      `"${g.nationality.replace(/"/g, '""')}"`,
      `"${g.purposeOfStay.replace(/"/g, '""')}"`,
      `"${g.idDocumentNumber.replace(/"/g, '""')}"`,
      `"${g.visaNumber.replace(/"/g, '""')}"`,
      `"${g.address.replace(/"/g, '""')}"`,
      `"${g.dateArrival.replace(/"/g, '""')}"`,
      `"${g.dateDeparture.replace(/"/g, '""')}"`,
      g.nights,
      `"${g.exemption}"`,
      g.exemption !== 'none' ? 0 : 50,
      g.fee
    ]);

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `AirTax_${activeProperty.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('CSV tabulka byla stažena.', 'success');
  };

  // Download YAML (works on static hosts and fullstack)
  const handleDownloadYaml = () => {
    try {
      const exportData = {
        meta: {
          version: '3.0',
          description: 'AirTax Praha - Evidence ubytovaných a poplatků z pobytu',
          lastUpdated: new Date().toISOString(),
          activePropertyId
        },
        properties,
        guests
      };
      const yamlStr = jsyaml.dump(exportData, { indent: 2 });
      const blob = new Blob([yamlStr], { type: 'text/yaml;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `AirTax_zaloha_${new Date().toISOString().slice(0, 10)}.yaml`;
      link.click();
      URL.revokeObjectURL(url);
      showToast('Záložní soubor data.yaml byl stažen.', 'success');
    } catch (err: any) {
      showToast('Chyba při exportu YAML: ' + err.message, 'warning');
    }
  };

  // Import YAML file (works on static hosts and fullstack)
  const handleImportYamlFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = jsyaml.load(text) as any;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Neplatný formát souboru YAML');
      }

      const importedProps: Property[] = Array.isArray(parsed.properties) ? parsed.properties : [];
      const importedGuests: Guest[] = Array.isArray(parsed.guests) ? parsed.guests : [];
      const newActiveId = parsed.meta?.activePropertyId || importedProps[0]?.id || '';

      // Try server import if available
      try {
        await fetch('/api/import/yaml', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ yamlContent: text })
        });
      } catch {
        // Static hosting fallback (GitHub Pages)
      }

      setProperties(importedProps);
      setGuests(importedGuests);
      setActivePropertyId(newActiveId);
      persistLocalState(importedProps, importedGuests, newActiveId);
      syncToSheetIfConnected(importedProps, importedGuests);
      setIsDataModalOpen(false);
      showToast(`Data úspěšně importována (${importedProps.length} ubytování, ${importedGuests.length} hostů)!`, 'success');
    } catch (err: any) {
      showToast('Chyba při importu: ' + err.message, 'warning');
    }
    e.target.value = '';
  };

  // Helper date recalculation for guest form
  const handleDateChange = (type: 'arr' | 'dep', value: string) => {
    const newArr = type === 'arr' ? value : guestForm.dateArrival;
    const newDep = type === 'dep' ? value : guestForm.dateDeparture;
    let n = guestForm.nights;
    if (newArr && newDep) {
      const d1 = new Date(newArr);
      const d2 = new Date(newDep);
      if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
        const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24));
        if (diff > 0) n = diff;
      }
    }
    setGuestForm(prev => ({
      ...prev,
      dateArrival: newArr,
      dateDeparture: newDep,
      nights: n
    }));
  };

  const handleBirthDateChange = (val: string) => {
    let ex = guestForm.exemption;
    if (val) {
      const dob = new Date(val);
      if (!isNaN(dob.getTime())) {
        const age = new Date().getFullYear() - dob.getFullYear();
        if (age < 18) ex = 'under18';
      }
    }
    setGuestForm(prev => ({ ...prev, birthDate: val, exemption: ex }));
  };

  return (
    <div className="flex flex-col h-full bg-[#0A0E17] text-slate-100 font-sans selection:bg-rose-500 selection:text-white">

      {/* TOP HEADER */}
      <header className="sticky top-0 z-40 bg-[#0D131F] border-b border-slate-800/90 px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-3 shadow-md select-none">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#FF385C] to-rose-600 flex items-center justify-center shadow-md shadow-rose-600/30 shrink-0">
              <Scan className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 leading-none">
                <h1 className="text-sm font-bold tracking-tight text-white">AirTax Praha</h1>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400 font-bold border border-rose-500/30">
                  50 Kč/noc
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="text-[10px] text-slate-400 font-medium">Cloud Sync aktivní</span>
                <span className="text-[10px] text-slate-600">•</span>
                <span className="text-[10px] text-emerald-400 font-mono font-semibold">{activeModelName}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Google Sheets Status / Connect Button */}
            {currentUser && connectedSheet ? (
              <div className="flex items-center gap-1.5 bg-emerald-950/60 border border-emerald-500/40 rounded-xl px-2.5 py-1.5 shadow-sm">
                <a
                  href={connectedSheet.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300 tap-active"
                  title="Otevřít propojený Google Sheet"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="hidden sm:inline">Sheet</span>
                  <ExternalLink className="w-2.5 h-2.5 opacity-75 shrink-0" />
                </a>
                <button
                  onClick={() => autoConnectSheet(googleToken!)}
                  disabled={isSyncingSheet}
                  className="p-0.5 text-emerald-400 hover:text-white tap-active cursor-pointer"
                  title="Znovu načíst data ze Sešitu"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSheet ? 'animate-spin' : ''}`} />
                </button>
              </div>
            ) : (
              <button
                onClick={handleGoogleLoginClick}
                disabled={isGoogleLoading}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold tap-active cursor-pointer shadow-sm transition-all"
                title="Připojit Google Sheet pro automatické ukládání dat a API klíče"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="hidden sm:inline">{isGoogleLoading ? 'Připojuji...' : 'Google Sheet'}</span>
                <span className="sm:hidden">{isGoogleLoading ? '...' : 'Sheet'}</span>
              </button>
            )}

            <button
              onClick={() => setIsDataModalOpen(true)}
              className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700/80 flex items-center justify-center text-slate-200 tap-active cursor-pointer shadow-sm transition-all"
              title="Export & Import dat"
            >
              <Download className="w-4 h-4 text-emerald-400" />
            </button>
            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700/80 flex items-center justify-center text-amber-300 tap-active cursor-pointer shadow-sm transition-all"
              title="Nastavení OCR, Google Sheet & Klíče"
            >
              <Sliders className="w-4 h-4 text-amber-400" />
            </button>
            <button
              onClick={() => { setPropModalMode('list'); setIsPropModalOpen(true); }}
              className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700/80 flex items-center justify-center text-slate-200 tap-active cursor-pointer shadow-sm transition-all"
              title="Správa ubytovacích míst"
            >
              <Building className="w-4 h-4 text-rose-400" />
            </button>
          </div>
        </div>
      </header>

      {/* TOAST NOTIFICATION */}
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 w-11/12 max-w-sm pointer-events-none">
          <div className="bg-slate-900/95 border border-slate-700 text-white px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-3 backdrop-blur-md">
            {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {toast.type === 'warning' && <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
            {toast.type === 'info' && <Info className="w-4 h-4 text-rose-400 shrink-0" />}
            <p className="text-xs font-medium text-slate-200">{toast.message}</p>
          </div>
        </div>
      )}

      {/* MAIN SCROLLABLE CONTAINER */}
      <main className="flex-1 overflow-y-auto no-scrollbar px-4 pt-3 pb-24 max-w-2xl mx-auto w-full space-y-4">

        {/* ACTIVE PROPERTY SELECTOR / ZERO-STATE BANNER */}
        {properties.length === 0 ? (
          <div className="rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 p-4 text-center space-y-2.5 shadow-md">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-400 flex items-center justify-center mx-auto">
              <Building className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Žádné ubytovací místo</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Vyfoťte ubytovací lístek (místo se vytvoří samo) nebo jej přidejte ručně.
              </p>
            </div>
            <button
              onClick={openNewPropertyModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-[#FF385C] to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-rose-600/30 tap-active cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Přidat ubytovací místo</span>
            </button>
          </div>
        ) : (
          <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-3.5 shadow-md space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1">
                <Building className="w-3 h-3 text-rose-400" /> Aktivní ubytování:
              </span>
              <button
                onClick={openNewPropertyModal}
                className="text-[11px] font-bold text-rose-400 hover:text-rose-300 flex items-center gap-1 tap-active"
              >
                <Plus className="w-3 h-3" /> Nové místo
              </button>
            </div>

            <div className="relative">
              <select
                value={activePropertyId}
                onChange={e => handleSelectProperty(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-white outline-none focus:ring-1 focus:ring-rose-500 appearance-none pr-8 cursor-pointer"
              >
                {properties.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({(PRAGUE_DISTRICTS[p.districtKey]?.name || 'Praha').replace('Městská část ', '')})
                  </option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>

            {activeProperty && activeDistrict && (
              <div className="flex items-center justify-between pt-0.5 text-[11px]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30 truncate">
                    {activeDistrict.name.replace('Městská část ', '')}
                  </span>
                  <span className="text-slate-400 truncate">
                    Hostitel: <strong className="text-slate-200 font-medium">{activeProperty.hostName || 'neuveden'}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <span className="text-slate-400 font-mono">VS:</span>
                  <span className="text-amber-400 font-mono font-bold">{activeProperty.variableSymbol || 'Chybí VS!'}</span>
                  <button
                    onClick={() => openEditPropertyModal(activeProperty)}
                    className="p-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white tap-active"
                    title="Upravit"
                  >
                    <Sliders className="w-3.5 h-3.5 text-rose-400" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 1: SCANNER & OCR */}
        {activeTab === 'scan' && (
          <div className="space-y-4">
            {/* Camera / Drop Zone Card */}
            <div
              ref={dropZoneRef}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 p-5 shadow-xl transition-all"
            >
              <div className="text-center space-y-1.5 mb-4">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Zap className="w-3.5 h-3.5" />
                  <span>Dynamické OCR: {activeModelName}</span>
                </div>
                <h2 className="text-base font-bold text-white">Naskenovat Registration Form</h2>
                <p className="text-xs text-slate-400">
                  Vyfoťte ubytovací lístek fotoaparátem nebo jej sem přetáhněte. Termín se automaticky přiřadí všem osobám na lístku.
                </p>
              </div>

              {/* Hidden file inputs */}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileInputChange}
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileInputChange}
              />

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={handleTakePhotoClick}
                  className="col-span-2 py-3.5 px-4 bg-gradient-to-r from-[#FF385C] to-rose-600 hover:from-rose-600 hover:to-rose-700 rounded-2xl font-bold text-white shadow-lg shadow-rose-600/30 flex items-center justify-center gap-2 tap-active cursor-pointer"
                >
                  <Camera className="w-5 h-5" />
                  <span className="text-sm">Vyfotit lístek</span>
                </button>

                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="py-2.5 px-3 bg-slate-800/80 hover:bg-slate-750 border border-slate-700 rounded-xl text-xs font-medium text-slate-300 flex items-center justify-center gap-1.5 tap-active cursor-pointer"
                >
                  <ImageIcon className="w-4 h-4 text-rose-400" />
                  <span>Z galerie / disku</span>
                </button>

                <button
                  type="button"
                  onClick={openNewGuestModal}
                  className="py-2.5 px-3 bg-slate-800/80 hover:bg-slate-750 border border-slate-700 rounded-xl text-xs font-medium text-blue-300 flex items-center justify-center gap-1.5 tap-active cursor-pointer"
                >
                  <Edit3 className="w-4 h-4 text-blue-400" />
                  <span>Ruční zápis</span>
                </button>
              </div>

              <div className="hidden md:flex items-center justify-center gap-1.5 mt-3 pt-3 border-t border-slate-800/80 text-[11px] text-slate-500">
                <Laptop className="w-3.5 h-3.5" />
                <span>Na počítači můžete obrázek formuláře (JPG/PNG) přetáhnout přímo sem</span>
              </div>
            </div>

            {/* OCR Live Scanning State Card */}
            {isScanning && (
              <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-200 flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-rose-400 animate-spin" />
                    <span>{scanStatus}</span>
                  </span>
                  <button
                    onClick={() => setIsScanning(false)}
                    className="text-[11px] text-rose-400 font-medium tap-active"
                  >
                    Zrušit
                  </button>
                </div>

                {imagePreview && (
                  <div className="relative rounded-xl overflow-hidden max-h-48 bg-black/60 border border-slate-800 flex items-center justify-center">
                    <img src={imagePreview} alt="Snímek" className="w-full object-contain max-h-48" />
                    <div className="animate-laser absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-rose-500 to-transparent"></div>
                  </div>
                )}
                <p className="text-[11px] text-slate-400 italic text-center">
                  Gemini čte jméno, pas, data pobytu a počítá poplatek 50 Kč/noc.
                </p>
              </div>
            )}

            {/* Monthly KPI Balance Summary */}
            <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4 space-y-3 shadow-md">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Měsíční bilance poplatku:
                </h3>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-semibold border border-slate-700">
                  {activeGuests.length} osob
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-950/60 rounded-xl p-2.5 border border-slate-800">
                  <p className="text-[10px] text-slate-400">Celkem nocí</p>
                  <p className="text-base font-bold text-white mt-0.5">{totalNights}</p>
                </div>
                <div className="bg-emerald-950/30 border border-emerald-800/30 rounded-xl p-2.5">
                  <p className="text-[10px] text-emerald-400">Osvobozeno</p>
                  <p className="text-base font-bold text-emerald-300 mt-0.5">{exemptNights} nocí</p>
                </div>
                <div className="bg-rose-950/40 border border-rose-800/40 rounded-xl p-2.5">
                  <p className="text-[10px] text-rose-300">K úhradě (50 Kč)</p>
                  <p className="text-base font-black text-rose-400 mt-0.5">{totalFee.toLocaleString('cs-CZ')} Kč</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: GUEST LEDGER */}
        {activeTab === 'ledger' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-1">
              <div>
                <h2 className="text-base font-bold text-white">Evidenční kniha hostů</h2>
                <p className="text-xs text-slate-400">Záznamy pro {activeProperty?.name || 'ubytování'}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={openNewGuestModal}
                  className="px-3 py-1.5 bg-[#FF385C] hover:bg-rose-600 text-white rounded-xl text-xs font-semibold flex items-center gap-1 shadow tap-active cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Přidat</span>
                </button>
              </div>
            </div>

            {/* Filter Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
              <button
                onClick={() => setLedgerFilter('all')}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all tap-active ${
                  ledgerFilter === 'all'
                    ? 'bg-[#FF385C] text-white shadow'
                    : 'bg-slate-900 text-slate-400 border border-slate-800'
                }`}
              >
                Všichni ({activeGuests.length})
              </button>
              <button
                onClick={() => setLedgerFilter('chargeable')}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all tap-active ${
                  ledgerFilter === 'chargeable'
                    ? 'bg-[#FF385C] text-white shadow'
                    : 'bg-slate-900 text-slate-400 border border-slate-800'
                }`}
              >
                Plátci ({activeGuests.filter(g => g.exemption === 'none').length})
              </button>
              <button
                onClick={() => setLedgerFilter('exempt')}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all tap-active ${
                  ledgerFilter === 'exempt'
                    ? 'bg-[#FF385C] text-white shadow'
                    : 'bg-slate-900 text-slate-400 border border-slate-800'
                }`}
              >
                Osvobození ({activeGuests.filter(g => g.exemption !== 'none').length})
              </button>
            </div>

            {/* Guest List */}
            {activeGuests.length === 0 ? (
              <div className="text-center py-12 px-4 rounded-3xl border border-dashed border-slate-800 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-900 text-slate-500 flex items-center justify-center mx-auto">
                  <BookOpen className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-semibold text-slate-300">V knize zatím nejsou žádní hosté</h4>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  Naskenujte ubytovací lístek v záložce Skener nebo přidejte hosta ručně.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {activeGuests
                  .filter(g => {
                    if (ledgerFilter === 'chargeable') return g.exemption === 'none';
                    if (ledgerFilter === 'exempt') return g.exemption !== 'none';
                    return true;
                  })
                  .map(g => {
                    const isExempt = g.exemption !== 'none';
                    return (
                      <div
                        key={g.id}
                        className="rounded-2xl bg-slate-900/90 border border-slate-800 p-3.5 space-y-2 relative shadow-sm"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {g.unit && (
                                <span className="text-[9px] px-1.5 py-0.2 bg-slate-800 text-blue-300 rounded font-mono font-bold border border-slate-700">
                                  {g.unit}
                                </span>
                              )}
                              <h4 className="text-sm font-bold text-white">
                                {g.fullName || `${g.firstName} ${g.lastName}`}
                              </h4>
                              <span className="text-[10px] text-slate-400 font-mono">
                                ({g.nationality || 'CZ'})
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              Nar.: <strong>{g.birthDate || 'neuvedeno'}</strong> • Doklad: {g.idDocumentNumber || '-'} • Účel: <span className="text-slate-300">{g.purposeOfStay}</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            <button
                              onClick={() => openEditGuestModal(g)}
                              className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white tap-active"
                              title="Upravit"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteGuest(g.id)}
                              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-rose-400 tap-active"
                              title="Smazat"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[11px] bg-slate-950/60 rounded-xl px-3 py-1.5 border border-slate-800">
                          <span className="text-slate-400">
                            Pobyt: <strong className="text-slate-200">{g.dateArrival} → {g.dateDeparture}</strong>
                          </span>
                          <span className="text-slate-300 font-semibold">{g.nights} {g.nights === 1 ? 'noc' : 'nocí'}</span>
                        </div>

                        <div className="flex items-center justify-between pt-0.5">
                          {isExempt ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              <ShieldCheck className="w-3 h-3" /> Osvobozen (&lt;18 let)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                              Poplatek: {g.fee} Kč ({g.nights} × 50 Kč)
                            </span>
                          )}
                          <span className="text-[10px] text-slate-500 truncate max-w-[160px]">
                            {g.address || '-'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: PAYOUT & SPAYD QR PLATBA */}
        {activeTab === 'payout' && (
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-slate-900 to-slate-950 rounded-3xl border border-slate-800 p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-rose-400">
                    Měsíční vypořádání poplatku
                  </span>
                  <h2 className="text-base font-bold text-white">Příkaz k úhradě MČ</h2>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-400">Částka k odvodu</span>
                  <p className="text-xl font-black text-emerald-400">{totalFee.toLocaleString('cs-CZ')} Kč</p>
                </div>
              </div>

              {activeProperty && activeDistrict ? (
                <div className="space-y-3 bg-slate-950/60 rounded-2xl p-3.5 border border-slate-800 text-xs">
                  <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">Příjemce poplatku:</span>
                      <p className="font-bold text-white text-sm">{activeDistrict.name}</p>
                    </div>
                    <button
                      onClick={() => { setPropModalMode('list'); setIsPropModalOpen(true); }}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-lg text-[11px] font-semibold tap-active"
                    >
                      Změnit
                    </button>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Bankovní účet (Česká spořitelna):</span>
                    <p className="font-mono text-emerald-400 font-bold text-sm tracking-wide mt-0.5">{activeDistrict.fullAccount}</p>
                  </div>

                  <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">
                        Variabilní symbol (přidělený MČ):
                      </span>
                      <button
                        onClick={() => openEditPropertyModal(activeProperty)}
                        className="text-[10px] text-rose-400 hover:underline font-semibold"
                      >
                        Upravit VS
                      </button>
                    </div>
                    <p className="font-mono font-bold text-sm text-amber-400 tracking-wider mt-0.5">
                      {activeProperty.variableSymbol || 'Chybí VS! (Vyplňte v ubytování)'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">
                      Zpráva pro příjemce:
                    </label>
                    <input
                      type="text"
                      value={paymentMessage}
                      onChange={e => setPaymentMessage(e.target.value)}
                      placeholder={`Airbnb ${activeProperty.name} - Poplatek`}
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-rose-500 outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1 text-[11px]">
                    <span className="text-slate-400">Datová schránka MČ pro podání:</span>
                    <span className="font-mono text-blue-300 font-bold">{activeDistrict.datovaschranka}</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400 text-center py-2">
                  Přidejte ubytování pro zobrazení platebních údajů MČ.
                </p>
              )}

              {/* SPAYD QR CODE */}
              <div className="bg-white rounded-2xl p-4 flex flex-col items-center justify-center shadow-lg">
                <p className="text-xs font-bold text-slate-900 mb-2">Okamžitá platba přes SPAYD QR kód</p>
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="SPAYD QR Kód" className="w-48 h-48 object-contain rounded-lg" />
                ) : (
                  <div className="h-44 flex flex-col items-center justify-center text-slate-400 text-xs">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-1" />
                    <p className="font-bold text-slate-700">Poplatek k odvodu je 0 Kč</p>
                  </div>
                )}
                <p className="text-[10px] text-slate-500 mt-2 text-center">
                  Naskenujte v aplikaci George, KB+, Smart Banka, ČSOB Smart nebo My Air
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCopyPayment}
                  className="py-2.5 px-3 bg-slate-800 hover:bg-slate-750 border border-slate-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 tap-active cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Kopírovat údaje</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="py-2.5 px-3 bg-gradient-to-r from-[#FF385C] to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 tap-active shadow-lg shadow-rose-600/30 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Stáhnout CSV</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: LAW & HELP */}
        {activeTab === 'info' && (
          <div className="rounded-3xl bg-slate-900 border border-slate-800 p-5 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-rose-400">
              <ShieldCheck className="w-5 h-5" />
              <h2 className="text-base font-bold text-white">Pravidla odvodu & Dynamické OCR</h2>
            </div>

            <div className="space-y-2 border-b border-slate-800 pb-3">
              <h3 className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" />
                Dynamický výběr levného OCR modelu
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Aplikace používá primární alias <code>gemini-flash-latest</code>, který automaticky směruje na nejnovější a nejúspornější Flash model. V případě změny tarifu nebo nedostupnosti model plynule přechází na <code>gemini-3.8-flash</code> nebo <code>gemini-3.1-flash-lite</code>.
              </p>
            </div>

            <div className="space-y-2 border-b border-slate-800 pb-3">
              <h3 className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" />
                Sazba poplatku hl. m. Prahy (50 Kč/noc)
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Místní poplatek z pobytu v hl. m. Praze činí <strong>50 Kč za každý započatý den pobytu</strong> (den příjezdu se dle zákona nepočítá). Osoby mladší 18 let jsou ze zákona č. 565/1990 Sb. osvobozeny (poplatek 0 Kč).
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
                <Laptop className="w-3.5 h-3.5" />
                Běh v Google Sites
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Díky cloudovému serveru jsou ubytovací místa a hosté synchronizováni na všech zařízeních současně. Vložená aplikace v Google Sites nevyžaduje oprávnění cookies třetích stran a funguje plynule na iPhonech i telefonech Android.
              </p>
            </div>
          </div>
        )}

      </main>

      {/* BOTTOM NAVIGATION TAB BAR */}
      <nav className="fixed bottom-0 inset-x-0 bg-[#0D131F] border-t border-slate-800 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] z-40 shadow-lg select-none">
        <div className="max-w-2xl mx-auto grid grid-cols-4 gap-1">
          <button
            onClick={() => setActiveTab('scan')}
            className={`flex flex-col items-center justify-center py-1 tap-active cursor-pointer ${
              activeTab === 'scan' ? 'text-rose-500 font-bold' : 'text-slate-400'
            }`}
          >
            <Scan className="w-5 h-5" />
            <span className="text-[10px] mt-1">Skener</span>
          </button>

          <button
            onClick={() => setActiveTab('ledger')}
            className={`flex flex-col items-center justify-center py-1 tap-active cursor-pointer relative ${
              activeTab === 'ledger' ? 'text-rose-500 font-bold' : 'text-slate-400'
            }`}
          >
            <BookOpen className="w-5 h-5" />
            <span className="text-[10px] mt-1">Kniha</span>
            {activeGuests.length > 0 && (
              <span className="absolute top-0 right-5 w-4 h-4 rounded-full bg-rose-500 text-[9px] font-bold text-white flex items-center justify-center">
                {activeGuests.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('payout')}
            className={`flex flex-col items-center justify-center py-1 tap-active cursor-pointer ${
              activeTab === 'payout' ? 'text-rose-500 font-bold' : 'text-slate-400'
            }`}
          >
            <QrCodeIcon className="w-5 h-5" />
            <span className="text-[10px] mt-1">Odvod (QR)</span>
          </button>

          <button
            onClick={() => setActiveTab('info')}
            className={`flex flex-col items-center justify-center py-1 tap-active cursor-pointer ${
              activeTab === 'info' ? 'text-rose-500 font-bold' : 'text-slate-400'
            }`}
          >
            <HelpCircle className="w-5 h-5" />
            <span className="text-[10px] mt-1">Pravidla</span>
          </button>
        </div>
      </nav>

      {/* MODAL: PROPERTIES MANAGER */}
      {isPropModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto no-scrollbar">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Building className="w-4 h-4 text-rose-400" />
                  Správa ubytovacích míst
                </h3>
                <p className="text-[11px] text-slate-400">Synchronizováno napříč všemi zařízeními</p>
              </div>
              <button
                onClick={() => setIsPropModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center tap-active"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {propModalMode === 'list' ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300">Seznam ubytování:</span>
                  <button
                    onClick={openNewPropertyModal}
                    className="px-2.5 py-1 bg-[#FF385C] hover:bg-rose-600 text-white rounded-xl text-xs font-bold flex items-center gap-1 tap-active cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Nové místo</span>
                  </button>
                </div>

                {properties.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">Zatím žádná ubytovací místa.</p>
                ) : (
                  <div className="space-y-2">
                    {properties.map(p => {
                      const dist = PRAGUE_DISTRICTS[p.districtKey] || PRAGUE_DISTRICTS.praha1;
                      const isActive = p.id === activePropertyId;
                      const count = guests.filter(g => g.propertyId === p.id).length;
                      return (
                        <div
                          key={p.id}
                          className={`p-3 rounded-2xl border transition-all ${
                            isActive
                              ? 'bg-rose-950/25 border-rose-500/50 ring-1 ring-rose-500/40'
                              : 'bg-slate-950/60 border-slate-800'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <h4 className="text-xs font-bold text-white truncate">{p.name}</h4>
                                {isActive && (
                                  <span className="text-[9px] px-1.5 py-0.2 bg-rose-500 text-white rounded-full font-bold">
                                    Aktivní
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                                Hostitel: {p.hostName || 'neuveden'}
                              </p>
                              <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                                <span className="px-1.5 py-0.5 bg-slate-900 rounded border border-slate-800 text-blue-300 font-medium">
                                  {dist.name.replace('Městská část ', '')}
                                </span>
                                <span>VS: <strong className="font-mono text-amber-400">{p.variableSymbol || 'Chybí'}</strong></span>
                                <span>• {count} hostů</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 ml-2 shrink-0">
                              {!isActive && (
                                <button
                                  onClick={() => handleSelectProperty(p.id)}
                                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-750 text-white rounded-lg text-xs font-semibold tap-active"
                                >
                                  Zvolit
                                </button>
                              )}
                              <button
                                onClick={() => openEditPropertyModal(p)}
                                className="p-1.5 bg-slate-800 text-slate-300 rounded-lg hover:text-white tap-active"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteProperty(p.id)}
                                className="p-1.5 bg-slate-800 text-slate-400 hover:text-rose-400 rounded-lg tap-active"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleSaveProperty} className="space-y-3 text-xs">
                <div>
                  <label className="block font-bold text-slate-300 mb-1">Název ubytování / Rezidence *</label>
                  <input
                    type="text"
                    required
                    value={propForm.name}
                    onChange={e => setPropForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Např. Karolina Plazza Karlín"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-300 mb-1">Jméno hostitele / Provozovatele</label>
                  <input
                    type="text"
                    value={propForm.hostName}
                    onChange={e => setPropForm(prev => ({ ...prev, hostName: e.target.value }))}
                    placeholder="Jméno a příjmení / Firma"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-300 mb-1">Adresa v Praze</label>
                  <input
                    type="text"
                    value={propForm.address}
                    onChange={e => setPropForm(prev => ({ ...prev, address: e.target.value }))}
                    placeholder="Sokolovská 694/102, 186 00 Praha 8"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-300 mb-1">Městská část (katastr) *</label>
                  <select
                    value={propForm.districtKey}
                    onChange={e => setPropForm(prev => ({ ...prev, districtKey: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-rose-500"
                  >
                    {Object.values(PRAGUE_DISTRICTS).map(d => (
                      <option key={d.code} value={d.code}>
                        {d.name} ({d.cadastres})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-300 mb-1">
                    Variabilní symbol (přidělený MČ nebo IČO)
                  </label>
                  <input
                    type="text"
                    value={propForm.variableSymbol}
                    onChange={e => setPropForm(prev => ({ ...prev, variableSymbol: e.target.value }))}
                    placeholder="Např. 17974305"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPropModalMode('list')}
                    className="w-1/3 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-semibold tap-active"
                  >
                    Zpět
                  </button>
                  <button
                    type="submit"
                    className="w-2/3 py-2.5 rounded-xl bg-gradient-to-r from-[#FF385C] to-rose-600 text-white font-bold shadow-lg shadow-rose-600/30 tap-active cursor-pointer"
                  >
                    Uložit ubytování
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MODAL: MANUAL GUEST */}
      {isGuestModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[92vh] overflow-y-auto no-scrollbar">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">
                {editingGuest ? 'Upravit hosta' : 'Nový záznam hosta'}
              </h3>
              <button
                onClick={() => setIsGuestModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center tap-active"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveGuest} className="space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <label className="block font-bold text-slate-300 mb-1">Jednotka</label>
                  <input
                    type="text"
                    value={guestForm.unit}
                    onChange={e => setGuestForm(prev => ({ ...prev, unit: e.target.value }))}
                    placeholder="E302"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-semibold outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block font-bold text-slate-300 mb-1">Airbnb kód</label>
                  <input
                    type="text"
                    value={guestForm.airbnbCode}
                    onChange={e => setGuestForm(prev => ({ ...prev, airbnbCode: e.target.value.toUpperCase() }))}
                    placeholder="HM..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono uppercase outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-300 mb-1">Příjmení *</label>
                  <input
                    type="text"
                    required
                    value={guestForm.lastName}
                    onChange={e => setGuestForm(prev => ({ ...prev, lastName: e.target.value }))}
                    placeholder="Kinkaid"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300 mb-1">Jméno *</label>
                  <input
                    type="text"
                    required
                    value={guestForm.firstName}
                    onChange={e => setGuestForm(prev => ({ ...prev, firstName: e.target.value }))}
                    placeholder="Kenneth"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-300 mb-1">Datum narození</label>
                  <input
                    type="date"
                    value={guestForm.birthDate}
                    onChange={e => handleBirthDateChange(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300 mb-1">Státní občanství</label>
                  <input
                    type="text"
                    value={guestForm.nationality}
                    onChange={e => setGuestForm(prev => ({ ...prev, nationality: e.target.value.toUpperCase() }))}
                    placeholder="USA / CZ / DE"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-rose-500 uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-300 mb-1">Číslo dokladu / pasu</label>
                  <input
                    type="text"
                    value={guestForm.idDocumentNumber}
                    onChange={e => setGuestForm(prev => ({ ...prev, idDocumentNumber: e.target.value }))}
                    placeholder="A50465791"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300 mb-1">Účel pobytu</label>
                  <select
                    value={guestForm.purposeOfStay}
                    onChange={e => setGuestForm(prev => ({ ...prev, purposeOfStay: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
                  >
                    <option value="10 turistika / leisure">10 – Turistika / Leisure</option>
                    <option value="01 obchod / business">01 – Obchod / Business</option>
                    <option value="07 sport">07 – Sport</option>
                    <option value="11 studium / study">11 – Studium / Study</option>
                    <option value="00 zdravi / health">00 – Zdraví / Health</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Trvalé bydliště</label>
                <input
                  type="text"
                  value={guestForm.address}
                  onChange={e => setGuestForm(prev => ({ ...prev, address: e.target.value }))}
                  placeholder="6917 S Queen St Littleton Co"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-300 mb-1">Příjezd</label>
                  <input
                    type="date"
                    required
                    value={guestForm.dateArrival}
                    onChange={e => handleDateChange('arr', e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300 mb-1">Odjezd</label>
                  <input
                    type="date"
                    required
                    value={guestForm.dateDeparture}
                    onChange={e => handleDateChange('dep', e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 items-center bg-slate-950/70 p-3 rounded-2xl border border-slate-800">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400">Počet nocí</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={guestForm.nights}
                    onChange={e => setGuestForm(prev => ({ ...prev, nights: parseInt(e.target.value) || 1 }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-bold outline-none"
                  />
                </div>
                <div className="text-right">
                  <span className="block text-[11px] text-slate-400">Poplatek</span>
                  <span className="text-base font-black text-rose-400">
                    {guestForm.exemption !== 'none' ? '0 Kč (Osvobozen)' : `${guestForm.nights * 50} Kč`}
                  </span>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Osvobození od poplatku (§ 3b)</label>
                <select
                  value={guestForm.exemption}
                  onChange={e => setGuestForm(prev => ({ ...prev, exemption: e.target.value as any }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
                >
                  <option value="none">Ne – Plátce (50 Kč / noc)</option>
                  <option value="under18">Osoba mladší 18 let (Osvobozeno)</option>
                  <option value="ztp">Držitel průkazu ZTP/P (Osvobozeno)</option>
                  <option value="other">Jiný zákonný důvod (§ 3b)</option>
                </select>
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsGuestModalOpen(false)}
                  className="w-1/2 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-semibold tap-active"
                >
                  Zrušit
                </button>
                <button
                  type="submit"
                  className="w-1/2 py-2.5 rounded-xl bg-gradient-to-r from-[#FF385C] to-rose-600 text-white font-bold shadow-lg shadow-rose-600/30 tap-active cursor-pointer"
                >
                  Uložit hosta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: SETTINGS & DYNAMIC OCR */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto no-scrollbar">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Nastavení OCR & Úložiště</h3>
                  <p className="text-[11px] text-slate-400">Dynamický výběr modelů Gemini</p>
                </div>
              </div>
              <button
                onClick={() => setIsSettingsModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center tap-active"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-3.5 text-xs">
              {/* GOOGLE SHEETS INTEGRATION & SYNC */}
              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                    Google Sheets Synchronizace
                  </span>
                  {currentUser && (
                    <span className="text-[10px] text-slate-400 truncate max-w-[150px]">
                      {currentUser.email}
                    </span>
                  )}
                </div>

                {connectedSheet ? (
                  <div className="space-y-2">
                    <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white truncate">{connectedSheet.title}</span>
                        <a
                          href={connectedSheet.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:underline shrink-0 ml-2"
                        >
                          Otevřít Sešit ↗
                        </a>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                        Data se automaticky ukládají do 4 listů: <strong>Ubytovani</strong>, <strong>Hoste</strong>, <strong>Prehled_odvodu</strong> a <strong>Nastaveni_API</strong>.
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => autoConnectSheet(googleToken!)}
                        disabled={isSyncingSheet}
                        className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 font-semibold text-xs flex items-center justify-center gap-1.5 tap-active"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isSyncingSheet ? 'animate-spin' : ''}`} />
                        <span>{isSyncingSheet ? 'Synchronizuji...' : 'Znovu načíst data'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleGoogleLogoutClick}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-rose-400 font-semibold text-xs flex items-center gap-1 tap-active"
                        title="Odpojit účet"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Odpojit</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Připojte svůj Google účet. Aplikace automaticky vytvoří nebo vyhledá sešit <strong>AirTax Praha - Evidence ubytovaných</strong> se 4 samostatnými listy pro ubytování, hosty, odvody a nastavení.
                    </p>
                    <button
                      type="button"
                      onClick={handleGoogleLoginClick}
                      disabled={isGoogleLoading}
                      className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 tap-active cursor-pointer"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      <span>{isGoogleLoading ? 'Připojuji...' : 'Připojit Google účet (Automaticky)'}</span>
                    </button>
                  </div>
                )}

                {/* Custom Sheet ID / URL */}
                <div className="pt-2 border-t border-slate-800/80">
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">
                    Vlastní Google Sheet ID / URL (volitelné):
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={customSheetId}
                      onChange={e => setCustomSheetId(e.target.value.trim())}
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-white font-mono text-[11px] outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (googleToken) autoConnectSheet(googleToken, customSheetId);
                        else handleGoogleLoginClick();
                      }}
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-750 text-emerald-400 rounded-xl font-bold text-[11px] shrink-0 tap-active"
                    >
                      Použít
                    </button>
                  </div>
                  <p className="text-[9px] text-slate-500 mt-1">
                    Ponechte prázdné pro automatické vyhledání na vašem Google Disku.
                  </p>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Model Gemini OCR:</label>
                <select
                  value={activeModelName}
                  onChange={e => setActiveModelName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="gemini-flash-latest">gemini-flash-latest (Doporučeno • Vždy nejnovější Flash)</option>
                  <option value="gemini-3.8-flash">gemini-3.8-flash (Rychlý & přesný multimodální)</option>
                  <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Nejlevnější verze)</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Při uložení se zvolený model propíše i do listu <strong>Nastaveni_API</strong> ve vašem Google Sheetu.
                </p>
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">
                  Gemini API Klíč (ukládá se do Google Sheetu 'Nastaveni_API'):
                </label>
                <input
                  type="password"
                  value={userApiKey}
                  onChange={e => setUserApiKey(e.target.value.trim())}
                  placeholder="Ponechte prázdné pro výchozí serverový klíč"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-mono text-xs outline-none focus:ring-1 focus:ring-amber-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Klíč se bezpečně ukládá na samostatném listu <strong>Nastaveni_API</strong> ve vašem soukromém Google Sešitu a je automaticky dostupný na všech vašich zařízeních (iPhone, Android, PC, Google Sites).
                </p>
              </div>

              <div className="pt-2 space-y-2">
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold shadow-lg shadow-amber-500/20 tap-active cursor-pointer"
                >
                  Uložit nastavení & synchronizovat API list
                </button>

                <div className="pt-3 border-t border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-rose-400 tracking-wider">
                    Nebezpečná zóna:
                  </span>
                  <button
                    type="button"
                    onClick={handleResetData}
                    className="w-full mt-1.5 py-2 rounded-xl bg-rose-950/40 border border-rose-900/60 hover:bg-rose-900/50 text-rose-300 text-xs font-semibold tap-active cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Resetovat databázi do čistého nulového stavu</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DATA EXCHANGE (YAML / CSV) */}
      {isDataModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto no-scrollbar">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Download className="w-4 h-4 text-emerald-400" />
                Záloha & Přenos dat
              </h3>
              <button
                onClick={() => setIsDataModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center tap-active"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Stáhnout zálohu</h4>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleExportCSV}
                  className="p-3 bg-slate-800 hover:bg-slate-750 border border-slate-700 rounded-2xl flex flex-col items-center justify-center gap-1.5 tap-active text-center cursor-pointer"
                >
                  <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                  <span className="text-xs font-bold text-white">Stáhnout .CSV</span>
                  <span className="text-[10px] text-slate-400">Pro Excel a MČ</span>
                </button>
                <button
                  onClick={handleDownloadYaml}
                  className="p-3 bg-slate-800 hover:bg-slate-750 border border-slate-700 rounded-2xl flex flex-col items-center justify-center gap-1.5 tap-active text-center cursor-pointer"
                >
                  <FileCode className="w-5 h-5 text-blue-400" />
                  <span className="text-xs font-bold text-white">Stáhnout data.yaml</span>
                  <span className="text-[10px] text-slate-400">Kompletní cloud záloha</span>
                </button>
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-800">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Obnovit ze souboru</h4>
              <label className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-750 border border-dashed border-slate-600 rounded-2xl flex items-center justify-center gap-2 text-xs font-bold text-white tap-active cursor-pointer">
                <UploadCloud className="w-4 h-4 text-rose-400" />
                <span>Nahrát záložní soubor data.yaml</span>
                <input
                  type="file"
                  accept=".yaml,.yml"
                  className="hidden"
                  onChange={handleImportYamlFile}
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DESKTOP WEBCAM CAPTURE */}
      {isWebcamOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-3xl p-5 space-y-3.5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center">
                  <Camera className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Snímat webkamerou</h3>
                  <p className="text-[11px] text-slate-400">Přidržte ubytovací lístek před kamerou</p>
                </div>
              </div>
              <button
                onClick={stopWebcam}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center tap-active"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative rounded-2xl overflow-hidden bg-black aspect-video flex items-center justify-center border border-slate-800">
              <video ref={webcamVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <canvas ref={webcamCanvasRef} className="hidden" />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => { stopWebcam(); galleryInputRef.current?.click(); }}
                className="py-2.5 px-3 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl text-xs font-semibold tap-active"
              >
                Vybrat z disku
              </button>
              <button
                type="button"
                onClick={captureWebcam}
                className="py-2.5 px-3 bg-gradient-to-r from-[#FF385C] to-rose-600 hover:from-rose-600 text-white rounded-xl text-xs font-bold tap-active shadow-lg shadow-rose-600/30 flex items-center justify-center gap-1.5"
              >
                <Camera className="w-4 h-4" />
                <span>Vyfotit snímek</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DESKTOP CAMERA PROMPT (Ensures camera permission is requested ONLY on-demand) */}
      {isDesktopCameraPromptOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-3xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center">
                  <Camera className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Zvolte zdroj formuláře</h3>
                  <p className="text-[11px] text-slate-400">Pořízení snímku pro Gemini OCR</p>
                </div>
              </div>
              <button
                onClick={() => setIsDesktopCameraPromptOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center tap-active"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Vyberte, zda chcete nahrát vyfocený dokument z počítače nebo spustit webkameru pro přímé nasnímání.
            </p>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setIsDesktopCameraPromptOpen(false);
                  startWebcam();
                }}
                className="w-full py-3 px-4 bg-gradient-to-r from-[#FF385C] to-rose-600 hover:from-rose-600 text-white rounded-2xl text-xs font-bold shadow-lg shadow-rose-600/30 flex items-center justify-center gap-2 tap-active cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Spustit webkameru (vyžádá oprávnění)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsDesktopCameraPromptOpen(false);
                  galleryInputRef.current?.click();
                }}
                className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-2xl text-xs font-semibold flex items-center justify-center gap-2 tap-active cursor-pointer"
              >
                <ImageIcon className="w-4 h-4 text-rose-400" />
                <span>Vybrat soubor z disku</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: SCAN ACCOMMODATION VERIFICATION / MATCH DIALOG */}
      {isScanConfirmModalOpen && pendingScanData && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[92vh] overflow-y-auto no-scrollbar shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Kontrola ubytovacího místa</h3>
                  <p className="text-[11px] text-slate-400">
                    {properties.length === 0
                      ? 'Nalezeno první ubytovací místo ze skenu'
                      : 'Nascanované údaje nesouhlasí se stávajícími záznamy'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsScanConfirmModalOpen(false);
                  setPendingScanData(null);
                }}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center tap-active"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* OCR Extracted Summary Card */}
            <div className="bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800 space-y-2 text-xs">
              <span className="text-[10px] uppercase font-bold tracking-wider text-rose-400">
                Rozpoznáno z ubytovacího lístku:
              </span>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-400">Místo / Rezidence:</span>
                  <p className="font-semibold text-white truncate">{pendingScanData.detected.detectedPropertyName || 'Nezjištěno'}</p>
                </div>
                <div>
                  <span className="text-slate-400">Jednotka / Unit:</span>
                  <p className="font-semibold text-white font-mono">{pendingScanData.detected.detectedUnit || '-'}</p>
                </div>
                <div>
                  <span className="text-slate-400">Adresa:</span>
                  <p className="font-semibold text-white truncate">{pendingScanData.detected.detectedAddress || 'Praha'}</p>
                </div>
                <div>
                  <span className="text-slate-400">Městská část:</span>
                  <p className="font-semibold text-blue-300">
                    {PRAGUE_DISTRICTS[pendingScanData.detected.detectedDistrictKey]?.name || 'Praha 8'}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400">Hostitel / IČO:</span>
                  <p className="font-semibold text-slate-200 truncate">
                    {pendingScanData.detected.detectedHostName || '-'} (VS: {pendingScanData.detected.detectedVS || '-'})
                  </p>
                </div>
                <div>
                  <span className="text-slate-400">Nalezení hosté:</span>
                  <p className="font-semibold text-emerald-400">
                    {pendingScanData.guests.length} {pendingScanData.guests.length === 1 ? 'osoba' : 'osoby'} ({pendingScanData.detected.nights || 1} nocí)
                  </p>
                </div>
              </div>
            </div>

            {/* Selection between Existing Property or Creating New */}
            <div className="space-y-3">
              <label className="block text-xs font-bold text-slate-300">
                Jak si přejete tyto záznamy přiřadit?
              </label>

              <div className="grid grid-cols-2 gap-2">
                {properties.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setScanTargetChoice('existing')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all tap-active flex items-center justify-center gap-1.5 ${
                      scanTargetChoice === 'existing'
                        ? 'bg-rose-950/40 border-rose-500 text-white ring-1 ring-rose-500'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                  >
                    <Building className="w-3.5 h-3.5" />
                    <span>Přiřadit k existujícímu</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setScanTargetChoice('new')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all tap-active flex items-center justify-center gap-1.5 ${
                    scanTargetChoice === 'new' || properties.length === 0
                      ? 'col-span-2 sm:col-span-1 bg-rose-950/40 border-rose-500 text-white ring-1 ring-rose-500'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Vytvořit nové ubytování</span>
                </button>
              </div>

              {scanTargetChoice === 'existing' && properties.length > 0 ? (
                <div className="space-y-2 bg-slate-950/50 p-3 rounded-2xl border border-slate-800">
                  <label className="block text-xs font-bold text-slate-300">
                    Zvolte existující ubytovací místo:
                  </label>
                  <select
                    value={selectedScanPropId}
                    onChange={e => setSelectedScanPropId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-xs font-bold text-white outline-none focus:ring-1 focus:ring-rose-500"
                  >
                    {properties.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({(PRAGUE_DISTRICTS[p.districtKey]?.name || 'Praha').replace('Městská část ', '')})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-2.5 bg-slate-950/50 p-3 rounded-2xl border border-slate-800 text-xs">
                  <div>
                    <label className="block font-bold text-slate-300 mb-1">Název nového ubytování *</label>
                    <input
                      type="text"
                      required
                      value={scanNewPropForm.name}
                      onChange={e => setScanNewPropForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Např. Karolina Plazza Karlín"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-rose-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-bold text-slate-300 mb-1">Městská část *</label>
                      <select
                        value={scanNewPropForm.districtKey}
                        onChange={e => setScanNewPropForm(prev => ({ ...prev, districtKey: e.target.value }))}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-2 text-white outline-none focus:ring-1 focus:ring-rose-500 text-xs"
                      >
                        {Object.values(PRAGUE_DISTRICTS).map(d => (
                          <option key={d.code} value={d.code}>
                            {d.name.replace('Městská část ', '')}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-slate-300 mb-1">Variabilní symbol</label>
                      <input
                        type="text"
                        value={scanNewPropForm.variableSymbol}
                        onChange={e => setScanNewPropForm(prev => ({ ...prev, variableSymbol: e.target.value }))}
                        placeholder="17974305"
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono outline-none focus:ring-1 focus:ring-rose-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-300 mb-1">Adresa</label>
                    <input
                      type="text"
                      value={scanNewPropForm.address}
                      onChange={e => setScanNewPropForm(prev => ({ ...prev, address: e.target.value }))}
                      placeholder="Sokolovská 694/102, Praha 8"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-rose-500"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsScanConfirmModalOpen(false);
                  setPendingScanData(null);
                }}
                className="w-1/3 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-semibold tap-active"
              >
                Zrušit
              </button>
              <button
                type="button"
                onClick={handleConfirmScanAssignment}
                className="w-2/3 py-2.5 rounded-xl bg-gradient-to-r from-[#FF385C] to-rose-600 text-white font-bold shadow-lg shadow-rose-600/30 tap-active cursor-pointer"
              >
                Potvrdit a uložit hosty
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: FIREBASE AUTHORIZED DOMAINS INSTRUCTION */}
      {isDomainModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-3xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Povolení domény v Google Firebase</h3>
                  <p className="text-[11px] text-slate-400">auth/unauthorized-domain</p>
                </div>
              </div>
              <button
                onClick={() => setIsDomainModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center tap-active"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Google z bezpečnostních důvodů vyžaduje, aby každá nová adresa, ze které se uživatelé přihlašují k Sešitu (GitHub Pages nebo Google Sites), byla jednorázově přidána do seznamu povolených domén vašeho projektu <strong>{firebaseProjectId}</strong>.
            </p>

            <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
              <span className="text-[10px] uppercase font-bold text-slate-400">Doména k přidání:</span>
              <div className="flex items-center justify-between bg-slate-900 px-3 py-2 rounded-xl border border-slate-700">
                <code className="text-xs font-mono text-emerald-400 font-bold">{window.location.hostname}</code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.hostname);
                    showToast('Doména zkopírována do schránky!', 'success');
                  }}
                  className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 tap-active"
                  title="Kopírovat"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-slate-300">
              <span className="font-bold text-white text-[11px]">Postup (zabere 30 sekund):</span>
              <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-400">
                <li>Klikněte na tlačítko <strong>Otevřít Firebase Console</strong> níže.</li>
                <li>V sekci <strong>Authorized domains</strong> klikněte na <strong>Add domain</strong>.</li>
                <li>Vložte <strong className="text-emerald-400">{window.location.hostname}</strong> (a pro Google Sites také <strong className="text-blue-400">sites.google.com</strong>).</li>
                <li>Klikněte na <strong>Add (Uložit)</strong> a vraťte se sem.</li>
              </ol>
            </div>

            <div className="pt-2 space-y-2">
              <a
                href={firebaseConsoleAuthorizedDomainsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded-xl text-xs font-bold shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 tap-active text-center"
              >
                <span>Otevřít Firebase Console (Povolené domény)</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsDomainModalOpen(false)}
                  className="w-1/3 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl text-xs font-semibold tap-active"
                >
                  Zavřít
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsDomainModalOpen(false);
                    handleGoogleLoginClick();
                  }}
                  className="w-2/3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold tap-active flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Zkusit přihlásit znovu</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
