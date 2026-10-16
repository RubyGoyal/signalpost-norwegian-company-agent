export type FactCategory =
  | 'identity'
  | 'governance'
  | 'financials'
  | 'operations'
  | 'web_presence'
  | 'recent_signals';

export type VerificationMethod =
  | 'brreg_enhetsregisteret'
  | 'brreg_roller'
  | 'brreg_regnskapsregisteret'
  | 'gemini_search_grounding';

export type EntityMatchConfidence =
  | 'exact_orgnr_match'
  | 'legal_name_and_hq_match'
  | 'verified_domain_match';

export interface VerifiedFact {
  id: string;
  category: FactCategory;
  label: string;
  value: string;
  numericValue?: number;
  unit?: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceDate: string;
  retrievedAt: string;
  verificationMethod: VerificationMethod;
  entityMatchConfidence: EntityMatchConfidence;
  explanation: string;
  isUpdatedInLatestRun?: boolean;
  previousValue?: string;
}

export interface QuarantinedClaim {
  id: string;
  claimText: string;
  candidateValue: string;
  sourceUrl: string;
  sourceDate: string;
  rejectionReason: 'wrong_company_orgnr' | 'subsidiary_ambiguity' | 'unverified_financial_figure' | 'missing_source_date';
  guardrailExplanation: string;
}

export interface ProfileDeltaChange {
  id: string;
  timestamp: string;
  fieldLabel: string;
  previousValue: string;
  newValue: string;
  sourceUrl: string;
  sourceDate: string;
  changeExplanation: string;
}

export interface CompanyProfile {
  orgnr: string;
  name: string;
  orgFormCode: string;
  orgFormDescription: string;
  status: 'Active' | 'Under Liquidation' | 'Bankruptcy';
  naceCode: string;
  naceDescription: string;
  municipality: string;
  registeredAddress: string;
  foundedDate: string;
  employeeCount: number | null;
  website?: string;
  ceoName?: string;
  chairName?: string;
  latestRevenueNok?: number | null;
  latestOperatingProfitNok?: number | null;
  latestAccountingYear?: number | null;
  lastUpdated: string;
  version: number;
  enrichmentDepth: 'registry_verified' | 'deep_grounded';
  facts: VerifiedFact[];
  quarantinedClaims: QuarantinedClaim[];
  deltaHistory: ProfileDeltaChange[];
  summaryExplanation: string;
  rubricEstimate: {
    coverage: number; // /35
    evidenceMatch: number; // /30
    updateAccuracy: number; // /20
    explanationQuality: number; // /10
    usability: number; // /5
    total: number; // /100
  };
}

export interface TelemetryBudget {
  outboundRequestsUsed: number;
  outboundRequestsLimit: number;
  externalApiCostUsd: number;
  externalApiCostLimitUsd: number;
  elapsedRuntimeMs: number;
  elapsedRuntimeLimitMs: number;
  profilesInCorpus: number;
  deepGroundedProfilesCount: number;
  quarantinedClaimsCount: number;
  wrongCompanyPublications: number;
  fabricatedFinancialsCount: number;
}

export interface BenchmarkCompanyResult {
  orgnr: string;
  name: string;
  municipality: string;
  naceCode: string;
  factsFound: number;
  evidenceMatched: number;
  quarantinedCount: number;
  updatedFields: number;
  requestsUsed: number;
  costUsd: number;
  latencyMs: number;
  score: {
    coverage: number;
    evidenceMatch: number;
    updateAccuracy: number;
    explanationQuality: number;
    usability: number;
    total: number;
  };
}

