import React, { useState, useEffect, useCallback } from 'react';
import {
  KeyRound,
  Copy,
  CheckCircle,
  Zap,
  RotateCw,
  Mail,
  DollarSign,
  Gauge,
  LogOut,
  Layers,
} from 'lucide-react';
import { useUser, useClerk } from '@clerk/clerk-react';
import { useToasts } from '../components/ui/toast';
import { CountUp } from '../components/ui/CountUp';
import { decrypt } from '../lib/encryption';
import './Dashboard.css';

interface DashboardProps {
  onNavigateHome?: () => void;
  onNavigateSignIn?: () => void;
}

interface GatewayStats {
  tier?: string;
  email?: string;
  keyPrefix?: string;
  plainKey?: string;
  stats?: {
    totalRequests?: number;
    failedRequests?: number;
    totalCostUsd?: number;
    usageLeft?: number;
    maxLimit?: number;
    tokens?: {
      total?: number;
      prompt?: number;
      completion?: number;
    };
  };
}

const DEFAULT_GATEWAY_STATS: GatewayStats = {
  tier: 'PRO',
  keyPrefix: '',
  plainKey: '',
  stats: {
    totalRequests: 0,
    failedRequests: 0,
    totalCostUsd: 0,
    tokens: {
      total: 0,
      prompt: 0,
      completion: 0,
    },
  },
};

