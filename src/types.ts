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

export interface PragueDistrict {
  code: string;
  name: string;
  cadastres: string;
  prefix: string;
  account: string;
  bankCode: string;
  fullAccount: string;
  datovaschranka: string;
}

export const PRAGUE_DISTRICTS: Record<string, PragueDistrict> = {
  praha1: { code: 'praha1', name: 'Městská část Praha 1', cadastres: 'Staré Město, Malá Strana, Josefov', prefix: '19', account: '2000727399', bankCode: '0800', fullAccount: '19-2000727399/0800', datovaschranka: 'b4eb2my' },
  praha2: { code: 'praha2', name: 'Městská část Praha 2', cadastres: 'Vinohrady, Vyšehrad, Nové Město', prefix: '19', account: '2000728389', bankCode: '0800', fullAccount: '19-2000728389/0800', datovaschranka: 'y7yb84k' },
  praha3: { code: 'praha3', name: 'Městská část Praha 3', cadastres: 'Žižkov, Vinohrady (P3)', prefix: '19', account: '2000729379', bankCode: '0800', fullAccount: '19-2000729379/0800', datovaschranka: 'eqkbt8g' },
  praha4: { code: 'praha4', name: 'Městská část Praha 4', cadastres: 'Nusle, Michle, Podolí, Braník', prefix: '19', account: '2000730369', bankCode: '0800', fullAccount: '19-2000730369/0800', datovaschranka: 'ergcwxe' },
  praha5: { code: 'praha5', name: 'Městská část Praha 5', cadastres: 'Smíchov, Košíře, Motol', prefix: '19', account: '2000731359', bankCode: '0800', fullAccount: '19-2000731359/0800', datovaschranka: 'yvvb2by' },
  praha6: { code: 'praha6', name: 'Městská část Praha 6', cadastres: 'Dejvice, Bubeneč, Břevnov', prefix: '19', account: '2000732349', bankCode: '0800', fullAccount: '19-2000732349/0800', datovaschranka: '542b3n7' },
  praha7: { code: 'praha7', name: 'Městská část Praha 7', cadastres: 'Holešovice, Bubeneč (P7), Troja', prefix: '19', account: '2000733339', bankCode: '0800', fullAccount: '19-2000733339/0800', datovaschranka: 'r44b2x7' },
  praha8: { code: 'praha8', name: 'Městská část Praha 8', cadastres: 'Karlín, Libeň, Kobylisy, Bohnice', prefix: '19', account: '2000734329', bankCode: '0800', fullAccount: '19-2000734329/0800', datovaschranka: 'g5wb229' },
  praha9: { code: 'praha9', name: 'Městská část Praha 9', cadastres: 'Vysočany, Prosek, Hloubětín', prefix: '19', account: '2000735319', bankCode: '0800', fullAccount: '19-2000735319/0800', datovaschranka: '247bzvx' },
  praha10: { code: 'praha10', name: 'Městská část Praha 10', cadastres: 'Vršovice, Strašnice, Malešice', prefix: '19', account: '2000736309', bankCode: '0800', fullAccount: '19-2000736309/0800', datovaschranka: 'irnb7wg' }
};

export function generateCzechIBAN(prefixStr: string, accountStr: string, bankCodeStr: string): string {
  const cleanPrefix = (prefixStr || '').replace(/\D/g, '').padStart(6, '0');
  const cleanAccount = (accountStr || '').replace(/\D/g, '').padStart(10, '0');
  const cleanBank = (bankCodeStr || '0800').replace(/\D/g, '').padStart(4, '0');
  const bban = cleanBank + cleanPrefix + cleanAccount;
  const numericStr = bban + '123500';
  const remainder = Number(BigInt(numericStr) % 97n);
  const checkDigits = String(98 - remainder).padStart(2, '0');
  return `CZ${checkDigits}${bban}`;
}
