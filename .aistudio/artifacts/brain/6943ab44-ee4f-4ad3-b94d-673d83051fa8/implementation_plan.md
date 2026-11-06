# Optimalizace AirTax Praha: Čistý start, Google Sheets Multi-Tab synchronizace a dynamické OCR

Aplikace pro evidenci ubytovaných osob a automatický výpočet poplatků z pobytu v hl. m. Praze (50 Kč/noc dle zákona č. 565/1990 Sb.). Plně optimalizována pro iPhone (Safari/Chrome), Android, stolní počítače, Google Sheets a vložení do Google Sites.

## Uživatelský přehled & Klíčová rozhodnutí

> [!IMPORTANT]
> **Zapracované požadavky uživatele (verze 1.0.0):**
> 1. **Výška notch 57px**: Odsazení horní lišty počítá s 57px safe area pro iPhone 12 Pro a iOS PWA, takže název AirTax, verze, sazba i ikony jsou zobrazeny ostře a bez rozmazání.
> 2. **Odstranění jména hostitele na záložce Skener**: Na záložce Skener se u ubytovacího místa zobrazuje pouze městská část, adresa a variabilní symbol.
> 3. **Individuální sazba poplatku pro každé ubytování (`Poplatek_za_noc`)**: Přidán 7. sloupec do listu `Ubytovani`. Nová i naskenovaná místa automaticky přebírají výchozí hodnotu ze záhlaví.
> 4. **Předdefinované hodnoty poplatku 50, 45, 40 Kč**: Rychlá tlačítka v dialogu nastavení sazby nabízejí hodnoty 50 Kč, 45 Kč a 40 Kč.
> 5. **Sloupec `Adresa` v listu `Ubytovani`**: Přejmenováno z `Adresa_Praha` na `Adresa` bez zachování zpětné kompatibility se starými sešity.
> 6. **List `Nastaveni`**: Ukládá konfiguraci API klíče, modelu Gemini a globální sazby poplatku.

---

## 1. Struktura Google Sheetu (4 samostatné listy)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Dokument: "AirTax Praha - Evidence ubytovaných"                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│  List 1: Ubytovani                                                              │
│  [ID | Nazev_ubytovani | Hostitel | Adresa | Mestska_cast | VS | Poplatek_za_noc│
├─────────────────────────────────────────────────────────────────────────────────┤
│  List 2: Hoste                                                                  │
│  [ID | Ubytovani_ID | Jednotka | Airbnb_kod | Prijmeni | Jmeno |                │
│   Datum_narozeni | Obcanstvi | Ucel_pobytu | Cislo_pasu | Cislo_viza |           │
│   Trvale_bydliste | Prijezd | Odjezd | Noci | Osvobozeni | Poplatek | Vytvoreno] │
├─────────────────────────────────────────────────────────────────────────────────┤
│  List 3: Prehled_odvodu                                                         │
│  [Mestska_cast | Aktivni_ubytovani | Celkem_hostu | Celkem_noci |               │
│   Osvobozeno_noci | K_uhrade_CZK | Cislo_uctu_MC | VS_platby | Datova_schranka]│
├─────────────────────────────────────────────────────────────────────────────────┤
│  List 4: Nastaveni                                                              │
│  [Klic_parametr | Hodnota | Popis]                                              │
│   • GEMINI_API_KEY      | AIzaSy... | API klíč pro multimodální OCR             │
│   • PREFEROVANY_MODEL   | gemini-flash-latest | Aktivní Gemini model             │
│   • POPLATEK_ZA_NOC     | 50        | Výchozí sazba poplatku za noc v Kč        │
└─────────────────────────────────────────────────────────────────────────────────┘
```
```

---

## 2. Doporučení pro uživatelsky přívětivé připojení

1. **Zero-Config Google Disk vyhledání (Doporučeno a implementováno)**:
   - Po kliknutí na *Google Sheet* v horní liště nebo v *Nastavení* se provede autorizace OAuth2 (rozsahy `spreadsheets` a `drive.file`).
   - Aplikace dotazem na Google Drive API zkontroluje, zda již existuje soubor `AirTax Praha - Evidence ubytovaných`.
   - Pokud ano, okamžitě se připojí a synchronizuje obousměrně.
   - Pokud ne, automaticky vytvoří nový sešit se všemi 4 listy a přehlednými záhlavími.
2. **Přímý odkaz do tabulky**:
   - V záhlaví aplikace se zobrazí aktivní odkaz `Sheet ↗`, který jedním klikem otevře sešit přímo v Google Tabulkách na iPhonu, Androidu i počítači.
3. **Možnost vlastního ID**:
   - V nastavení lze v případě potřeby vložit i libovolné ID již existujícího sdíleného sešitu.
