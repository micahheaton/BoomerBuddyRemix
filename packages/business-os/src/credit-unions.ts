export interface NcuaSnapshotProvenance {
  cycleDate: string;
  downloadedAt: string;
  sha256: string;
  sourceUrl: string;
}

export interface CreditUnionRecord {
  assets: number;
  charterNumber: number;
  charterState: string;
  city: string;
  deposits: number;
  fitReasons: string[];
  fitScore: number;
  internalJoinNumber: number;
  loans: number;
  lowIncomeDesignation: boolean;
  memberSegment: 'under_10k' | '10k_50k' | '50k_250k' | '250k_plus';
  members: number;
  name: string;
  ncuaRegion: string;
  peerGroup: number;
  sourceTypeCode: string;
  state: string;
  zipCode: string;
}

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function indexByHeader(header: string[]): Map<string, number> {
  return new Map(header.map((value, index) => [value.toUpperCase(), index]));
}

function requiredCell(row: string[], indexes: Map<string, number>, header: string): string {
  const index = indexes.get(header.toUpperCase());
  const value = index === undefined ? undefined : row[index];
  if (value === undefined) throw new Error(`NCUA snapshot is missing ${header}.`);
  return value.trim();
}

function numeric(value: string, header: string): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`Invalid ${header} value.`);
  return result;
}

export function scoreCreditUnion(
  members: number,
  assets: number,
): {
  fitReasons: string[];
  fitScore: number;
  memberSegment: CreditUnionRecord['memberSegment'];
} {
  let fitScore: number;
  let memberSegment: CreditUnionRecord['memberSegment'];
  const fitReasons: string[] = [];
  if (members >= 250_000) {
    memberSegment = '250k_plus';
    fitScore = 35;
    fitReasons.push('250,000 or more reported memberships.');
  } else if (members >= 50_000) {
    memberSegment = '50k_250k';
    fitScore = 30;
    fitReasons.push('50,000 to 249,999 reported memberships.');
  } else if (members >= 10_000) {
    memberSegment = '10k_50k';
    fitScore = 20;
    fitReasons.push('10,000 to 49,999 reported memberships.');
  } else {
    memberSegment = 'under_10k';
    fitScore = 10;
    fitReasons.push('Fewer than 10,000 reported memberships.');
  }
  if (assets >= 500_000_000) {
    fitScore += 20;
    fitReasons.push('$500 million or more in reported assets.');
  } else if (assets >= 100_000_000) {
    fitScore += 15;
    fitReasons.push('$100 million to $499.9 million in reported assets.');
  } else if (assets >= 10_000_000) {
    fitScore += 8;
    fitReasons.push('$10 million to $99.9 million in reported assets.');
  }
  return { fitReasons, fitScore, memberSegment };
}

export function ingestNcuaSnapshot(
  foicuText: string,
  fs220Text: string,
  expectedCycleDate: string,
): CreditUnionRecord[] {
  const foicuRows = parseCsv(foicuText);
  const fs220Rows = parseCsv(fs220Text);
  const foicuHeader = foicuRows.shift();
  const fs220Header = fs220Rows.shift();
  if (foicuHeader === undefined || fs220Header === undefined) {
    throw new Error('NCUA snapshot files must include headers.');
  }
  const foicuIndexes = indexByHeader(foicuHeader);
  const fs220Indexes = indexByHeader(fs220Header);
  const metricsByCharter = new Map<number, string[]>();
  for (const row of fs220Rows) {
    const charter = numeric(requiredCell(row, fs220Indexes, 'CU_NUMBER'), 'CU_NUMBER');
    metricsByCharter.set(charter, row);
  }

  const federallyInsuredRows = foicuRows.filter((row) => {
    const sourceTypeCode = requiredCell(row, foicuIndexes, 'CU_TYPE');
    return sourceTypeCode === '1' || sourceTypeCode === '2';
  });

  return federallyInsuredRows.map((row) => {
    const cycleDate = requiredCell(row, foicuIndexes, 'CYCLE_DATE');
    if (!cycleDate.startsWith(expectedCycleDate)) {
      throw new Error(`Unexpected NCUA cycle ${cycleDate}.`);
    }
    const charterNumber = numeric(requiredCell(row, foicuIndexes, 'CU_NUMBER'), 'CU_NUMBER');
    const metrics = metricsByCharter.get(charterNumber);
    if (metrics === undefined)
      throw new Error(`Missing FS220 metrics for charter ${charterNumber}.`);
    const metricCycle = requiredCell(metrics, fs220Indexes, 'CYCLE_DATE');
    if (!metricCycle.startsWith(expectedCycleDate)) {
      throw new Error(`Unexpected FS220 cycle ${metricCycle}.`);
    }
    const members = numeric(requiredCell(metrics, fs220Indexes, 'ACCT_083'), 'ACCT_083');
    const assets = numeric(requiredCell(metrics, fs220Indexes, 'ACCT_010'), 'ACCT_010');
    const scored = scoreCreditUnion(members, assets);
    return {
      assets,
      charterNumber,
      charterState: requiredCell(row, foicuIndexes, 'CHARTERSTATE'),
      city: requiredCell(row, foicuIndexes, 'CITY'),
      deposits: numeric(requiredCell(metrics, fs220Indexes, 'ACCT_018'), 'ACCT_018'),
      fitReasons: scored.fitReasons,
      fitScore: scored.fitScore,
      internalJoinNumber: numeric(requiredCell(row, foicuIndexes, 'JOIN_NUMBER'), 'JOIN_NUMBER'),
      loans: numeric(requiredCell(metrics, fs220Indexes, 'ACCT_025B'), 'ACCT_025B'),
      lowIncomeDesignation: requiredCell(row, foicuIndexes, 'LIMITED_INC') === '1',
      memberSegment: scored.memberSegment,
      members,
      name: requiredCell(row, foicuIndexes, 'CU_NAME'),
      ncuaRegion: requiredCell(row, foicuIndexes, 'REGION'),
      peerGroup: numeric(requiredCell(row, foicuIndexes, 'PEER_GROUP'), 'PEER_GROUP'),
      sourceTypeCode: requiredCell(row, foicuIndexes, 'CU_TYPE'),
      state: requiredCell(row, foicuIndexes, 'STATE'),
      zipCode: requiredCell(row, foicuIndexes, 'ZIP_CODE'),
    };
  });
}
