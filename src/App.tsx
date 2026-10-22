import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Download,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { validateOrgnr } from '../agent/orgnr.ts';
import { FIELD_FAMILIES, type Claim, type Envelope, type Evidence, type FieldFamily } from '../agent/types.ts';

// ---------------------------------------------------------------------------
// Routing (hash based: #/company/923609016, #/batch, #/compare/a,b, #/about)
// ---------------------------------------------------------------------------
type Route =
  | { view: 'home' }
  | { view: 'company'; orgnr: string }
  | { view: 'batch' }
  | { view: 'compare'; orgnrs: string[] }
  | { view: 'about' };

function parseRoute(hash: string): Route {
  const [, view, arg] = hash.replace(/^#/, '').split('/');
  if (view === 'company' && arg) return { view: 'company', orgnr: arg };
  if (view === 'batch') return { view: 'batch' };
  if (view === 'compare' && arg) return { view: 'compare', orgnrs: arg.split(',').filter(Boolean).slice(0, 3) };
  if (view === 'about') return { view: 'about' };
  return { view: 'home' };
}

const go = (hash: string) => {
  window.location.hash = hash;
};

// ---------------------------------------------------------------------------
// Labels and formatting
// ---------------------------------------------------------------------------
const FAMILY_LABELS: Record<FieldFamily, string> = {
  legal_identity: 'Legal identity',
  registered_address: 'Addresses',
  industry: 'Industry & purpose',
  employees: 'Employees',
  status_flags: 'Status',
  roles: 'People & roles',
  locations: 'Locations',
  annual_accounts: 'Annual accounts',
  official_website: 'Website',
  company_profiles: 'Company-owned profiles',
  contact_points: 'Contact points',
  group_structure: 'Group structure',
  job_postings: 'Hiring (NAV job ads)',
  public_activity: 'Public activity',
};

const FIELD_LABELS: Record<string, string> = {
  legal_name: 'Legal name',
  organisation_form: 'Organisation form',
  founded_date: 'Founded',
  registration_date: 'Registered in Enhetsregisteret',
  registered_in_business_register: 'In Foretaksregisteret',
  registered_for_vat: 'VAT registered',
  business_address: 'Business address',
  postal_address: 'Postal address',
  nace_code: 'Industry code (NACE)',
  institutional_sector: 'Institutional sector',
  statutory_purpose: 'Registered purpose',
  registered_activity: 'Registered activity',
  registered_employees: 'Registered employees',
  bankrupt: 'Bankrupt',
  under_liquidation: 'Under liquidation',
  under_forced_dissolution: 'Under forced dissolution',
  deleted_date: 'Deleted from register',
  sub_unit: 'Sub-unit',
  operating_revenue: 'Operating revenue',
  operating_expenses: 'Operating expenses',
  operating_profit: 'Operating profit',
  net_financial_items: 'Net financial items',
  profit_before_tax: 'Profit before tax',
  net_income: 'Annual result',
  total_assets: 'Total assets',
  fixed_assets: 'Fixed assets',
  current_assets: 'Current assets',
  equity: 'Equity',
  total_liabilities: 'Total liabilities',
  audited: 'Audited',
  website: 'Website',
  parent_organisation_number: 'Parent organisation',
  is_parent_company: 'Parent company',
  files_group_accounts: 'Files group accounts',
  business_register_date: 'Registered in Foretaksregisteret',
  share_capital: 'Share capital',
  former_name: 'Former name',
  latest_filed_accounts_year: 'Latest filed accounts year',
  is_group_member: 'Part of a group',
  registry_notice: 'Registry notice',
  email: 'Email',
  phone: 'Phone',
  mobile: 'Mobile',
  social_profile: 'Profile',
  job_ad: 'Job ad',
  registry_event: 'Registry event',
};

const SOURCE_LABELS: Record<string, string> = {
  enhetsregisteret: 'Enhetsregisteret',
  roller: 'Roles register',
  underenheter: 'Sub-unit register',
  regnskapsregisteret: 'Regnskapsregisteret',
  oppdateringer: 'Registry update feed',
  nav_job_feed: 'NAV job feed',
  nav_job_ad: 'NAV job ad',
  company_website: 'Company website',
};

const REASON_TEXT: Record<string, string> = {
  found_in_source: 'Found',
  not_checked_in_this_version: 'Not checked yet',
  identity_not_resolved: 'Not checked (identity not confirmed)',
  not_found_in_enhetsregisteret: 'Org. number not in registry',
  deleted_from_enhetsregisteret: 'Entity deleted',
  checked_no_active_sub_units: 'Checked: no active sub-units',
  no_active_roles_registered: 'Checked: no active roles',
  no_annual_accounts_in_regnskapsregisteret: 'Checked: no filed accounts',
  no_employee_count_registered: 'Checked: no count registered',
  no_website_registered_in_enhetsregisteret: 'Checked: none registered',
  no_group_relation_registered: 'Checked: none registered',
  no_contact_details_registered: 'Checked: none registered',
  no_registry_events_since_2025: 'Checked: no events since 2025',
  jobs_source_disabled: 'Not checked in this run',
  registered_in_enhetsregisteret: 'As registered',
  registered_and_verified_on_site: 'Registered and verified on the site',
  verified_on_site_via_registered_email_domain: 'Found via registered email, verified on the site',
  verified_on_site_via_name_domain_check: 'Found from the company name, verified on the site',
  no_verified_website_found: 'Checked: none registered or verified',
  registered_website_parked: 'Registered domain is parked',
  site_shows_several_organisation_numbers: 'Ambiguous: site lists several companies',
  website_check_incomplete: 'Website could not be checked this run',
  website_check_not_run: 'Website not checked in this run',
  robots_txt_disallows: 'Site does not allow automated access',
  linked_from_verified_website: 'Linked from its verified website',
  no_profiles_linked_from_verified_website: 'Checked: none linked from its website',
  no_verified_website: 'No verified website to read from',
};

const fmtNum = (n: number) => n.toLocaleString('en-US');
const fmtDate = (iso?: string | null) => (iso ? iso.slice(0, 10) : '—');
const fmtDateTime = (iso?: string | null) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '—');

