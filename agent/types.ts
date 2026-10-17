// Signalpost result envelope — one terminal envelope per input organisation number.

export type AvailabilityState =
  | 'available'
  | 'not_available'
  | 'blocked'
  | 'not_applicable'
  | 'ambiguous'
  | 'failed';

export const FIELD_FAMILIES = [
  'legal_identity',
  'registered_address',
  'industry',
  'employees',
  'status_flags',
  'roles',
  'locations',
  'annual_accounts',
  'official_website',
  'group_structure',
  'job_postings',
  'public_activity',
] as const;

export type FieldFamily = (typeof FIELD_FAMILIES)[number];

export interface SourceSnapshot {
  id: string;
  source: 'enhetsregisteret' | 'roller' | 'underenheter' | 'regnskapsregisteret';
  source_url: string;
  source_class: 'official_registry';
  publisher: 'Brønnøysundregistrene';
  licence: 'NLOD 2.0';
  retrieved_at: string;
  http_status: number | null;
  content_sha256: string | null;
  ok: boolean;
  error?: string;
}

export interface ReportingPeriod {
  from: string;
  to: string;
}

export interface Evidence {
  id: string;
  snapshot_id: string;
  source_url: string;
  source_class: 'official_registry';
  retrieved_at: string;
  content_sha256: string | null;
  /** JSON path inside the source response that holds the value. */
  claim_span: string;
  reporting_period: ReportingPeriod | null;
}

export type ClaimValue = string | number | boolean | Record<string, unknown>;

export interface Claim {
  id: string;
  /** Stable key used to diff refreshes, e.g. "roles#DAGL#ola nordmann". */
  key: string;
  family: FieldFamily;
  field: string;
  value: ClaimValue;
  unit?: string;
  availability: 'available';
  confidence: number;
  evidence_ids: string[];
  reporting_period: ReportingPeriod | null;
  /** Date the source attaches to the fact (registration date, role change date), when it gives one. */
  source_date: string | null;
  retrieved_at: string;
}

export interface FamilyAvailability {
  state: AvailabilityState;
  reason: string;
  checked_sources: string[];
}

export interface Change {
  type: 'new_value' | 'changed_value' | 'removed_value';
  key: string;
  family: FieldFamily;
  field: string;
  previous_value: ClaimValue | null;
  new_value: ClaimValue | null;
  previous_evidence: Evidence[];
  evidence_ids: string[];
  previous_retrieved_at: string | null;
  detected_at: string;
}

export interface SummaryStatement {
  text: string;
  evidence_ids: string[];
}

export interface Envelope {
  schema_version: 'signalpost-envelope/1';
  organisation_number: string;
  input_index: number;
  state: AvailabilityState;
  legal_identity: {
    organisation_number: string;
    legal_name: string | null;
    organisation_form: { code: string; description: string } | null;
    registry_status: 'active' | 'bankrupt' | 'under_liquidation' | 'forced_dissolution' | 'deleted' | 'unknown';
    match: { method: 'exact_organisation_number'; confidence: number };
  } | null;
  availability: Record<FieldFamily, FamilyAvailability>;
  claims: Claim[];
  evidence: Evidence[];
  source_snapshots: SourceSnapshot[];
  summary: {
    generator: 'deterministic_v1';
    text: string;
    statements: SummaryStatement[];
    unknowns: string[];
  };
  refresh: {
    baseline: 'cold_start' | 'previous_run';
    previous_run_id: string | null;
    previous_retrieved_at: string | null;
    changes: Change[];
    unchanged_claims: number;
  };
  run: {
    run_id: string;
    started_at: string;
    completed_at: string;
    terminal_status: 'completed' | 'failed';
  };
  operations: {
    requests: number;
    runtime_ms: number;
    third_party_cost_usd: number;
  };
  errors: { source: string; code: string; message: string }[];
}
