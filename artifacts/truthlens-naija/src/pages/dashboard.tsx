import { type ReactNode, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  Link2Off,
  Loader2,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wifi,
  XCircle,
} from 'lucide-react';
import * as ApiClient from '@workspace/api-client-react';

type VerificationVerdict = 'likely_true' | 'likely_false' | 'mixed' | 'insufficient_evidence';
type VerificationSource = { provider: string; title: string; url: string | null; snippet: string; verdict: string | null };
type Verification = { id: string; content: string; verdict: VerificationVerdict; confidence: number; summary: string; sources: VerificationSource[]; aiProvider: string; createdAt: string; source: string };
type WhatsappStatus = { status: string; phone: string | null; displayName: string | null; qr: string | null; lastConnectedAt: string | null; lastError: string | null };
type ProviderHealth = { name: string; role: string; status: string; detail: string };
type DashboardSummary = { whatsapp: WhatsappStatus; totalVerifications: number; verifiedToday: number; flaggedToday: number; averageConfidence: number; providerHealth: ProviderHealth[]; recent: Verification[] };
type QueryKeyHelpers = {
  getGetDashboardSummaryQueryKey: () => readonly unknown[];
  getGetWhatsappQrQueryKey: () => readonly unknown[];
  getGetWhatsappStatusQueryKey: () => readonly unknown[];
  getListVerificationsQueryKey: (params?: { limit?: number }) => readonly unknown[];
};
const {
  getGetDashboardSummaryQueryKey,
  getGetWhatsappQrQueryKey,
  getGetWhatsappStatusQueryKey,
  getListVerificationsQueryKey,
  useCreateVerification,
  useDisconnectWhatsappSession,
  useGetDashboardSummary,
  useGetWhatsappQr,
  useGetWhatsappStatus,
  useHealthCheck,
  useListVerifications,
  useStartWhatsappSession,
} = ApiClient as typeof ApiClient & QueryKeyHelpers;

const formatDate = (value: string | null | undefined) => {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

const verdictMeta: Record<VerificationVerdict, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  likely_true: { label: 'Likely true', tone: 'success', icon: CheckCircle2 },
  likely_false: { label: 'Likely false', tone: 'danger', icon: XCircle },
  mixed: { label: 'Mixed evidence', tone: 'warning', icon: AlertCircle },
  insufficient_evidence: { label: 'Needs evidence', tone: 'neutral', icon: CircleHelp },
};

const statusLabel: Record<string, string> = {
  idle: 'Not connected',
  connecting: 'Connecting',
  qr_ready: 'QR ready',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Connection error',
};

function StatusPill({ status }: { status: string }) {
  const isGood = status === 'connected' || status === 'ready';
  const isBad = status === 'error' || status === 'missing';
  return (
    <span className={`status-pill ${isGood ? 'status-pill-good' : isBad ? 'status-pill-bad' : 'status-pill-neutral'}`}>
      <span className={`status-dot ${isGood ? 'bg-primary pulse-dot' : isBad ? 'bg-destructive' : 'bg-accent'}`} />
      {statusLabel[status] ?? status}
    </span>
  );
}