function fieldLabel(c: Claim): string {
  if (c.field === 'role') return (c.value as any).role || (c.value as any).role_code;
  if (c.family === 'annual_accounts') {
    const type = c.key.includes('#KONSERN#') ? ' (group)' : '';
    return `${FIELD_LABELS[c.field] || c.field}${type}`;
  }
  return FIELD_LABELS[c.field] || c.field.replace(/_/g, ' ');
}

function formatValue(c: Claim): ReactNode {
  const v = c.value as any;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return c.unit && c.unit !== 'employees' ? `${c.unit} ${fmtNum(v)}` : fmtNum(v);
  if (typeof v === 'string') return v;
  if (c.field === 'website')
    return (
      <a href={v.url} target="_blank" rel="noreferrer" className="text-blue-700 underline underline-offset-2 break-all">
        {v.as_registered || v.url}
      </a>
    );
  if (c.field === 'social_profile')
    return (
      <a href={v.url} target="_blank" rel="noreferrer" className="text-blue-700 underline underline-offset-2 break-all">
        {({ linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram', x: 'X', youtube: 'YouTube', tiktok: 'TikTok' } as Record<string, string>)[v.platform] || v.platform}: {v.url.replace(/^https:\/\//, '')}
      </a>
    );
  if (c.field === 'role')
    return (
      <span>
        {v.name}
        {v.holder_type === 'organisation' && v.organisation_number ? (
          <span className="font-mono text-slate-500"> · {v.organisation_number}</span>
        ) : null}
      </span>
    );
  if (c.field === 'share_capital')
    return `${v.currency || ''} ${fmtNum(v.amount)}${v.shares ? ` · ${fmtNum(v.shares)} shares` : ''}${v.registered_date ? ` · registered ${v.registered_date}` : ''}`;
  if (c.field === 'former_name') return `${v.name}${v.from || v.to ? ` (${v.from || '?'} → ${v.to || '?'})` : ''}`;
  if (c.field === 'registry_notice') return `${v.text}${v.date ? ` (${v.date})` : ''}`;
  if (c.field === 'registry_event') return `${v.date}: ${v.event}`;
  if (c.field === 'job_ad')
    return (
      <span>
        <a href={v.nav_url} target="_blank" rel="noreferrer" className="text-blue-700 underline underline-offset-2">
          {v.title}
        </a>
        <span className="text-slate-500">
          {v.location ? ` · ${v.location}` : ''}
          {v.published ? ` · published ${v.published}` : ''}
          {v.expires ? ` · until ${v.expires}` : ''}
          {v.matched_via === 'sub_unit' && v.employer_name ? ` · via ${v.employer_name}` : ''}
        </span>
      </span>
    );
  if (c.field === 'sub_unit')
    return (
      <span>
        {v.name || v.sub_unit_organisation_number}
        {v.address?.formatted ? <span className="text-slate-500"> · {v.address.formatted}</span> : null}
        {typeof v.registered_employees === 'number' ? (
          <span className="text-slate-500"> · {fmtNum(v.registered_employees)} employees</span>
        ) : null}
      </span>
    );
  if (v.formatted) return v.formatted;
  if (v.code) return `${v.code}${v.description ? ` — ${v.description}` : ''}`;
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Small UI pieces
// ---------------------------------------------------------------------------
const STATE_STYLE: Record<string, string> = {
  available: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  not_available: 'bg-slate-100 text-slate-700 border-slate-200',
  not_applicable: 'bg-slate-100 text-slate-700 border-slate-200',
  ambiguous: 'bg-amber-50 text-amber-800 border-amber-200',
  blocked: 'bg-amber-50 text-amber-800 border-amber-200',
  failed: 'bg-red-50 text-red-800 border-red-200',
};

function StatePill({ state }: { state: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium border rounded-md ${STATE_STYLE[state] || STATE_STYLE.not_available}`}>
      {state.replace(/_/g, ' ')}
    </span>
  );
}

function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-slate-200">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {right}
      </div>
      <div className="px-4 sm:px-5 py-4">{children}</div>
    </section>
  );
}

function SourceLinks({ ids, evidence, snapshots }: { ids: string[]; evidence: Map<string, Evidence>; snapshots: Map<string, string> }) {
  const seen = new Set<string>();
  // One link per source document, even when several facts come from it.
  const evs = (ids.map((id) => evidence.get(id)).filter(Boolean) as Evidence[]).filter((e) =>
    seen.has(e.snapshot_id) ? false : (seen.add(e.snapshot_id), true)
  );
  if (!evs.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-x-2">
      {evs.map((e) => (
        <a
          key={e.id}
          href={e.source_url}
          target="_blank"
          rel="noreferrer"
          title={`${e.source_url}\nField: ${e.claim_span}\nRetrieved: ${fmtDateTime(e.retrieved_at)}`}
          className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
        >
          {SOURCE_LABELS[snapshots.get(e.snapshot_id) || ''] || 'Source'}
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      ))}
    </span>
  );
}

function OrgnrSearch({ compact = false, initial = '' }: { compact?: boolean; initial?: string }) {
  const [value, setValue] = useState(initial);
  const check = validateOrgnr(value);
  const showError = value.replace(/\s/g, '').length >= 9 && !check.valid;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (check.valid) go(`#/company/${check.normalized}`);
  };
  return (
    <form onSubmit={submit} className={compact ? 'w-full sm:w-72' : 'w-full max-w-xl'} role="search">
      <label htmlFor={compact ? 'orgnr-compact' : 'orgnr'} className="sr-only">
        Norwegian organisation number
      </label>
      <div className="flex gap-2">
        <input
          id={compact ? 'orgnr-compact' : 'orgnr'}
          inputMode="numeric"
          autoComplete="off"
          placeholder="Organisation number, e.g. 923609016"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={`flex-1 min-w-0 px-3 ${compact ? 'py-1.5 text-sm' : 'py-2.5 text-base'} font-mono bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700 ${
            showError ? 'border-red-400' : 'border-slate-300'
          }`}
        />
        <button
          type="submit"
          disabled={!check.valid}
          className={`inline-flex items-center gap-1.5 px-3 ${compact ? 'py-1.5 text-sm' : 'py-2.5'} font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:bg-slate-300 disabled:cursor-not-allowed`}
        >
          <Search className="w-4 h-4" aria-hidden="true" />
          <span className={compact ? 'sr-only' : ''}>Look up</span>
        </button>
      </div>
      {showError && !compact && <p className="mt-1.5 text-xs text-red-700">{check.reason}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Company view
// ---------------------------------------------------------------------------
function useEnvelope(orgnr: string) {
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [origin, setOrigin] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/company/${orgnr}${refresh ? '?refresh=1' : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lookup failed');
      setEnvelope(data.envelope);
      setOrigin(data.origin);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgnr]);
  return { envelope, origin, loading, error, reload: () => load(true) };
}

function CompanyView({ orgnr }: { orgnr: string }) {
  const { envelope: e, origin, loading, error, reload } = useEnvelope(orgnr);
  const [copied, setCopied] = useState(false);

  const evidence = useMemo(() => new Map((e?.evidence || []).map((x) => [x.id, x])), [e]);
  const snapshots = useMemo(() => new Map((e?.source_snapshots || []).map((s) => [s.id, s.source])), [e]);

  if (loading && !e)
    return (
      <div className="flex items-center gap-2 text-sm text-slate-600 py-16 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Checking Brønnøysundregistrene for {orgnr}…
      </div>
    );
  if (error && !e)
    return (
      <div className="max-w-xl mx-auto py-12 text-center space-y-4">
        <p className="text-sm text-red-700">{error}</p>
        <OrgnrSearch initial={orgnr} />
      </div>
    );
  if (!e) return null;

  const download = () => {
    const blob = new Blob([JSON.stringify(e, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `signalpost_${e.organisation_number}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const lastRetrieved = e.source_snapshots.map((s) => s.retrieved_at).sort().pop();

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 break-words">{e.legal_identity?.legal_name || `Org. no. ${e.organisation_number}`}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span className="font-mono text-slate-900">{e.organisation_number}</span>
            <StatePill state={e.state} />
            {e.legal_identity?.registry_status && <span>· Registry status: {e.legal_identity.registry_status.replace(/_/g, ' ')}</span>}
            <span>· {origin === 'batch' ? 'From batch run' : 'Checked live'} {fmtDateTime(lastRetrieved)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Re-check registry
          </button>
          <button
            type="button"
            onClick={download}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            <Download className="w-4 h-4" aria-hidden="true" /> JSON
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(window.location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            {copied ? <Check className="w-4 h-4" aria-hidden="true" /> : <Link2 className="w-4 h-4" aria-hidden="true" />}
            {copied ? 'Copied' : 'Link'}
          </button>
        </div>
      </div>

      {e.errors.length > 0 && (
        <div className="flex gap-2 p-3 text-sm bg-amber-50 border border-amber-200 rounded-lg text-amber-900" role="status">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            Some sources could not be read this time, so their facts are not shown:{' '}
            {e.errors.map((x) => `${SOURCE_LABELS[x.source] || x.source} (${x.code})`).join(', ')}.
          </div>
        </div>
      )}

      {/* Summary */}
      <Card title="Summary">
        <ul className="space-y-2.5">
          {e.summary.statements.map((s, i) => (
            <li key={i} className="text-sm leading-relaxed text-slate-800">
              {s.text} <SourceLinks ids={s.evidence_ids.slice(0, 3)} evidence={evidence} snapshots={snapshots} />
            </li>
          ))}
        </ul>
      </Card>

      {/* Coverage */}
      <Card title="What was found">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {FIELD_FAMILIES.map((f) => {
            const a = e.availability[f];
            return (
              <div key={f} className={`px-3 py-2 border rounded-lg ${STATE_STYLE[a.state]}`}>
                <div className="text-xs font-semibold">{FAMILY_LABELS[f]}</div>
                <div className="text-xs mt-0.5 opacity-90">
                  {a.state === 'available'
                    ? `${e.claims.filter((c) => c.family === f).length} fact${e.claims.filter((c) => c.family === f).length === 1 ? '' : 's'}`
                    : a.state === 'failed'
                    ? 'Source unavailable'
                    : REASON_TEXT[a.reason] || a.reason.replace(/_/g, ' ')}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Facts */}
      {e.claims.length > 0 && (
        <Card title={`Facts with sources (${e.claims.length})`}>
          <div className="space-y-6">
            {FIELD_FAMILIES.filter((f) => e.claims.some((c) => c.family === f)).map((f) => (
              <div key={f}>
                <h3 className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">{FAMILY_LABELS[f]}</h3>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {e.claims
                    .filter((c) => c.family === f)
                    .map((c) => (
                      <div key={c.id} className="grid gap-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:gap-4 px-3 py-2.5 text-sm">
                        <div className="text-slate-500">{fieldLabel(c)}</div>
                        <div className="text-slate-900 break-words">{formatValue(c)}</div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 sm:justify-end">
                          {c.reporting_period && (
                            <span title="Reporting period">
                              {c.reporting_period.from} → {c.reporting_period.to}
                            </span>
                          )}
                          {!c.reporting_period && c.source_date && <span title="Date given by the source">as of {c.source_date}</span>}
                          <SourceLinks ids={c.evidence_ids} evidence={evidence} snapshots={snapshots} />
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Changes */}
      <Card title="Changes since last check">
        {e.refresh.baseline === 'cold_start' ? (
          <p className="text-sm text-slate-600">First check of this company, so there is nothing earlier to compare with. Use “Re-check registry” later to see changes.</p>
        ) : e.refresh.changes.length === 0 ? (
          <p className="text-sm text-slate-600">
            No changes since {fmtDateTime(e.refresh.previous_retrieved_at)} ({e.refresh.unchanged_claims} facts re-confirmed).
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {e.refresh.changes.map((c, i) => (
              <li key={i} className="py-2.5 text-sm">
                <span className="font-medium text-slate-900">{FIELD_LABELS[c.field] || c.field.replace(/_/g, ' ')}</span>{' '}
                <span className="text-slate-500">({c.type.replace('_value', '').replace('_', ' ')})</span>
                <div className="mt-1 grid gap-1 sm:grid-cols-2 text-slate-700">
                  <div>
                    <span className="text-xs text-slate-500">Before: </span>
                    {c.previous_value === null ? '—' : formatValue({ ...(c as any), value: c.previous_value, unit: undefined })}
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Now: </span>
                    {c.new_value === null ? '—' : formatValue({ ...(c as any), value: c.new_value, unit: undefined })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Sources */}
      <Card title="Sources consulted">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1.5 pr-4 font-medium">Source</th>
                <th className="py-1.5 pr-4 font-medium">Result</th>
                <th className="py-1.5 pr-4 font-medium">Retrieved</th>
                <th className="py-1.5 font-medium">Content hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {e.source_snapshots.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 pr-4">
                    <a href={s.source_url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline inline-flex items-center gap-1">
                      {SOURCE_LABELS[s.source]} <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">{s.ok ? 'OK' : s.error || `HTTP ${s.http_status}`}</td>
                  <td className="py-2 pr-4 whitespace-nowrap font-mono text-xs">{fmtDateTime(s.retrieved_at)}</td>
                  <td className="py-2 font-mono text-xs text-slate-500">{s.content_sha256 ? s.content_sha256.slice(0, 12) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">All data from Brønnøysundregistrene open APIs (NLOD 2.0). Birth dates of role holders are not shown.</p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batch results view
// ---------------------------------------------------------------------------
interface Row {
  organisation_number: string;
  name: string | null;
  state: string;
  municipality: string | null;
  nace: string | null;
  employees: number | null;
  revenue: { value: number; unit: string | null; period_to: string | null } | null;
  ceo: string | null;
  families_available: number;
  changes: number;
}

function BatchView() {
  const [q, setQ] = useState('');
  const [state, setState] = useState('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; filtered: number; rows: Row[]; pageSize: number; corpus_file: string } | null>(null);
  const [report, setReport] = useState<any>(null);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    void fetch('/api/report')
      .then((r) => r.json())
      .then((d) => setReport(d.report));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q, state, page: String(page), pageSize: '25' });
      void fetch(`/api/corpus?${params}`)
        .then((r) => r.json())
        .then(setData);
    }, 150);
    return () => clearTimeout(t);
  }, [q, state, page]);

  const toggle = (o: string) =>
    setSelected((s) => (s.includes(o) ? s.filter((x) => x !== o) : s.length >= 3 ? s : [...s, o]));
  const pages = data ? Math.max(1, Math.ceil(data.filtered / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Batch results</h1>
          <p className="text-sm text-slate-600 mt-1">Profiles from the last batch run, plus companies looked up in this app.</p>
        </div>
        <a href="/api/corpus/export" className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 self-start">
          <Download className="w-4 h-4" aria-hidden="true" /> Download all (JSONL)
        </a>
      </div>

      {report && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            ['Companies in batch', fmtNum(report.input_count)],
            ['Results written', fmtNum(report.envelope_count)],
            ['Found', fmtNum(report.states?.available || 0)],
            ['Not found / failed', `${fmtNum(report.states?.not_available || 0)} / ${fmtNum(report.states?.failed || 0)}`],
            ['Registry requests', fmtNum(report.requests_total)],
            ['Runtime · cost', `${report.runtime_seconds}s · $${report.third_party_cost_usd}`],
          ].map(([k, v]) => (
            <div key={k} className="bg-white border border-slate-200 rounded-lg px-3 py-2">
              <div className="text-xs text-slate-500">{k}</div>
              <div className="text-sm font-semibold font-mono mt-0.5">{v}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          placeholder="Filter by name, number, municipality, industry or CEO"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="flex-1 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
          aria-label="Filter companies"
        />
        <select
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
          aria-label="Filter by result state"
        >
          <option value="all">All results</option>
          <option value="available">Found</option>
          <option value="not_available">Not available</option>
          <option value="failed">Failed</option>
        </select>
        <button
          type="button"
          disabled={selected.length < 2}
          onClick={() => go(`#/compare/${selected.join(',')}`)}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg disabled:bg-slate-300"
        >
          <ArrowLeftRight className="w-4 h-4" aria-hidden="true" /> Compare ({selected.length}/3)
        </button>
      </div>

      {data && data.total === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-6 text-sm text-slate-700 space-y-2">
          <p className="font-semibold">No batch results yet.</p>
          <p>
            Run the agent on a file of organisation numbers, then reload this page:
          </p>
          <pre className="text-xs bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto">npx tsx agent/run.ts examples/sample-orgnrs.txt out</pre>
          <p>Or look up a single company with the search box above.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 w-8"><span className="sr-only">Select to compare</span></th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium hidden md:table-cell">Municipality</th>
                <th className="px-3 py-2 font-medium hidden lg:table-cell">Industry</th>
                <th className="px-3 py-2 font-medium text-right hidden sm:table-cell">Employees</th>
                <th className="px-3 py-2 font-medium text-right hidden md:table-cell">Revenue</th>
                <th className="px-3 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.rows.map((r) => (
                <tr key={r.organisation_number} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(r.organisation_number)}
                      onChange={() => toggle(r.organisation_number)}
                      aria-label={`Select ${r.name || r.organisation_number} to compare`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <a href={`#/company/${r.organisation_number}`} className="font-medium text-blue-700 hover:underline">
                      {r.name || r.organisation_number}
                    </a>
                    <div className="text-xs text-slate-500 font-mono">{r.organisation_number}{r.ceo ? <span className="font-sans"> · CEO {r.ceo}</span> : null}</div>
                  </td>
                  <td className="px-3 py-2 hidden md:table-cell">{r.municipality || '—'}</td>
                  <td className="px-3 py-2 hidden lg:table-cell text-slate-600">{r.nace || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono hidden sm:table-cell">{r.employees === null ? '—' : fmtNum(r.employees)}</td>
                  <td className="px-3 py-2 text-right font-mono hidden md:table-cell whitespace-nowrap">
                    {r.revenue ? `${r.revenue.unit || ''} ${fmtNum(r.revenue.value)}` : '—'}
                    {r.revenue?.period_to && <div className="text-xs text-slate-500">FY to {r.revenue.period_to}</div>}
                  </td>
                  <td className="px-3 py-2"><StatePill state={r.state} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.filtered > data.pageSize && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600">
            {fmtNum(data.filtered)} companies · page {page} of {pages}
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white disabled:opacity-50">
              Previous
            </button>
            <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white disabled:opacity-50">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare view
// ---------------------------------------------------------------------------
function CompareView({ orgnrs }: { orgnrs: string[] }) {
  const [envs, setEnvs] = useState<(Envelope | null)[]>([]);
  useEffect(() => {
    void Promise.all(
      orgnrs.map((o) =>
        fetch(`/api/company/${o}`)
          .then((r) => r.json())
          .then((d) => (d.envelope as Envelope) || null)
          .catch(() => null)
      )
    ).then(setEnvs);
  }, [orgnrs.join(',')]);

  const rows: [string, (e: Envelope) => Claim | undefined][] = [
    ['Organisation form', (e) => e.claims.find((c) => c.field === 'organisation_form')],
    ['Founded', (e) => e.claims.find((c) => c.field === 'founded_date')],
    ['Business address', (e) => e.claims.find((c) => c.field === 'business_address')],
    ['Industry', (e) => e.claims.find((c) => c.field === 'nace_code' && (c.value as any).rank === 1)],
    ['Registered employees', (e) => e.claims.find((c) => c.field === 'registered_employees')],
    ['Operating revenue', (e) => e.claims.find((c) => c.field === 'operating_revenue' && c.key.includes('#SELSKAP#')) || e.claims.find((c) => c.field === 'operating_revenue')],
    ['Annual result', (e) => e.claims.find((c) => c.field === 'net_income' && c.key.includes('#SELSKAP#')) || e.claims.find((c) => c.field === 'net_income')],
    ['Equity', (e) => e.claims.find((c) => c.field === 'equity' && c.key.includes('#SELSKAP#')) || e.claims.find((c) => c.field === 'equity')],
    ['CEO', (e) => e.claims.find((c) => c.field === 'role' && (c.value as any).role_code === 'DAGL')],
    ['Board chair', (e) => e.claims.find((c) => c.field === 'role' && (c.value as any).role_code === 'LEDE')],
    ['Auditor', (e) => e.claims.find((c) => c.field === 'role' && (c.value as any).role_code === 'REVI')],
    ['Website', (e) => e.claims.find((c) => c.field === 'website')],
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Compare companies</h1>
        <a href="#/batch" className="text-sm text-blue-700 hover:underline">Back to batch results</a>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[36rem]">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2 text-xs font-medium text-slate-500 w-40">Fact</th>
              {envs.map((e, i) => (
                <th key={i} className="px-3 py-2 align-top">
                  {e ? (
                    <a href={`#/company/${e.organisation_number}`} className="font-semibold text-blue-700 hover:underline">
                      {e.legal_identity?.legal_name || e.organisation_number}
                    </a>
                  ) : (
                    orgnrs[i]
                  )}
                  <div className="text-xs font-mono font-normal text-slate-500">{orgnrs[i]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(([label, pick]) => (
              <tr key={label}>
                <td className="px-3 py-2 text-slate-500">{label}</td>
                {envs.map((e, i) => {
                  const c = e ? pick(e) : undefined;
                  const ev = c && e ? e.evidence.find((x) => x.id === c.evidence_ids[0]) : undefined;
                  return (
                    <td key={i} className="px-3 py-2 align-top">
                      {c ? (
                        <>
                          {formatValue(c)}
                          {c.reporting_period && <div className="text-xs text-slate-500">FY {c.reporting_period.from} → {c.reporting_period.to}</div>}
                          {ev && (
                            <a href={ev.source_url} target="_blank" rel="noreferrer" className="ml-1 inline-flex align-middle text-blue-700" title={ev.source_url}>
                              <ExternalLink className="w-3 h-3" aria-label="Source" />
                            </a>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">Not available</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// About view
// ---------------------------------------------------------------------------
function AboutView() {
  const [about, setAbout] = useState<any>(null);
  useEffect(() => {
    void fetch('/api/about')
      .then((r) => r.json())
      .then(setAbout);
  }, []);
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">How Signalpost works</h1>
      <Card title="What it does">
        <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-800">
          <li>Takes a Norwegian organisation number and checks its modulus-11 check digit.</li>
          <li>Reads the official Brønnøysund registers for that exact number: the entity register, roles, sub-units, filed annual accounts and the registry's dated change log. Checks NAV's job feed for active job ads.</li>
          <li>Finds the company's official website (registered website, registered email domain, or a domain spelled from its name) and publishes it only when the site proves it is the same company: its organisation number on the site, or its exact name plus the registered phone number or address.</li>
          <li>Publishes only values the registers hold. Each fact links to the source, with retrieval time and, for accounts, the reporting period.</li>
          <li>On a re-check, compares with the previous snapshot and lists real changes only, keeping the earlier evidence.</li>
        </ol>
      </Card>
      <Card title="Rules it follows">
        <ul className="list-disc pl-5 space-y-2 text-sm text-slate-800">
          <li>Every fact is matched by exact organisation number, so it cannot belong to a different company.</li>
          <li>Social profiles and contact details are taken only from the verified website, and only when the profile name matches the company or its website.</li>
          <li>Company websites are read politely: robots.txt is respected, at most a few pages per site, and private or local network addresses are never contacted.</li>
          <li>If a register cannot be reached, the result says so (“failed”) and shows nothing for it. Nothing is guessed or filled in.</li>
          <li>Missing values are never shown as zero.</li>
          <li>Birth dates of board members and managers are not published.</li>
          <li>Job ads come from NAV's public job feed (arbeidsplassen.no). An ad is shown only when its employer organisation number is the company or one of its registered sub-units, and only while it is active. Contact persons are never shown.</li>
          <li>Public activity is the registry's own dated change log (for example accounts filed, address or name changed). News and procurement are not covered yet.</li>
        </ul>
      </Card>
      <Card title="Run it yourself">
        <div className="space-y-3 text-sm">
          <pre className="text-xs bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto">{`npm ci\nnpx tsx agent/run.ts <input-file> out\n\n# or a few numbers directly\nnpx tsx agent/run.ts 923609016,984851006 out`}</pre>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
            <dt className="text-slate-500">Repository</dt>
            <dd>
              <a href={about?.repository} className="text-blue-700 hover:underline break-all" target="_blank" rel="noreferrer">
                {about?.repository || '—'}
              </a>
            </dd>
            <dt className="text-slate-500">Commit</dt>
            <dd className="font-mono text-xs break-all">
              {about?.commit?.hash || 'unknown'}
              {about?.commit?.dirty ? ' (with uncommitted changes)' : ''}
            </dd>
            <dt className="text-slate-500">AI models</dt>
            <dd>None. Only public registry and NAV job data.</dd>
            <dt className="text-slate-500">Third-party cost</dt>
            <dd>$0 per run</dd>
          </dl>
        </div>
      </Card>
      <Card title="Sources and licence">
        <ul className="space-y-1.5 text-sm">
          {(about?.sources || []).map((s: any) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                {s.name}
              </a>{' '}
              <span className="text-slate-500">· {s.licence}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Home and shell
// ---------------------------------------------------------------------------
function HomeView() {
  return (
    <div className="max-w-2xl mx-auto py-10 sm:py-16 space-y-6 text-center">
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Norwegian company facts, with the source for every one</h1>
      <p className="text-slate-600">
        Enter an organisation number. Signalpost reads the official Brønnøysund registers and shows what it found, where it came from, and what is unknown.
      </p>
      <div className="flex justify-center">
        <OrgnrSearch />
      </div>
      <p className="text-sm text-slate-500">
        Or browse the <a href="#/batch" className="text-blue-700 hover:underline">batch results</a>.
      </p>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const nav: [string, string, Route['view'][]][] = [
    ['Look up', '#/', ['home', 'company']],
    ['Batch results', '#/batch', ['batch', 'compare']],
    ['How it works', '#/about', ['about']],
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center justify-between gap-6">
            <a href="#/" className="text-lg font-bold tracking-tight font-display">
              Signalpost
            </a>
            <nav className="flex items-center gap-4 text-sm" aria-label="Main">
              {nav.map(([label, href, views]) => (
                <a
                  key={href}
                  href={href}
                  aria-current={views.includes(route.view) ? 'page' : undefined}
                  className={`py-1 border-b-2 whitespace-nowrap ${
                    views.includes(route.view) ? 'border-blue-700 text-slate-900 font-semibold' : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </a>
              ))}
            </nav>
          </div>
          {route.view !== 'home' && <OrgnrSearch compact key={route.view === 'company' ? route.orgnr : 'x'} />}
        </div>
      </header>
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {route.view === 'home' && <HomeView />}
        {route.view === 'company' && <CompanyView key={route.orgnr} orgnr={route.orgnr} />}
        {route.view === 'batch' && <BatchView />}
        {route.view === 'compare' && <CompareView orgnrs={route.orgnrs} />}
        {route.view === 'about' && <AboutView />}
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 text-xs text-slate-500">
          Data: Brønnøysundregistrene open APIs (NLOD 2.0). Signalpost publishes only what the registers hold.
        </div>
      </footer>
    </div>
  );
}