export interface DailyBenchmarkRun {
  runId: string;
  timestamp: string;
  companiesTested: number;
  qualified: boolean;
  qualificationReason: string;
  averageScore: {
    coverage: number; // /35 (min 21 to qualify)
    evidenceMatch: number; // /30
    updateAccuracy: number; // /20
    explanationQuality: number; // /10
    usability: number; // /5
    total: number; // /100 (min 65 to qualify)
  };
  budgetUsed: {
    requests: number; // /2000
    runtimeSeconds: number; // /2700 (45m)
    declaredCostUsd: number; // /$10.00
  };
  wrongCompanyPublications: number;
  fabricatedFinancials: number;
  sampleResults: BenchmarkCompanyResult[];
}

export interface SubmissionManifest {
  challengeName: string;
  submissionEmail: string;
  repositoryUrl: string;
  commitHash: string;
  oneCommandRunner: string;
  corpusCount: number;
  modelDetails: {
    primaryModel: string;
    sdk: string;
    toolsUsed: string[];
    registryEndpoints: string[];
  };
  expectedRunCosts: {
    perCompanyRegistryCostUsd: number;
    perCompanyGroundedCostUsd: number;
    daily100CompaniesCostUsd: number;
    corpus1000ProfilesCostUsd: number;
    dailyRequestBudgetUsed: number;
    dailyRuntimeMinutesEstimate: number;
  };
}

/**
 * Validates a 9-digit Norwegian Organisasjonsnummer using the official Modulo-11 algorithm.
 * Weights: [3, 2, 7, 6, 5, 4, 3, 2]
 */
export function validateNorwegianOrgNr(rawInput: string): {
  valid: boolean;
  normalized: string;
  reason?: string;
} {
  const digits = rawInput.replace(/\s+/g, '');
  if (!/^\d{9}$/.test(digits)) {
    return {
      valid: false,
      normalized: digits,
      reason: 'Organization number must be exactly 9 digits.',
    };
  }

  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += parseInt(digits[i], 10) * weights[i];
  }
  const remainder = sum % 11;
  const checkDigit = remainder === 0 ? 0 : 11 - remainder;

  if (checkDigit === 10) {
    return {
      valid: false,
      normalized: digits,
      reason: 'Invalid Modulo-11 check digit (remainder produces 10).',
    };
  }

  const actualCheck = parseInt(digits[8], 10);
  if (checkDigit !== actualCheck) {
    return {
      valid: false,
      normalized: digits,
      reason: `Modulo-11 checksum mismatch: expected trailing digit ${checkDigit}, got ${actualCheck}.`,
    };
  }

  return { valid: true, normalized: digits };
}

export const FEATURED_NORWEGIAN_COMPANIES: Array<{
  orgnr: string;
  name: string;
  sector: string;
  municipality: string;
}> = [
  { orgnr: '923609016', name: 'EQUINOR ASA', sector: 'Energy & Offshore', municipality: 'Stavanger' },
  { orgnr: '984851006', name: 'DNB BANK ASA', sector: 'Banking & Finance', municipality: 'Oslo' },
  { orgnr: '943753709', name: 'KONGSBERG GRUPPEN ASA', sector: 'Defense & Maritime Tech', municipality: 'Kongsberg' },
  { orgnr: '982463718', name: 'TELENOR ASA', sector: 'Telecommunications', municipality: 'Bærum' },
  { orgnr: '986228608', name: 'YARA INTERNATIONAL ASA', sector: 'Crop Nutrition & Ammonia', municipality: 'Oslo' },
  { orgnr: '914778271', name: 'NORSK HYDRO ASA', sector: 'Aluminium & Renewables', municipality: 'Oslo' },
  { orgnr: '989795848', name: 'AKER BP ASA', sector: 'Oil & Gas Exploration', municipality: 'Bærum' },
  { orgnr: '910747711', name: 'ORKLA ASA', sector: 'Consumer Goods & Industrials', municipality: 'Oslo' },
  { orgnr: '960514718', name: 'SALMAR ASA', sector: 'Aquaculture', municipality: 'Frøya' },
  { orgnr: '995568217', name: 'GJENSIDIGE FORSIKRING ASA', sector: 'Insurance', municipality: 'Oslo' },
];