export const Dashboard: React.FC<DashboardProps> = ({ onNavigateHome }) => {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const toasts = useToasts();

  const [stats, setStats] = useState<GatewayStats>(DEFAULT_GATEWAY_STATS);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const userEmail = user?.primaryEmailAddress?.emailAddress || '';

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const queryParam = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      
      // 1. Fetch from /v1/user/me (DB + Redis authoritative endpoint)
      let res = await fetch(`/v1/user/me${queryParam}`);
      if (!res.ok) {
        res = await fetch(`/api/gateway/stats${queryParam}`);
      }

      if (res.ok) {
        const rawData = await res.json();
        if (rawData.encrypted && rawData.payload) {
          const decryptedStr = decrypt(rawData.payload);
          const data = JSON.parse(decryptedStr);
          setStats(data);
        } else if (rawData.user && rawData.database) {
          setStats({
            plainKey: rawData.user.apiKey,
            keyPrefix: rawData.user.apiKey?.slice(0, 16) || 'sk-live',
            email: rawData.user.email,
            tier: (rawData.user.tier || 'PRO').toUpperCase(),
            stats: {
              totalRequests: rawData.usage?.totalRequests || 0,
              totalCostUsd: rawData.usage?.totalCostUsd || 0,
              usageLeft: rawData.rateLimit?.remaining ?? 800,
              maxLimit: rawData.rateLimit?.limit ?? 800,
              tokens: {
                total: rawData.usage?.tokens?.total || 0,
                prompt: rawData.usage?.tokens?.prompt || 0,
                completion: rawData.usage?.tokens?.completion || 0,
              },
            },
          });
        } else if (rawData.stats) {
          setStats(rawData);
        }
      }
    } catch {
      // Retain state
    } finally {
      setLoading(false);
    }
  }, [userEmail]);

  useEffect(() => {
    if (isLoaded) {
      loadData();
    }
  }, [isLoaded, loadData]);

  const copyKey = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toasts.success('API Key Copied to Clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  // Real Server Computations
  const activeStats = stats || DEFAULT_GATEWAY_STATS;
  const tier = activeStats.tier || 'PRO';
  const maxLimit = activeStats.stats?.maxLimit ?? 800;
  const requestsMade = activeStats.stats?.totalRequests ?? 0;
  const totalTokens = activeStats.stats?.tokens?.total ?? 0;
  const totalCost = activeStats.stats?.totalCostUsd ?? 0;
  const usageLeft = activeStats.stats?.usageLeft ?? Math.max(0, maxLimit - requestsMade);
  const quotaPercentage = maxLimit > 0 ? Math.min(100, (requestsMade / maxLimit) * 100) : 0;
  const currentEmail = userEmail || activeStats.email || 'operator@intelligence.internal';
  
  const displayKey = loading && !activeStats.plainKey
    ? 'Loading API Key from DB...'
    : (activeStats.plainKey || (activeStats.keyPrefix ? `${activeStats.keyPrefix}••••••••••••••••••••` : 'sk-live-authenticating...'));

  return (
    <div className="dash-page-wrapper selection:bg-white/20">
      {/* Monochrome Background Glows & Grid */}
      <div className="dash-bg-glow-1" />
      <div className="dash-bg-glow-2" />
      <div className="dash-bg-grid" />

      <div className="dash-container">
        {/* Top Header */}
        <header className="dash-topbar">
          <div className="dash-brand-wrap">
            {onNavigateHome && (
              <button
                type="button"
                onClick={onNavigateHome}
                className="dash-back-btn"
                title="Back to Landing"
              >
                ← Back
              </button>
            )}
            <div className="dash-brand-logo">
              <span className="dash-brand-symbol">✦</span>
              <span className="dash-brand-title">INTELLIGENCE PLATFORM</span>
            </div>
            <span className="dash-badge-secure">
              <span className="dash-pulse-dot" />
              GATEWAY LIVE
            </span>
          </div>

          <div className="dash-user-controls">
            <button
              type="button"
              onClick={() => loadData()}
              className="dash-refresh-btn"
              disabled={loading}
              title="Refresh telemetry"
            >
              <RotateCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>{loading ? 'Syncing...' : 'Sync'}</span>
            </button>

            <button
              type="button"
              className="dash-settings-btn"
              onClick={() => toasts.info('Settings', 'Gateway configuration panel')}
              title="Account Settings"
            >
              Settings
            </button>

            <button
              type="button"
              onClick={() => signOut({ redirectUrl: '/' })}
              className="dash-logout-btn"
              title="Sign Out"
            >
              <LogOut size={14} />
              <span>Exit</span>
            </button>
          </div>
        </header>

        {/* Primary Operational Metric Cards (4 Cards) */}
        <section className="dash-kpi-grid">
          {/* 1. Total Tokens */}
          <div className="dash-kpi-card">
            <div className="dash-kpi-header">
              <span className="dash-kpi-label">Total Tokens</span>
              <div className="dash-kpi-icon-wrap">
                <Layers size={16} />
              </div>
            </div>
            <div>
              <div className="dash-kpi-value">
                <CountUp to={totalTokens} duration={1.0} separator="," />
              </div>
              <div className="dash-kpi-sub">
                Prompt: {(activeStats.stats?.tokens?.prompt || 0).toLocaleString()} | Output: {(activeStats.stats?.tokens?.completion || 0).toLocaleString()}
              </div>
            </div>
          </div>

          {/* 2. Total Incurred Cost */}
          <div className="dash-kpi-card">
            <div className="dash-kpi-header">
              <span className="dash-kpi-label">Total Cost</span>
              <div className="dash-kpi-icon-wrap">
                <DollarSign size={16} />
              </div>
            </div>
            <div>
              <div className="dash-kpi-value">
                ${totalCost.toFixed(4)}
              </div>
              <div className="dash-kpi-sub">Actual USD Incurred</div>
            </div>
          </div>

          {/* 3. Email */}
          <div className="dash-kpi-card">
            <div className="dash-kpi-header">
              <span className="dash-kpi-label">Email</span>
              <div className="dash-kpi-icon-wrap">
                <Mail size={16} />
              </div>
            </div>
            <div>
              <div className="dash-kpi-value email-value" title={currentEmail}>
                {currentEmail}
              </div>
              <div className="dash-kpi-sub">{tier} Tier Account</div>
            </div>
          </div>

          {/* 4. Usage Left */}
          <div className="dash-kpi-card">
            <div className="dash-kpi-header">
              <span className="dash-kpi-label">Usage Left</span>
              <div className="dash-kpi-icon-wrap">
                <Gauge size={16} />
              </div>
            </div>
            <div>
              <div className="dash-kpi-value">
                <CountUp to={usageLeft} duration={0.8} separator="," />
                <span className="dash-kpi-trend">{(100 - quotaPercentage).toFixed(1)}% free</span>
              </div>
              <div className="dash-kpi-sub">of {maxLimit} requests limit</div>
              <div className="dash-mini-progress">
                <div
                  className="dash-mini-progress-bar"
                  style={{ width: `${Math.max(4, 100 - quotaPercentage)}%` }}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Secondary Operational Deck */}
        <section className="dash-deck-grid">
          {/* Plan Quota & Usage Meter */}
          <div className="dash-deck-card">
            <div className="dash-deck-header">
              <span className="dash-deck-title">
                <Zap size={15} className="text-white" /> Plan Quota &amp; Capacity
              </span>
              <span className="dash-deck-pill">{tier} Tier Active</span>
            </div>

            <div className="dash-progress-box">
              <div className="dash-progress-labels">
                <div>
                  <span className="dash-progress-main-val">
                    <CountUp to={usageLeft} duration={1.2} />
                  </span>
                  <span className="dash-progress-sub-val"> / {maxLimit} requests remaining</span>
                </div>
                <span className="dash-kpi-trend">{(100 - quotaPercentage).toFixed(1)}% Available</span>
              </div>

              <div className="dash-main-bar-track">
                <div
                  className="dash-main-bar-fill"
                  style={{ width: `${Math.max(2, quotaPercentage)}%` }}
                />
              </div>

              <div className="dash-sub-telemetry">
                <div className="dash-sub-stat">
                  <span className="dash-sub-stat-lbl">Requests Consumed</span>
                  <span className="dash-sub-stat-val">{requestsMade.toLocaleString()}</span>
                </div>
                <div className="dash-sub-stat">
                  <span className="dash-sub-stat-lbl">Active Window</span>
                  <span className="dash-sub-stat-val">5 Hours</span>
                </div>
                <div className="dash-sub-stat">
                  <span className="dash-sub-stat-lbl">Cluster Status</span>
                  <span className="dash-sub-stat-val" style={{ color: '#ffffff' }}>Live</span>
                </div>
              </div>
            </div>
          </div>

          {/* API Bearer Credentials */}
          <div className="dash-deck-card">
            <div className="dash-deck-header">
              <span className="dash-deck-title">
                <KeyRound size={15} className="text-white" /> API Authentication
              </span>
              <span className="dash-badge-secure" style={{ padding: '2px 8px' }}>Active</span>
            </div>

            <div className="dash-key-box">
              <div className="dash-key-code-wrap">
                <span className="dash-key-code">{displayKey}</span>
                <button
                  type="button"
                  onClick={() => copyKey(activeStats.plainKey || activeStats.keyPrefix || '')}
                  className={`dash-copy-btn ${copied ? 'copied' : ''}`}
                  title={copied ? 'Copied' : 'Copy API Key'}
                  aria-label="Copy API Key"
                >
                  {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                </button>
              </div>

              <div className="dash-curl-snippet">
                <span className="dash-curl-comment"># Authenticate requests via Header</span>
                <code>curl -H &quot;Authorization: Bearer {activeStats.plainKey || 'YOUR_API_KEY'}&quot; \</code>
                <code>  https://beta.frenix.sh/v1/chat/completions</code>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Dashboard;
