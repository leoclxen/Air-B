# Optimalizace AirTax Praha: Čistý start, Google Sheets Multi-Tab synchronizace a dynamické OCR

Aplikace pro evidenci ubytovaných osob a automatický výpočet poplatků z pobytu v hl. m. Praze (50 Kč/noc dle zákona č. 565/1990 Sb.). Plně optimalizována pro iPhone (Safari/Chrome), Android, stolní počítače, Google Sheets a vložení do Google Sites.

## Uživatelský přehled & Klíčová rozhodnutí

> [!IMPORTANT]
> **Zapracované požadavky uživatele:**
> 1. **Žádná výchozí / hardcoded data**: Aplikace začíná v naprosto čistém stavu (0 ubytovacích míst, 0 hostů). Ubytování se vytvoří buď ručně, nebo se automaticky založí z prvního naskenovaného formuláře.
> 2. **Kamera výhradně na vyžádání (On-Demand)**: Oprávnění ke kameře se nevyžaduje při načtení aplikace. Na mobilních zařízeních (iOS/Android) se vyvolá nativní systémový dialog až po klepnutí na tlačítko "Vyfotit lístek". Na desktopu se zobrazí dialog s volbou mezi souborem a spuštěním webkamery.
> 3. **Detekce nesouladu ubytování při skenu**: Po naskenování formuláře aplikace porovná rozpoznané ubytování (název, variabilní symbol/IČO, adresa) s existujícími záznamy. Pokud nesouhlasí nebo ještě žádné neexistuje, zobrazí se dialog umožňující přiřadit záznamy k existujícímu místu nebo vytvořit nové.
> 4. **Google Sheets s více listy & automatické propojení**:
>    - Sešit: `AirTax Praha - Evidence ubytovaných`
>    - **4 dedikované listy**:
>      1. `Ubytovani` – evidence ubytovacích rezidencí, adres v Praze, správních MČ a variabilních symbolů
>      2. `Hoste` – ucelená kniha ubytovaných (jméno, pas, vízum, bydliště, příjezd, odjezd, počet nocí, osvobození, poplatek v Kč)
>      3. `Prehled_odvodu` – rekapitulace poplatků 50 Kč/noc dle městských částí Praha 1–22 s bankovními účty, VS a datovými schránkami pro snadný odvod
>      4. `Nastaveni_API` – samostatný list pro bezpečné uložení a sdílení Gemini API klíče a vybraného modelu napříč všemi vašimi zařízeními (iPhone, Android, Safari, Chrome, Google Sites)!
>    - **Uživatelsky přívětivé / automatické připojení**: Uživatel se pouze jednou přihlásí přes Google Sign-In. Aplikace automaticky prohledá jeho Google Disk a buď otevře stávající sešit `AirTax Praha - Evidence ubytovaných`, nebo jej na jedno kliknutí založí včetně všech formátů, barev a záhlaví. Pokročilý uživatel může zadat i vlastní ID sešitu.

---

## 1. Struktura Google Sheetu (4 samostatné listy)

```
┌────────────────────────────────────────────────────────────────────────┐
│  Dokument: "AirTax Praha - Evidence ubytovaných"                       │
├────────────────────────────────────────────────────────────────────────┤
│  List 1: Ubytovani                                                     │
│  [ID | Nazev_ubytovani | Hostitel | Adresa_Praha | Mestska_cast | VS]  │
├────────────────────────────────────────────────────────────────────────┤
│  List 2: Hoste                                                         │
│  [ID | Ubytovani_ID | Jednotka | Airbnb_kod | Prijmeni | Jmeno |       │
│   Datum_narozeni | Obcanstvi | Ucel_pobytu | Cislo_pasu | Cislo_viza |  │
│   Trvale_bydliste | Prijezd | Odjezd | Noci | Osvobozeni | Poplatek]   │
├────────────────────────────────────────────────────────────────────────┤
│  List 3: Prehled_odvodu                                                │
│  [Mestska_cast | Aktivni_ubytovani | Celkem_hostu | Celkem_noci |      │
│   Osvobozeno_noci | K_uhrade_CZK | Cislo_uctu_MC | VS_platby | DS]    │
├────────────────────────────────────────────────────────────────────────┤
│  List 4: Nastaveni_API                                                 │
│  [Klic_parametr | Hodnota | Popis]                                     │
│   • GEMINI_API_KEY      | AIzaSy... | API klíč pro multimodální OCR    │
│   • PREFEROVANY_MODEL   | gemini-flash-latest | Výchozí model Gemini   │
└────────────────────────────────────────────────────────────────────────┘
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