function SectionHeading({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow: string;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <div className="mono-label mb-2 text-[10px] text-muted-foreground">{eyebrow}</div>
        <h2 className="font-semibold tracking-[-0.02em] text-xl text-foreground">{title}</h2>
        {detail && <p className="mt-1 text-sm text-muted-foreground">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

function ConnectionCard({
  status,
  qr,
  onStart,
  onDisconnect,
  onRefresh,
  isStarting,
  isDisconnecting,
  isRefreshing,
}: {
  status?: WhatsappStatus;
  qr?: string | null;
  onStart: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  isStarting: boolean;
  isDisconnecting: boolean;
  isRefreshing: boolean;
}) {
  const connected = status?.status === 'connected';
  const qrVisible = status?.status === 'qr_ready' || Boolean(qr);
  const qrImage = qr && (qr.startsWith('data:') || qr.startsWith('http')) ? qr : null;

  return (
    <section className="surface-card overflow-hidden">
      <div className="border-b border-border px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="icon-well icon-well-teal"><MessageCircle size={20} strokeWidth={1.8} /></div>
            <div>
              <div className="mono-label text-[10px] text-muted-foreground">Channel 01</div>
              <h2 className="mt-1 text-lg font-semibold">WhatsApp relay</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">Monitor a dedicated number without forwarding or publishing the messages it receives.</p>
            </div>
          </div>
          <StatusPill status={status?.status ?? 'idle'} />
        </div>
      </div>
      <div className="grid gap-6 px-5 py-5 sm:px-6 lg:grid-cols-[1fr_240px]">
        <div className="flex flex-col justify-between gap-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="fact-block">
              <span className="fact-label">Identity</span>
              <span className="fact-value">{status?.displayName || 'Awaiting pairing'}</span>
              <span className="fact-note">{status?.phone || 'No phone number linked'}</span>
            </div>
            <div className="fact-block">
              <span className="fact-label">Last connected</span>
              <span className="fact-value">{formatDate(status?.lastConnectedAt)}</span>
              <span className="fact-note">Session state is checked automatically</span>
            </div>
          </div>
          {status?.lastError && (
            <div className="inline-alert inline-alert-danger">
              <AlertCircle size={16} />
              <span>{status.lastError}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <button type="button" data-testid="button-start-whatsapp" onClick={onStart} disabled={isStarting} className="button-primary">
                {isStarting ? <Loader2 className="animate-spin" size={16} /> : <Wifi size={16} />}
                {isStarting ? 'Starting session' : 'Start WhatsApp'}
              </button>
            ) : (
              <button type="button" data-testid="button-disconnect-whatsapp" onClick={onDisconnect} disabled={isDisconnecting} className="button-secondary">
                {isDisconnecting ? <Loader2 className="animate-spin" size={16} /> : <Link2Off size={16} />}
                {isDisconnecting ? 'Disconnecting' : 'Disconnect'}
              </button>
            )}
            <button type="button" data-testid="button-refresh-qr" onClick={onRefresh} disabled={isRefreshing} className="button-quiet">
              <RefreshCw className={isRefreshing ? 'animate-spin' : ''} size={15} />
              Refresh QR
            </button>
          </div>
        </div>
        <div className="qr-panel" data-testid="panel-whatsapp-qr">
          <div className="mono-label text-[9px] text-muted-foreground">{connected ? 'Session active' : 'Pairing code'}</div>
          {connected ? (
            <div className="qr-connected">
              <div className="qr-check"><Check size={25} strokeWidth={2.5} /></div>
              <span className="text-sm font-semibold">WhatsApp is linked</span>
              <span className="text-center text-xs text-muted-foreground">Incoming claims can now be verified.</span>
            </div>
          ) : qrVisible ? (
            <div className="qr-frame">
              {qrImage ? <img src={qrImage} alt="WhatsApp pairing QR code" className="h-full w-full object-contain" data-testid="img-whatsapp-qr" /> : (
                <div className="qr-placeholder" data-testid="text-qr-pending">
                  <div className="qr-faux-grid" />
                  <span>QR is ready in the relay</span>
                </div>
              )}
            </div>
          ) : (
            <div className="qr-empty">
              <Smartphone size={25} />
              <span>Start a session to generate a pairing code</span>
            </div>
          )}
          {!connected && qrVisible && <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">Open WhatsApp → Linked devices → Link a device</p>}
        </div>
      </div>
    </section>
  );
}

function MetricCard({ label, value, detail, accent }: { label: string; value: string; detail: string; accent: 'teal' | 'amber' | 'coral' | 'slate' }) {
  return (
    <div className={`metric-card metric-${accent}`} data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="fact-label">{label}</span>
        <span className="metric-mark" />
      </div>
      <strong>{value}</strong>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

function ProviderGrid({ summary }: { summary?: DashboardSummary }) {
  return (
    <section className="surface-card p-5 sm:p-6">
      <SectionHeading eyebrow="Signal integrity" title="Provider health" detail="The services supporting each verification decision." />
      {summary?.providerHealth?.length ? (
        <div className="divide-y divide-border">
          {summary.providerHealth.map((provider) => (
            <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0" key={provider.name} data-testid={`provider-${provider.name.replaceAll(' ', '-').toLowerCase()}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="provider-ledger" />
                  {provider.name}
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">{provider.role} · {provider.detail}</p>
              </div>
              <StatusPill status={provider.status} />
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state compact"><Activity size={19} /><span>Provider health will appear when the dashboard syncs.</span></div>
      )}
    </section>
  );
}

function VerificationRow({ verification, selected, onSelect }: { verification: Verification; selected: boolean; onSelect: () => void }) {
  const meta = verdictMeta[verification.verdict] ?? verdictMeta.insufficient_evidence;
  const VerdictIcon = meta.icon;
  return (
    <div className={`verification-row ${selected ? 'verification-row-selected' : ''}`} data-testid={`row-verification-${verification.id}`}>
      <button type="button" onClick={onSelect} data-testid={`button-open-verification-${verification.id}`} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <span className={`verdict-icon verdict-${meta.tone}`}><VerdictIcon size={16} /></span>
        <span className="min-w-0">
          <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{verification.content}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>{formatDate(verification.createdAt)}</span><span className="text-border">/</span><span>{verification.source === 'whatsapp' ? 'WhatsApp' : 'Manual check'}</span>
          </span>
        </span>
      </button>
      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        <span className={`confidence-chip verdict-${meta.tone}`}>{Math.round(verification.confidence * 100)}%</span>
        <ChevronDown className={`text-muted-foreground transition-transform ${selected ? 'rotate-180' : ''}`} size={15} />
      </div>
      {selected && (
        <div className="verification-detail">
          <p className="text-sm leading-relaxed text-muted-foreground">{verification.summary || 'No additional summary was provided.'}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`verdict-tag verdict-${meta.tone}`}><VerdictIcon size={14} /> {meta.label}</span>
            <span className="text-[11px] text-muted-foreground">Analysed by {verification.aiProvider}</span>
          </div>
          {verification.sources?.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="fact-label mb-2">Evidence trail</div>
              <div className="space-y-2">
                {verification.sources.slice(0, 3).map((source, index) => (
                  <a href={source.url || '#'} target={source.url ? '_blank' : undefined} rel="noreferrer" key={`${source.provider}-${index}`} data-testid={`link-source-${verification.id}-${index}`} className="source-link">
                    <span className="source-provider">{source.provider}</span>
                    <span className="min-w-0 flex-1 truncate">{source.title}</span>
                    <ExternalLink size={13} />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RecentActivity({ summary, verifications, isLoading, isError }: { summary?: DashboardSummary; verifications?: Verification[]; isLoading: boolean; isError: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = useMemo(() => {
    const source = summary?.recent?.length ? summary.recent : verifications ?? [];
    return [...source].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8);
  }, [summary?.recent, verifications]);
  return (
    <section className="surface-card p-5 sm:p-6">
      <SectionHeading
        eyebrow="Audit stream"
        title="Recent verification activity"
        detail="A compact record of what the relay has reviewed."
        action={<span className="mono-label hidden text-[9px] text-muted-foreground sm:inline">Latest 08</span>}
      />
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3, 4].map((row) => <div className="skeleton-row" key={row}><span /><div><i /><i /></div></div>)}</div>
      ) : isError ? (
        <div className="empty-state"><AlertCircle size={20} /><span>Recent activity could not be loaded.</span></div>
      ) : items.length ? (
        <div className="divide-y divide-border">
          {items.map((verification) => <VerificationRow key={verification.id} verification={verification} selected={selectedId === verification.id} onSelect={() => setSelectedId(selectedId === verification.id ? null : verification.id)} />)}
        </div>
      ) : (
        <div className="empty-state"><ClipboardCheck size={21} /><span>No claims have been verified yet. Your first check will appear here.</span></div>
      )}
    </section>
  );
}

function ManualVerifier({ onCompleted }: { onCompleted: (verification: Verification) => void }) {
  const [claim, setClaim] = useState('');
  const createVerification = useCreateVerification();
  const submit = () => {
    const content = claim.trim();
    if (!content || createVerification.isPending) return;
    createVerification.mutate({ data: { content, source: 'dashboard' } }, {
      onSuccess: (verification) => { setClaim(''); onCompleted(verification); },
    });
  };
  return (
    <section className="surface-card verifier-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="icon-well icon-well-amber"><ShieldCheck size={20} strokeWidth={1.8} /></div>
        <div>
          <div className="mono-label text-[10px] text-muted-foreground">Manual check</div>
          <h2 className="mt-1 text-lg font-semibold">Verify a claim</h2>
          <p className="mt-1 text-sm text-muted-foreground">Paste the exact wording. Context stays intact while the evidence is assembled.</p>
        </div>
      </div>
      <textarea
        value={claim}
        onChange={(event) => setClaim(event.target.value)}
        data-testid="input-manual-claim"
        placeholder="Paste a WhatsApp message or claim here…"
        className="claim-input mt-5"
        rows={5}
        maxLength={4000}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">{claim.length.toLocaleString()} / 4,000 characters</span>
        <button type="button" onClick={submit} disabled={!claim.trim() || createVerification.isPending} data-testid="button-verify-claim" className="button-primary">
          {createVerification.isPending ? <Loader2 className="animate-spin" size={16} /> : <ArrowUpRight size={16} />}
          {createVerification.isPending ? 'Checking evidence' : 'Run verification'}
        </button>
      </div>
      {createVerification.isError && <div className="inline-alert inline-alert-danger mt-4"><AlertCircle size={16} /><span>We could not verify that claim. Check the connection and try again.</span></div>}
      {createVerification.isSuccess && <div className="inline-alert inline-alert-success mt-4"><CheckCircle2 size={16} /><span>Verification complete. The result is now in the audit stream.</span></div>}
    </section>
  );
}

function DashboardSkeleton() {
  return <div className="space-y-5">{[1, 2, 3].map((item) => <div className="skeleton-block" key={item} />)}</div>;
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [connectionMessage, setConnectionMessage] = useState('');
  const { data: summary, isLoading: isSummaryLoading, isError: isSummaryError, refetch: refetchSummary } = useGetDashboardSummary();
  const { data: whatsapp, isLoading: isWhatsappLoading } = useGetWhatsappStatus({
    query: {
      queryKey: getGetWhatsappStatusQueryKey(),
      refetchInterval: 2_000,
      refetchIntervalInBackground: true,
      staleTime: 0,
    },
  });
  const { data: qr, isFetching: isQrFetching, refetch: refetchQr } = useGetWhatsappQr({
    query: {
      queryKey: getGetWhatsappQrQueryKey(),
      refetchInterval: 2_000,
      refetchIntervalInBackground: true,
      staleTime: 0,
    },
  });
  const { data: verifications, isLoading: isVerificationsLoading, isError: isVerificationsError } = useListVerifications({ limit: 8 });
  const { data: health } = useHealthCheck();
  const startSession = useStartWhatsappSession();
  const disconnectSession = useDisconnectWhatsappSession();

  const liveWhatsapp = whatsapp ?? summary?.whatsapp;
  const combinedSummary = summary;

  const handleStart = () => {
    setConnectionMessage('');
    startSession.mutate(undefined, {
      onSuccess: (next) => {
        queryClient.setQueryData(getGetWhatsappStatusQueryKey(), next);
        queryClient.setQueryData(getGetDashboardSummaryQueryKey(), (old) => old ? { ...old, whatsapp: next } : old);
        queryClient.invalidateQueries({ queryKey: getGetWhatsappQrQueryKey() });
        setConnectionMessage(next.status === 'qr_ready' ? 'Pairing code ready. Scan it with WhatsApp.' : 'WhatsApp session started.');
      },
      onError: () => setConnectionMessage('The WhatsApp session could not be started. Try again.'),
    });
  };

  const handleDisconnect = () => {
    setConnectionMessage('');
    disconnectSession.mutate(undefined, {
      onSuccess: (next) => {
        queryClient.setQueryData(getGetWhatsappStatusQueryKey(), next);
        queryClient.setQueryData(getGetDashboardSummaryQueryKey(), (old) => old ? { ...old, whatsapp: next } : old);
        queryClient.invalidateQueries({ queryKey: getGetWhatsappQrQueryKey() });
        setConnectionMessage('WhatsApp has been disconnected.');
      },
      onError: () => setConnectionMessage('The session could not be disconnected. Try again.'),
    });
  };

  const handleRefreshQr = () => {
    void refetchQr();
    void queryClient.invalidateQueries({ queryKey: getGetWhatsappStatusQueryKey() });
  };

  const handleCompleted = (verification: Verification) => {
    queryClient.setQueryData(getListVerificationsQueryKey({ limit: 8 }), (old: Verification[] | undefined) => [verification, ...(old ?? [])].slice(0, 8));
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <aside className="sidebar-shell">
        <div className="sidebar-brand">
          <div className="brand-mark"><span>TL</span></div>
          <div><div className="brand-name">TruthLens</div><div className="brand-place">Naija operations</div></div>
        </div>
        <nav className="sidebar-nav" aria-label="Primary">
          <a href="#overview" className="sidebar-item sidebar-item-active" data-testid="link-overview"><Activity size={17} /><span>Overview</span><span className="nav-live">Live</span></a>
          <a href="#verifier" className="sidebar-item" data-testid="link-manual-verifier"><ShieldCheck size={17} /><span>Manual verifier</span></a>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-rule" />
          <div className="system-status"><span className={`status-dot ${health?.status === 'ok' ? 'bg-primary pulse-dot' : 'bg-accent'}`} /><div><div className="mono-label text-[9px] text-sidebar-foreground/55">System status</div><div className="mt-1 text-xs text-sidebar-foreground/80">{health?.status === 'ok' ? 'All services nominal' : 'Checking services'}</div></div></div>
          <div className="sidebar-footnote">Built for careful context.<br />Made for the conversations that matter.</div>
        </div>
      </aside>
      <main className="main-shell cockpit-grid" id="overview">
        <header className="page-header">
          <div>
            <div className="mono-label text-[10px] text-muted-foreground">Operations cockpit / Lagos time</div>
            <h1 className="mt-2 text-[clamp(1.65rem,3vw,2.35rem)] font-semibold tracking-[-0.045em] text-foreground">Know what is circulating.</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">A measured view of WhatsApp claims, their evidence, and the systems keeping your signal clean.</p>
          </div>
          <div className="header-meta">
            <div className="header-clock"><Clock3 size={14} /> {new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date())}</div>
            <div className="header-account"><span className="account-avatar">OP</span><span className="hidden text-xs font-medium sm:inline">Operations desk</span></div>
          </div>
        </header>

        {isSummaryError && (
          <div className="error-banner animate-rise-in"><AlertCircle size={18} /><div><strong>Dashboard summary is unavailable.</strong><span>Connection controls and manual verification are still available.</span></div><button type="button" onClick={() => void refetchSummary()} data-testid="button-retry-dashboard" className="button-quiet ml-auto">Retry</button></div>
        )}
        {isSummaryLoading && !summary ? <DashboardSkeleton /> : (
          <>
            <div className="animate-rise-in">
              <ConnectionCard status={liveWhatsapp} qr={qr?.qr ?? liveWhatsapp?.qr} onStart={handleStart} onDisconnect={handleDisconnect} onRefresh={handleRefreshQr} isStarting={startSession.isPending || isWhatsappLoading} isDisconnecting={disconnectSession.isPending} isRefreshing={isQrFetching} />
              {connectionMessage && <div className={`connection-message ${connectionMessage.includes('could not') ? 'connection-message-error' : ''}`} data-testid="status-connection-message"><CheckCircle2 size={15} />{connectionMessage}</div>}
            </div>

            <section className="metric-grid animate-rise-in-delay-1" aria-label="Verification summary">
              <MetricCard label="All verifications" value={(combinedSummary?.totalVerifications ?? 0).toLocaleString()} detail="Across this workspace" accent="teal" />
              <MetricCard label="Checked today" value={(combinedSummary?.verifiedToday ?? 0).toLocaleString()} detail="Claims assessed since midnight" accent="amber" />
              <MetricCard label="Flagged today" value={(combinedSummary?.flaggedToday ?? 0).toLocaleString()} detail="Needs a closer human look" accent="coral" />
              <MetricCard label="Average confidence" value={`${Math.round((combinedSummary?.averageConfidence ?? 0) * 100)}%`} detail="Across recent decisions" accent="slate" />
            </section>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,.75fr)] animate-rise-in-delay-2">
              <RecentActivity summary={summary} verifications={verifications} isLoading={isVerificationsLoading} isError={isVerificationsError} />
              <ProviderGrid summary={summary} />
            </div>

            <div id="verifier" className="animate-rise-in-delay-3"><ManualVerifier onCompleted={handleCompleted} /></div>
          </>
        )}
        <footer className="page-footer"><span>TruthLens Naija · Signal, not noise.</span><span className="flex items-center gap-1.5"><span className="status-dot bg-primary" /> Activity is private to this workspace</span></footer>
      </main>
    </div>
  );
}