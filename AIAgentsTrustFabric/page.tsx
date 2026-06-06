'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Shield, 
  Activity, 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  Clock, 
  UserCheck, 
  Database, 
  RefreshCw, 
  Cpu, 
  ArrowRight, 
  Check, 
  X, 
  Plus, 
  Copy, 
  Terminal, 
  ExternalLink, 
  ChevronRight, 
  Lock, 
  AlertCircle,
  Layers
} from 'lucide-react';

const BACKEND_URL = 'http://localhost:8000';

interface AuditStep {
  timestamp: string;
  message: string;
}

interface AuditRecord {
  id: string;
  agent_id: string;
  task_id: string;
  tool_name: string;
  tool_payload: any;
  steps: AuditStep[];
  decision: string;
  confidence: number;
  success: boolean;
  result: any;
  created_at: string;
  updated_at: string;
}

interface HumanApproval {
  id: string;
  audit_id: string;
  agent_id: string;
  task_id: string;
  tool_name: string;
  tool_payload: any;
  reason: string;
  confidence_score: number;
  status: string;
  created_at: string;
  workflow_id?: string;
}

interface Stats {
  total_executions: number;
  success_rate: number;
  escalation_rate: number;
  active_agents: number;
  total_failures: number;
  total_pending_approvals: number;
}

interface WorkflowStats {
  id: string;
  name: string;
  key: string;
  created_at: string;
  success_rate: number;
  failure_rate: number;
  recovery_rate: number;
  health_score: number;
  total_runs: number;
  last_active: string | null;
}

interface WorkflowDetail {
  workflow: {
    id: string;
    name: string;
    key: string;
    created_at: string;
  };
  stats: WorkflowStats;
  recent_audits: AuditRecord[];
  pending_approvals: HumanApproval[];
  learnings: string[];
}

interface SafetyPolicy {
  id: string;
  name: string;
  category: 'Privacy' | 'Integrity' | 'Access' | 'Clarity';
  description: string;
  rules: string[];
  status: 'Active' | 'Warning' | 'Disabled';
  interceptionsCount: number;
}

export default function Dashboard() {
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [operatorName, setOperatorName] = useState<string>('');
  const [operatorEmail, setOperatorEmail] = useState<string>('');
  const [sessionKey, setSessionKey] = useState<string>('');

  // Dashboard state
  const [activeTab, setActiveTab] = useState<'overview' | 'agents' | 'workflows' | 'interceptions' | 'approvals' | 'policies'>('overview');
  const [stats, setStats] = useState<Stats>({
    total_executions: 0,
    success_rate: 100,
    escalation_rate: 0,
    active_agents: 0,
    total_failures: 0,
    total_pending_approvals: 0
  });
  
  const [workflows, setWorkflows] = useState<WorkflowStats[]>([]);
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [approvals, setApprovals] = useState<HumanApproval[]>([]);
  
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [workflowDetail, setWorkflowDetail] = useState<WorkflowDetail | null>(null);
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
  
  const [editingPayloadId, setEditingPayloadId] = useState<string | null>(null);
  const [editPayloadText, setEditPayloadText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [createdWorkflow, setCreatedWorkflow] = useState<{ id: string; name: string; key: string } | null>(null);
  const [testCompleted, setTestCompleted] = useState(false);
  const [copyStatus, setCopyStatus] = useState<{[key: string]: boolean}>({});

  const [isBackendOnline, setIsBackendOnline] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Safe wrapper values for mapping/filtering to guarantee no white screens
  const safeAudits = useMemo(() => (Array.isArray(audits) ? audits : []), [audits]);
  const safeApprovals = useMemo(() => (Array.isArray(approvals) ? approvals : []), [approvals]);
  const safeWorkflows = useMemo(() => (Array.isArray(workflows) ? workflows : []), [workflows]);

  // Robust parsing and formatting of timestamps (resolves Safari/Firefox space compatibility issue)
  const formatTimestamp = (ts: string) => {
    if (!ts) return 'N/A';
    try {
      const normalized = ts.includes(' ') ? ts.replace(' ', 'T') : ts;
      const d = new Date(normalized);
      if (isNaN(d.getTime())) return ts;
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    } catch (e) {
      return ts;
    }
  };

  const formatFullDate = (ts: string) => {
    if (!ts) return 'N/A';
    try {
      const normalized = ts.includes(' ') ? ts.replace(' ', 'T') : ts;
      const d = new Date(normalized);
      if (isNaN(d.getTime())) return ts;
      return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'medium', hour12: false });
    } catch (e) {
      return ts;
    }
  };

  // Hardcoded security policies leveraging database audit/approvals arrays safely
  const safetyPolicies = useMemo<SafetyPolicy[]>(() => {
    return [
      {
        id: 'pol-pii',
        name: 'PII Protection & Token Safeguard',
        category: 'Privacy',
        description: 'Scans outbound payloads for raw credentials, auth keys, email databases, and personal information before transmission to tools.',
        rules: ['Block plain text passwords', 'Mask standard authentication tokens', 'Filter credit card formats'],
        status: 'Active',
        interceptionsCount: 0
      },
      {
        id: 'pol-dup',
        name: 'Duplicate Action Control',
        category: 'Integrity',
        description: 'Prevents loop billing and spam cycles by blocking duplicate tool calls using identical payloads within 15 seconds.',
        rules: ['Rate limit identical Slack messages', 'Throttle duplicate CRM contact insertions'],
        status: 'Active',
        interceptionsCount: safeAudits.filter(a => a.steps && Array.isArray(a.steps) && a.steps.some(s => s.message && s.message.toLowerCase().includes('duplicate'))).length
      },
      {
        id: 'pol-auth',
        name: 'Auth Expiry Self-Healer',
        category: 'Access',
        description: 'Intercepts HTTP 401/403 credential validation errors, triggers automatic OAuth token refreshes, and retries original payloads.',
        rules: ['Refresh expired access keys', 'Auto-retry failed HTTP requests on refreshed credentials'],
        status: 'Active',
        interceptionsCount: safeAudits.filter(a => a.steps && Array.isArray(a.steps) && a.steps.some(s => s.message && s.message.toLowerCase().includes('refresh'))).length
      },
      {
        id: 'pol-limit',
        name: 'Throttled Backoff Handler',
        category: 'Access',
        description: 'Automatically detects HTTP 429 rate limit exceptions, sleep-delays executions via exponential backoff, and resumes agent tasks.',
        rules: ['Hold executing threads upon rate warning', 'Calculate custom cool-off intervals'],
        status: 'Active',
        interceptionsCount: 0
      },
      {
        id: 'pol-clarity',
        name: 'Ambiguity & Completeness Gate',
        category: 'Clarity',
        description: 'Routes low-completeness payloads (missing required parameters) or high-ambiguity prompts (under 60% confidence rating) to operator review.',
        rules: ['Suspend execution on empty contact attributes', 'Hold actions on high-risk prompts'],
        status: 'Active',
        interceptionsCount: safeApprovals.length + safeAudits.filter(a => a.decision === 'ask_human').length
      }
    ];
  }, [safeAudits, safeApprovals]);

  // Auth persistence check
  useEffect(() => {
    const savedSession = localStorage.getItem('guardian_operator_session');
    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession);
        if (parsed.operatorName && parsed.sessionKey) {
          setOperatorName(parsed.operatorName);
          setOperatorEmail(parsed.operatorEmail || '');
          setSessionKey(parsed.sessionKey);
          setIsAuthenticated(true);
        }
      } catch (e) {
        localStorage.removeItem('guardian_operator_session');
      }
    }
  }, []);

  const handleSignUp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!operatorName.trim() || !sessionKey.trim()) return;
    const sessionObj = {
      operatorName,
      operatorEmail,
      sessionKey,
      timestamp: new Date().toISOString()
    };
    localStorage.setItem('guardian_operator_session', JSON.stringify(sessionObj));
    setIsAuthenticated(true);
  };

  const handleLogOut = () => {
    localStorage.removeItem('guardian_operator_session');
    setIsAuthenticated(false);
    setOperatorName('');
    setOperatorEmail('');
    setSessionKey('');
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopyStatus(prev => ({ ...prev, [id]: true }));
    setTimeout(() => {
      setCopyStatus(prev => ({ ...prev, [id]: false }));
    }, 2000);
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/stats`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        setIsBackendOnline(true);
      } else {
        setIsBackendOnline(false);
      }
    } catch (e) {
      setIsBackendOnline(false);
    }
  };

  const fetchWorkflows = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/workflows`);
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchAudits = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/audit`);
      if (res.ok) {
        const data = await res.json();
        setAudits(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchApprovals = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/runtime/approvals`);
      if (res.ok) {
        const data = await res.json();
        setApprovals(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchWorkflowDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/workflows/${id}`);
      if (res.ok) {
        const data = await res.json();
        setWorkflowDetail(data);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([fetchStats(), fetchWorkflows(), fetchAudits(), fetchApprovals()]);
    if (selectedWorkflowId) {
      await fetchWorkflowDetail(selectedWorkflowId);
    }
    setIsRefreshing(false);
  }, [selectedWorkflowId, fetchWorkflowDetail]);

  // Telemetry loop hook
  useEffect(() => {
    if (!isAuthenticated) return;
    refreshAll();
    const interval = setInterval(() => {
      fetchStats();
      fetchWorkflows();
      fetchAudits();
      fetchApprovals();
    }, 2000);
    return () => clearInterval(interval);
  }, [refreshAll, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (selectedWorkflowId) {
      fetchWorkflowDetail(selectedWorkflowId);
      const interval = setInterval(() => {
        fetchWorkflowDetail(selectedWorkflowId);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [selectedWorkflowId, fetchWorkflowDetail, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let interval: NodeJS.Timeout;
    if (showWizard && wizardStep === 4 && createdWorkflow) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`${BACKEND_URL}/workflows/${createdWorkflow.id}`);
          if (res.ok) {
            const data = await res.json();
            if (data.stats && data.stats.total_runs > 0) {
              setTestCompleted(true);
              clearInterval(interval);
            }
          }
        } catch (e) {
          console.error(e);
        }
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showWizard, wizardStep, createdWorkflow, isAuthenticated]);

  const handleRegisterWorkflow = async () => {
    if (!newWorkflowName.trim()) return;
    try {
      const res = await fetch(`${BACKEND_URL}/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newWorkflowName })
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedWorkflow(data);
        setTestCompleted(false);
        setWizardStep(2);
        fetchWorkflows();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleResolveApproval = async (id: string, action: 'approve' | 'reject') => {
    let override_payload = null;
    if (action === 'approve' && editingPayloadId === id) {
      try {
        override_payload = JSON.parse(editPayloadText);
        setJsonError(null);
      } catch (e) {
        setJsonError('Invalid JSON format. Please verify keys and values.');
        return;
      }
    }

    try {
      const res = await fetch(`${BACKEND_URL}/runtime/approvals/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, override_payload })
      });
      if (res.ok) {
        setEditingPayloadId(null);
        setEditPayloadText('');
        refreshAll();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleStartEdit = (approval: HumanApproval) => {
    setEditingPayloadId(approval.id);
    setEditPayloadText(JSON.stringify(approval.tool_payload, null, 2));
    setJsonError(null);
  };

  const selectedAudit = safeAudits.find(a => a.id === selectedAuditId) || 
                       (workflowDetail?.recent_audits.find(a => a.id === selectedAuditId));

  // Extract unique agents from audits database safely
  const uniqueAgents = useMemo(() => {
    const agentIds = Array.from(new Set(safeAudits.map(a => a.agent_id)));
    return agentIds.map(agentId => {
      const agentAudits = safeAudits.filter(a => a.agent_id === agentId);
      const lastAudit = agentAudits[0]; // Recent first
      const isWaitingApproval = safeApprovals.some(appr => appr.agent_id === agentId);
      
      let state: 'Running' | 'Waiting Approval' | 'Blocked' | 'Recovered' = 'Running';
      if (isWaitingApproval) {
        state = 'Waiting Approval';
      } else if (lastAudit) {
        if (lastAudit.decision === 'abort') {
          state = 'Blocked';
        } else if (lastAudit.decision === 'execute' && lastAudit.steps && Array.isArray(lastAudit.steps) && lastAudit.steps.some(s => s.message && (s.message.toLowerCase().includes('retry') || s.message.toLowerCase().includes('refresh') || s.message.toLowerCase().includes('recovered')))) {
          state = 'Recovered';
        }
      }

      // Calculate risk index
      const blocksCount = agentAudits.filter(a => a.decision === 'abort').length;
      const holdsCount = agentAudits.filter(a => a.decision === 'ask_human').length;
      const riskScore = Math.max(5, Math.min(98, 10 + (blocksCount * 25) + (holdsCount * 15)));

      return {
        name: agentId,
        lastTask: lastAudit ? `Executed tool: ${lastAudit.tool_name}` : 'Initializing session',
        lastDecision: lastAudit ? lastAudit.decision : 'None',
        riskScore,
        state
      };
    });
  }, [safeAudits, safeApprovals]);

  // Auth Screen (HydraDB Stark layout)
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-black text-[#F4F5F6] flex flex-col items-center justify-center p-6 grid-mesh relative select-none">
        
        {/* Subtle orange mesh glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 bg-[#FF571A]/5 blur-[120px] pointer-events-none rounded-full" />

        <div className="relative w-full max-w-md bg-[#0F1112] border border-[#1F2124] p-8 shadow-2xl transition-all duration-300">
          
          {/* Stark orange corner accents */}
          <div className="absolute top-0 left-0 w-2.5 h-2.5 border-t border-l border-orange-brand" />
          <div className="absolute top-0 right-0 w-2.5 h-2.5 border-t border-r border-orange-brand" />
          <div className="absolute bottom-0 left-0 w-2.5 h-2.5 border-b border-l border-orange-brand" />
          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 border-b border-r border-orange-brand" />

          {/* Logo */}
          <div className="flex flex-col items-center text-center gap-1.5 mb-8">
            <div className="p-2 border border-orange-brand/25 text-orange-brand rounded bg-orange-brand/5">
              <Shield className="h-5 w-5 animate-pulse" />
            </div>
            <h1 className="text-sm font-mono tracking-[0.25em] text-white font-extrabold uppercase mt-2">
              HYDRA <span className="text-orange-brand">//</span> GUARDIAN
            </h1>
            <p className="text-[9px] text-zinc-500 tracking-widest font-mono uppercase">
              AI Safety Runtime Console
            </p>
          </div>

          <form onSubmit={handleSignUp} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-mono uppercase tracking-wider text-zinc-550">
                Operator ID / Call Sign
              </label>
              <input 
                type="text"
                required
                placeholder="e.g. OPS_ALPHA"
                value={operatorName}
                onChange={(e) => setOperatorName(e.target.value.toUpperCase())}
                className="w-full text-xs font-mono bg-black text-white px-3.5 py-2.5 rounded border border-[#1F2124] focus:border-orange-brand outline-none focus:ring-0 transition-colors"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-mono uppercase tracking-wider text-zinc-550">
                Operator Email (Optional)
              </label>
              <input 
                type="email"
                placeholder="e.g. admin@company.ai"
                value={operatorEmail}
                onChange={(e) => setOperatorEmail(e.target.value)}
                className="w-full text-xs font-mono bg-black text-white px-3.5 py-2.5 rounded border border-[#1F2124] focus:border-orange-brand outline-none focus:ring-0 transition-colors"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-mono uppercase tracking-wider text-zinc-550">
                Secure Session Access Key
              </label>
              <input 
                type="password"
                required
                placeholder="••••••••••••"
                value={sessionKey}
                onChange={(e) => setSessionKey(e.target.value)}
                className="w-full text-xs font-mono bg-black text-white px-3.5 py-2.5 rounded border border-[#1F2124] focus:border-orange-brand outline-none focus:ring-0 transition-colors"
              />
            </div>

            <button 
              type="submit"
              className="w-full mt-2 py-3 bg-orange-brand hover:bg-[#E04B14] text-black font-extrabold font-mono text-[10px] uppercase tracking-widest rounded transition-all shadow-md active:scale-[0.98] cursor-pointer"
            >
              INITIALIZE OPERATOR SESSION →
            </button>
          </form>

          <div className="mt-8 border-t border-[#1F2124] pt-4 text-center">
            <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-widest">
              LOCAL-FIRST RUNTIME OBSERVED BY GUARDIAN
            </span>
          </div>

        </div>
      </div>
    );
  }

  // Dashboard Screen (Stark top header nav, geometric grid layout)
  return (
    <div className="flex flex-col min-h-screen bg-black text-[#F4F5F6] font-sans selection:bg-orange-brand/20 selection:text-white grid-mesh">
      
      {/* GLOW OVERLAYS */}
      <div className="absolute top-0 right-0 h-96 w-96 bg-orange-brand/2 blur-[130px] pointer-events-none rounded-full" />
      <div className="absolute bottom-10 left-10 h-96 w-96 bg-orange-brand/1 blur-[130px] pointer-events-none rounded-full" />

      {/* TOP HEADER NAVIGATION */}
      <header className="border-b border-[#1F2124] bg-black/85 backdrop-blur-md sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        
        {/* Brand Logo & Telemetry dot */}
        <div className="flex items-center gap-3">
          <div className="p-1.5 border border-orange-brand/20 bg-orange-brand/5 text-orange-brand rounded">
            <Shield className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold tracking-[0.15em] text-white text-xs font-mono">HYDRA // GUARDIAN</span>
              <span className="text-[7px] font-mono font-black px-1.5 py-0.2 bg-[#0F1112] text-orange-brand border border-orange-brand/20 rounded">LOCAL</span>
            </div>
            <p className="text-[8px] text-zinc-550 font-mono tracking-widest uppercase">Safety Runtime Console</p>
          </div>
        </div>

        {/* Monospaced Top Nav Links */}
        <nav className="hidden lg:flex items-center gap-1.5 font-mono text-[10px] uppercase font-bold">
          <button
            onClick={() => { setActiveTab('overview'); setSelectedWorkflowId(null); }}
            className={`px-3 py-1.5 rounded transition-all cursor-pointer ${
              activeTab === 'overview' && !selectedWorkflowId
                ? 'text-orange-brand border border-orange-brand/25 bg-orange-brand/5'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#0F1112]'
            }`}
          >
            01 // Overview
          </button>
          
          <button
            onClick={() => { setActiveTab('agents'); setSelectedWorkflowId(null); }}
            className={`px-3 py-1.5 rounded transition-all cursor-pointer ${
              activeTab === 'agents'
                ? 'text-orange-brand border border-orange-brand/25 bg-orange-brand/5'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#0F1112]'
            }`}
          >
            02 // Agents
          </button>

          <button
            onClick={() => { setActiveTab('workflows'); setSelectedWorkflowId(null); }}
            className={`px-3 py-1.5 rounded transition-all cursor-pointer ${
              activeTab === 'workflows' || selectedWorkflowId
                ? 'text-orange-brand border border-orange-brand/25 bg-orange-brand/5'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#0F1112]'
            }`}
          >
            03 // Workflows
          </button>

          <button
            onClick={() => { setActiveTab('interceptions'); setSelectedWorkflowId(null); }}
            className={`px-3 py-1.5 rounded transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'interceptions'
                ? 'text-orange-brand border border-orange-brand/25 bg-orange-brand/5'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#0F1112]'
            }`}
          >
            04 // Interceptions
            {safeAudits.filter(a => a.decision !== 'execute').length > 0 && (
              <span className="px-1.5 py-0.1 text-[8px] bg-orange-brand/10 text-orange-brand border border-orange-brand/25 rounded">
                {safeAudits.filter(a => a.decision !== 'execute').length}
              </span>
            )}
          </button>

          <button
            onClick={() => { setActiveTab('approvals'); setSelectedWorkflowId(null); }}
            className={`px-3 py-1.5 rounded transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'approvals'
                ? 'text-orange-brand border border-orange-brand/25 bg-orange-brand/5'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#0F1112]'
            }`}
          >
            05 // Approvals
            {safeApprovals.length > 0 && (
              <span className="px-1.5 py-0.1 text-[8px] bg-orange-brand text-black rounded font-black animate-pulse">
                {safeApprovals.length}
              </span>
            )}
          </button>

          <button
            onClick={() => { setActiveTab('policies'); setSelectedWorkflowId(null); }}
            className={`px-3 py-1.5 rounded transition-all cursor-pointer ${
              activeTab === 'policies'
                ? 'text-orange-brand border border-orange-brand/25 bg-orange-brand/5'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#0F1112]'
            }`}
          >
            06 // Policies
          </button>
        </nav>

        {/* System telemetry & log out */}
        <div className="flex items-center gap-4 text-[9px] font-mono">
          <div className="hidden sm:flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${isBackendOnline ? 'bg-orange-brand animate-pulse' : 'bg-red-500'}`} />
            <span className="text-zinc-400">STATUS: <span className="text-white font-bold">{isBackendOnline ? 'ACTIVE' : 'OFFLINE'}</span></span>
          </div>

          <span className="text-zinc-550 border-l border-[#1F2124] pl-4 hidden md:inline">
            OPERATOR: <span className="text-white font-bold">{operatorName}</span>
          </span>

          <button 
            onClick={handleLogOut}
            className="text-zinc-400 hover:text-orange-brand border border-transparent hover:border-[#1F2124] px-2 py-1 transition-all rounded uppercase cursor-pointer"
          >
            [Log_Out]
          </button>
        </div>

      </header>

      {/* SUB-HEADER COMPACT NAV FOR MOBILE VIEWPORT */}
      <div className="lg:hidden flex overflow-x-auto border-b border-[#1F2124] bg-[#0F1112]/50 px-4 py-2 gap-1 font-mono text-[9px] uppercase font-bold">
        <button 
          onClick={() => { setActiveTab('overview'); setSelectedWorkflowId(null); }}
          className={`px-2.5 py-1 rounded whitespace-nowrap ${activeTab === 'overview' ? 'text-orange-brand' : 'text-zinc-400'}`}
        >
          01 // Overview
        </button>
        <button 
          onClick={() => { setActiveTab('agents'); setSelectedWorkflowId(null); }}
          className={`px-2.5 py-1 rounded whitespace-nowrap ${activeTab === 'agents' ? 'text-orange-brand' : 'text-zinc-400'}`}
        >
          02 // Agents
        </button>
        <button 
          onClick={() => { setActiveTab('workflows'); setSelectedWorkflowId(null); }}
          className={`px-2.5 py-1 rounded whitespace-nowrap ${activeTab === 'workflows' || selectedWorkflowId ? 'text-orange-brand' : 'text-zinc-400'}`}
        >
          03 // Workflows
        </button>
        <button 
          onClick={() => { setActiveTab('interceptions'); setSelectedWorkflowId(null); }}
          className={`px-2.5 py-1 rounded whitespace-nowrap ${activeTab === 'interceptions' ? 'text-orange-brand' : 'text-zinc-400'}`}
        >
          04 // Interceptions ({safeAudits.filter(a => a.decision !== 'execute').length})
        </button>
        <button 
          onClick={() => { setActiveTab('approvals'); setSelectedWorkflowId(null); }}
          className={`px-2.5 py-1 rounded whitespace-nowrap ${activeTab === 'approvals' ? 'text-orange-brand' : 'text-zinc-400'}`}
        >
          05 // Approvals ({safeApprovals.length})
        </button>
        <button 
          onClick={() => { setActiveTab('policies'); setSelectedWorkflowId(null); }}
          className={`px-2.5 py-1 rounded whitespace-nowrap ${activeTab === 'policies' ? 'text-orange-brand' : 'text-zinc-400'}`}
        >
          06 // Policies
        </button>
      </div>

      {/* CORE WORKSPACE / CONTENT AREA */}
      <main className="flex-1 flex flex-col relative w-full max-w-7xl mx-auto px-4 md:px-8 py-6">
        
        {/* REFRESH BAR */}
        <div className="flex items-center justify-between mb-6 border-b border-[#1F2124] pb-4">
          <div className="min-w-0">
            {selectedWorkflowId && workflowDetail ? (
              <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono uppercase">
                <button onClick={() => setSelectedWorkflowId(null)} className="hover:text-zinc-300">WORKFLOWS</button>
                <ChevronRight className="h-3 w-3 text-zinc-650" />
                <span className="text-white truncate">{workflowDetail.workflow.name}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono uppercase tracking-wider">
                <span>CONSOLE</span>
                <ChevronRight className="h-3 w-3" />
                <span className="text-white font-bold">{activeTab}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => { setShowWizard(true); setWizardStep(1); }}
              className="py-1.5 px-3 bg-black hover:bg-[#0F1112] text-orange-brand border border-orange-brand/20 hover:border-orange-brand/40 font-mono font-bold text-[9px] uppercase tracking-wider rounded flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Plus className="h-3 w-3" /> Connect Workflow
            </button>

            <button 
              onClick={refreshAll} 
              disabled={isRefreshing}
              className="p-1.5 text-zinc-400 hover:text-white rounded bg-[#0F1112] border border-[#1F2124] transition-all cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* CONNECTION WIZARD MODAL */}
        {showWizard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-4">
            <div className="w-full max-w-lg bg-[#0F1112] border border-[#1F2124] rounded overflow-hidden shadow-2xl flex flex-col relative animate-in fade-in zoom-in-95 duration-100">
              
              <button 
                onClick={() => { setShowWizard(false); setWizardStep(1); }} 
                className="absolute right-4 top-4 p-1 rounded hover:bg-black text-zinc-400 hover:text-white transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
              
              <div className="flex items-center border-b border-[#1F2124] px-6 py-4 bg-black">
                <Shield className="h-4 w-4 text-orange-brand mr-2" />
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-white">INTERCEPTION NODE CONFIGURATION</span>
                <span className="ml-auto text-[8px] font-mono text-zinc-500 font-bold uppercase">STEP {wizardStep} OF 4</span>
              </div>

              {/* Step 1 */}
              {wizardStep === 1 && (
                <div className="p-6 flex flex-col gap-4">
                  <div>
                    <h3 className="text-xs font-mono font-bold text-white uppercase mb-1">Set Channel Identifier</h3>
                    <p className="text-[10px] text-zinc-400 font-mono leading-relaxed">Map a new workspace pipeline for Guardian policy scans.</p>
                  </div>
                  <input
                    type="text"
                    placeholder="e.g. Sales Pipeline Audit"
                    value={newWorkflowName}
                    onChange={(e) => setNewWorkflowName(e.target.value)}
                    className="w-full text-xs bg-black text-white px-4 py-2.5 rounded border border-[#1F2124] focus:border-orange-brand outline-none focus:ring-0 font-mono"
                    autoFocus
                  />
                  <button
                    onClick={handleRegisterWorkflow}
                    disabled={!newWorkflowName.trim()}
                    className="w-full mt-2 py-2.5 bg-orange-brand hover:bg-[#E04B14] disabled:opacity-40 text-black font-mono font-bold text-[9px] uppercase tracking-wider rounded flex items-center justify-center gap-1 cursor-pointer transition-all"
                  >
                    Generate Credentials <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Step 2 */}
              {wizardStep === 2 && createdWorkflow && (
                <div className="p-6 flex flex-col gap-4">
                  <div className="text-center py-2">
                    <h3 className="text-xs font-mono font-bold text-white uppercase mb-1">Access Token Configured</h3>
                    <p className="text-[9px] text-orange-brand font-mono uppercase tracking-wide">Key Generated Successfully</p>
                  </div>

                  <div className="bg-black border border-[#1F2124] rounded p-3 flex items-center justify-between gap-3 shadow-inner">
                    <span className="text-xs font-mono text-zinc-300 select-all overflow-hidden text-ellipsis whitespace-nowrap">{createdWorkflow.key}</span>
                    <button
                      onClick={() => handleCopy(createdWorkflow.key, 'wizard_key')}
                      className="p-1.5 rounded hover:bg-[#0F1112] text-zinc-450 hover:text-white transition-all cursor-pointer"
                    >
                      {copyStatus['wizard_key'] ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>

                  <button
                    onClick={() => setWizardStep(3)}
                    className="w-full py-2.5 bg-orange-brand hover:bg-[#E04B14] text-black font-mono font-bold text-[9px] uppercase tracking-wider rounded flex items-center justify-center gap-1 cursor-pointer transition-all"
                  >
                    Setup n8n Node <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Step 3 */}
              {wizardStep === 3 && createdWorkflow && (
                <div className="p-6 flex flex-col gap-4 overflow-y-auto max-h-[420px]">
                  <div>
                    <h3 className="text-xs font-mono font-bold text-white uppercase mb-1">HTTP Proxy Redirect</h3>
                    <p className="text-[10px] text-zinc-455 font-mono leading-relaxed">Route tool commands in n8n to the safety runtime.</p>
                  </div>

                  <div className="flex flex-col gap-3">
                    <div>
                      <span className="text-[8px] text-zinc-500 font-mono font-bold uppercase tracking-wider block mb-1">Endpoint URL</span>
                      <div className="bg-black border border-[#1F2124] rounded p-2 flex items-center justify-between gap-3 text-[10px] font-mono">
                        <span className="text-zinc-300 truncate select-all">{`${BACKEND_URL}/runtime/execute`}</span>
                        <button
                          onClick={() => handleCopy(`${BACKEND_URL}/runtime/execute`, 'wizard_endpoint')}
                          className="p-1 rounded hover:bg-[#0F1112] text-zinc-500 hover:text-white transition-all cursor-pointer"
                        >
                          {copyStatus['wizard_endpoint'] ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <span className="text-[8px] text-zinc-500 font-mono font-bold uppercase tracking-wider block mb-1">Header (X-API-Key)</span>
                      <div className="bg-black border border-[#1F2124] rounded p-2 flex items-center justify-between gap-3 text-[10px] font-mono">
                        <span className="text-zinc-300 truncate select-all">{createdWorkflow.key}</span>
                        <button
                          onClick={() => handleCopy(createdWorkflow.key, 'wizard_key_step3')}
                          className="p-1 rounded hover:bg-[#0F1112] text-zinc-500 hover:text-white transition-all cursor-pointer"
                        >
                          {copyStatus['wizard_key_step3'] ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <span className="text-[8px] text-zinc-550 font-mono font-bold uppercase block mb-1">Testing cURL payload</span>
                    <div className="bg-black border border-[#1F2124] rounded p-3 relative">
                      <pre className="text-[8px] font-mono text-zinc-400 overflow-x-auto select-all leading-relaxed pr-6 max-h-[140px]">
{`curl -X POST ${BACKEND_URL}/runtime/execute \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${createdWorkflow.key}" \\
  -d '{"agent_id": "test-agent", "task_id": "test-task", "tool_name": "slack_send_message", "tool_payload": {"channel": "#general", "message": "Verify Setup"}}'`}
                      </pre>
                      <button
                        onClick={() => handleCopy(
                          `curl -X POST ${BACKEND_URL}/runtime/execute -H "Content-Type: application/json" -H "X-API-Key: ${createdWorkflow.key}" -d '{"agent_id": "test-agent", "task_id": "test-task", "tool_name": "slack_send_message", "tool_payload": {"channel": "#general", "message": "Verify Setup"}}'`,
                          'wizard_curl'
                        )}
                        className="absolute right-2.5 top-3.5 p-1 rounded hover:bg-[#0F1112] text-zinc-500 hover:text-white transition-all cursor-pointer"
                      >
                        {copyStatus['wizard_curl'] ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={() => setWizardStep(4)}
                    className="w-full py-2.5 bg-orange-brand hover:bg-[#E04B14] text-black font-mono font-bold text-[9px] uppercase tracking-wider rounded flex items-center justify-center gap-1 cursor-pointer transition-all"
                  >
                    Verify Setup <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Step 4 */}
              {wizardStep === 4 && createdWorkflow && (
                <div className="p-6 flex flex-col gap-4">
                  {!testCompleted ? (
                    <div className="text-center py-6 flex flex-col items-center">
                      <div className="relative mb-5 flex items-center justify-center h-14 w-14">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-orange-brand/10 opacity-75 animate-ping" />
                        <div className="relative h-10 w-10 bg-orange-brand/15 text-orange-brand rounded-full flex items-center justify-center border border-orange-brand/20">
                          <Activity className="h-4 w-4 animate-pulse" />
                        </div>
                      </div>
                      <h3 className="text-xs font-mono font-bold text-white uppercase mb-1">Awaiting Telemetry Packet...</h3>
                      <p className="text-[10px] text-zinc-400 font-mono leading-relaxed max-w-xs">Run the cURL test or trigger your n8n workflow. The console will automatically lock the connection.</p>
                    </div>
                  ) : (
                    <div className="text-center py-6 flex flex-col items-center animate-in fade-in zoom-in-95">
                      <div className="h-10 w-10 bg-emerald-500/10 text-emerald-450 rounded-full flex items-center justify-center mb-4 border border-emerald-500/20 shadow-md">
                        <CheckCircle className="h-5 w-5" />
                      </div>
                      <h3 className="text-xs font-mono font-bold text-white uppercase mb-1">Verification Packet Locked</h3>
                      <p className="text-[9px] text-emerald-400 font-mono uppercase">Channel Status: Protected</p>
                      <p className="text-[10px] text-zinc-400 mt-2 max-w-xs font-mono">First event verified. The workflow proxy is live.</p>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setShowWizard(false);
                      setWizardStep(1);
                      setActiveTab('workflows');
                      setSelectedWorkflowId(createdWorkflow.id);
                    }}
                    disabled={!testCompleted}
                    className="w-full py-2.5 bg-orange-brand hover:bg-[#E04B14] disabled:opacity-40 text-black font-mono font-bold text-[9px] uppercase tracking-wider rounded flex items-center justify-center gap-1 cursor-pointer transition-all"
                  >
                    Open Workflow Space <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

            </div>
          </div>
        )}

        {/* EMPTY STATE RUNTIME VISUALIZATION */}
        {safeWorkflows.length === 0 && !showWizard && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-xl mx-auto border border-[#1F2124] bg-[#0F1112] rounded p-12 relative my-16 shadow-2xl">
            {/* Corner accents */}
            <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-orange-brand" />
            <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-orange-brand" />
            <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-orange-brand" />
            <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-orange-brand" />

            <div className="relative mb-8 flex items-center justify-center h-24 w-24">
              <span className="absolute inline-flex h-full w-full rounded-full bg-orange-brand/5 opacity-50 animate-ping duration-3000" />
              <div className="relative h-12 w-12 bg-black border border-orange-brand/20 text-orange-brand rounded flex items-center justify-center shadow-lg">
                <Shield className="h-6 w-6" />
              </div>
            </div>
            
            <h1 className="text-xs font-mono font-bold text-white tracking-[0.2em] mb-2 uppercase">GUARDIAN INTERPOSE LAYER</h1>
            <p className="text-[10px] text-zinc-400 leading-relaxed mb-6 font-mono max-w-sm">
              Waiting for agent activity. Route your n8n HTTP requests through the Guardian endpoint to activate real-time policy evaluation.
            </p>

            <button
              onClick={() => { setShowWizard(true); setWizardStep(1); }}
              className="py-2.5 px-4 bg-orange-brand hover:bg-[#E04B14] text-black font-mono font-bold text-[9px] uppercase tracking-wider rounded flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md"
            >
              <Plus className="h-3.5 w-3.5" /> Register first workflow
            </button>
          </div>
        )}

        {/* TAB 1: OVERVIEW (MISSION CONTROL LAYOUT) */}
        {safeWorkflows.length > 0 && activeTab === 'overview' && !selectedWorkflowId && (
          <div className="flex-1 flex flex-col gap-6 animate-in fade-in duration-200">
            
            {/* Double column metrics & notification banner */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              
              {/* Giant monospaced metrics */}
              <div className="bg-[#0F1112] border border-[#1F2124] p-4 flex flex-col justify-between h-24 relative">
                <span className="text-[8px] font-mono text-zinc-550 uppercase font-bold">Total_Interceptions //</span>
                <span className="text-2xl font-mono text-white font-extrabold tracking-tight">
                  {String(stats.total_executions).padStart(3, '0')}
                </span>
              </div>

              <div className="bg-[#0F1112] border border-[#1F2124] p-4 flex flex-col justify-between h-24 relative">
                <span className="text-[8px] font-mono text-zinc-550 uppercase font-bold">Safety_Integrity_Rate //</span>
                <span className="text-2xl font-mono text-orange-brand font-extrabold tracking-tight">
                  {stats.success_rate.toFixed(1)}%
                </span>
              </div>

              <div className="bg-[#0F1112] border border-[#1F2124] p-4 flex flex-col justify-between h-24 relative">
                <span className="text-[8px] font-mono text-zinc-550 uppercase font-bold">Pending_Holds //</span>
                <span className={`text-2xl font-mono font-extrabold tracking-tight ${safeApprovals.length > 0 ? 'text-orange-brand' : 'text-zinc-600'}`}>
                  {String(safeApprovals.length).padStart(2, '0')}
                </span>
              </div>

              <div className="bg-[#0F1112] border border-[#1F2124] p-4 flex flex-col justify-between h-24 relative">
                <span className="text-[8px] font-mono text-zinc-550 uppercase font-bold">Monitored_Agents //</span>
                <span className="text-2xl font-mono text-white font-extrabold tracking-tight">
                  {String(uniqueAgents.length).padStart(2, '0')}
                </span>
              </div>

            </div>

            {/* Pending Approvals Notification Banner */}
            {safeApprovals.length > 0 && (
              <div className="bg-orange-brand/5 border border-orange-brand/20 text-orange-brand text-xs px-5 py-4 rounded flex items-center justify-between shadow-inner">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-brand opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-brand" />
                  </span>
                  <p className="font-mono font-bold uppercase tracking-wider text-[9px] text-white">
                    SECURE INTERVENTION DETECTED: {safeApprovals.length} ACTION{safeApprovals.length > 1 ? 'S' : ''} HELD FOR OPERATOR OVERRIDE
                  </p>
                </div>
                <button 
                  onClick={() => setActiveTab('approvals')} 
                  className="px-3 py-1.5 bg-orange-brand text-black border border-orange-brand rounded font-mono font-bold text-[8px] uppercase tracking-widest hover:bg-[#E04B14] transition-all cursor-pointer"
                >
                  Resolve held queue →
                </button>
              </div>
            )}

            {/* Centerpiece Real-Time Activity Stream / Visual Timeline */}
            <section className="bg-[#0F1112] border border-[#1F2124] rounded p-6 shadow-xl flex flex-col gap-6 relative">
              
              {/* Corner accents */}
              <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-orange-brand/40" />
              <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-orange-brand/40" />
              <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-orange-brand/40" />
              <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-orange-brand/40" />

              <div className="border-b border-[#1F2124] pb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-orange-brand" />
                  <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-white">LIVE INTERCEPTION RUNTIME TELEMETRY</h3>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[9px] text-zinc-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-brand animate-pulse" />
                  <span>STREAM ACTIVE</span>
                </div>
              </div>

              {/* Timeline Trees */}
              <div className="flex flex-col gap-6">
                {safeAudits.length === 0 ? (
                  <div className="py-10 text-center text-zinc-650 font-mono text-[10px] uppercase">
                    No active agent tool pipelines captured.
                  </div>
                ) : (
                  safeAudits.slice(0, 10).map((audit) => {
                    const isGreen = audit.success;
                    const isAmber = audit.decision === 'ask_human';
                    const isRed = audit.decision === 'abort';
                    
                    let borderCol = 'border-orange-brand/20';
                    let dotCol = 'bg-orange-brand';
                    let statusLabel = 'POLICY SCANS COMPLETE';
                    let decisionLabel = 'EXECUTION SUCCESS';
                    
                    if (isAmber) {
                      borderCol = 'border-orange-brand/35';
                      dotCol = 'bg-orange-brand animate-pulse';
                      statusLabel = 'PII PROTECTION SHIELD TRIGGERED';
                      decisionLabel = 'SUSPENDED: OPERATOR APPROVAL REQUIRED';
                    } else if (isRed) {
                      borderCol = 'border-red-500/35';
                      dotCol = 'bg-red-500';
                      statusLabel = 'SECURITY BLOCKS RULE TRIGGERED';
                      decisionLabel = 'CRITICAL: BLOCK & TERMINATE';
                    } else if (isGreen && audit.steps && Array.isArray(audit.steps) && audit.steps.some(s => s.message && s.message.toLowerCase().includes('retry'))) {
                      borderCol = 'border-emerald-500/35';
                      dotCol = 'bg-emerald-500';
                      statusLabel = 'FAILURE DETECTED: AUTO RECOVERY ACTIVE';
                      decisionLabel = 'SUCCESS WITH RECOVERY RETRY';
                    }

                    const isSelected = selectedAuditId === audit.id;

                    return (
                      <div key={audit.id} className="relative flex flex-col gap-2.5 pl-5 group border-l border-[#1F2124] py-1">
                        
                        {/* Dot on left line */}
                        <div className={`absolute -left-1.5 top-3 h-2.5 w-2.5 rounded-full border border-black ${dotCol}`} />

                        {/* Row 1: Time, Agent and Task info */}
                        <div className="flex items-center justify-between gap-4 font-mono text-[9px] text-zinc-500">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-white font-bold">{audit.agent_id}</span>
                            <span>/</span>
                            <span>{audit.task_id}</span>
                            <span className="px-1.5 py-0.2 bg-black border border-[#1F2124] rounded text-[8px] uppercase">{statusLabel}</span>
                          </div>
                          <span className="text-zinc-600">{formatFullDate(audit.created_at)}</span>
                        </div>

                        {/* Row 2: Tool call status & inspector button */}
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2 font-mono text-xs">
                            <Terminal className="h-3.5 w-3.5 text-zinc-550" />
                            <span className="text-white font-extrabold uppercase">{audit.tool_name}</span>
                            <span className="text-zinc-500">─▶</span>
                            <span className="text-[10px] text-zinc-450">{decisionLabel}</span>
                          </div>
                          
                          <button
                            onClick={() => setSelectedAuditId(isSelected ? null : audit.id)}
                            className="px-2 py-0.5 bg-black hover:bg-[#0F1112] text-zinc-400 hover:text-white border border-[#1F2124] hover:border-orange-brand/45 rounded font-mono text-[8px] uppercase tracking-wider transition-all cursor-pointer"
                          >
                            {isSelected ? 'Collapse' : 'Inspect'}
                          </button>
                        </div>

                        {/* Collapsible Inspector details */}
                        {isSelected && (
                          <div className="mt-3 p-4 bg-black border border-[#1F2124] rounded flex flex-col gap-4 animate-in slide-in-from-top-1 duration-100 shadow-inner">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[9px] font-mono">
                              <div>
                                <span className="text-zinc-550 uppercase font-bold block">Audit ID</span>
                                <span className="text-zinc-350 select-all block mt-0.5">{audit.id}</span>
                              </div>
                              <div>
                                <span className="text-zinc-550 uppercase font-bold block">Confidence Level</span>
                                <span className="text-zinc-350 block mt-0.5">{audit.confidence}% Integrity</span>
                              </div>
                              <div>
                                <span className="text-zinc-550 uppercase font-bold block">Decision Matrix</span>
                                <span className="text-zinc-350 block mt-0.5 uppercase">{audit.decision}</span>
                              </div>
                            </div>

                            {/* Chronology logs */}
                            {audit.steps && Array.isArray(audit.steps) && audit.steps.length > 0 && (
                              <div>
                                <span className="text-[8px] text-zinc-550 uppercase font-bold block mb-1">Log Sequence</span>
                                <div className="border-l border-[#1F2124] pl-3 flex flex-col gap-1.5">
                                  {audit.steps.map((s, idx) => (
                                    <div key={idx} className="text-[9px] leading-relaxed text-zinc-400 font-mono">
                                      <span className="text-zinc-600">[{formatTimestamp(s.timestamp)}]</span> {s.message}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Raw JSON Payloads */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <span className="text-[8px] text-zinc-550 uppercase font-bold block mb-1">Raw Payload Params</span>
                                <pre className="text-[9px] font-mono bg-[#0F1112] p-3 rounded border border-[#1F2124] text-zinc-400 overflow-x-auto max-h-[140px]">
                                  {JSON.stringify(audit.tool_payload, null, 2)}
                                </pre>
                              </div>
                              <div>
                                <span className="text-[8px] text-zinc-550 uppercase font-bold block mb-1">Execution Result</span>
                                <pre className="text-[9px] font-mono bg-[#0F1112] p-3 rounded border border-[#1F2124] text-emerald-500 overflow-x-auto max-h-[140px]">
                                  {audit.result ? JSON.stringify(audit.result, null, 2) : 'No output returned.'}
                                </pre>
                              </div>
                            </div>

                          </div>
                        )}

                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: AGENTS OBSERVED */}
        {activeTab === 'agents' && (
          <div className="flex-1 flex flex-col gap-6 animate-in fade-in duration-200">
            <div>
              <h3 className="text-xs font-mono font-bold text-white uppercase">Active Agent Watch-Registry</h3>
              <p className="text-[10px] text-zinc-500 mt-1 font-mono uppercase">Autonomous agent instances currently routing tool requests through Guardian policy layers.</p>
            </div>

            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {uniqueAgents.length === 0 ? (
                <div className="col-span-full py-16 text-center text-zinc-650 font-mono text-[10px] uppercase">
                  No active agent telemetry registered.
                </div>
              ) : (
                uniqueAgents.map((agent) => {
                  let stateDotColor = 'bg-zinc-500';
                  let stateTextClass = 'text-zinc-400';
                  if (agent.state === 'Running') {
                    stateDotColor = 'bg-orange-brand animate-pulse';
                    stateTextClass = 'text-orange-brand';
                  } else if (agent.state === 'Waiting Approval') {
                    stateDotColor = 'bg-orange-brand';
                    stateTextClass = 'text-white font-bold';
                  } else if (agent.state === 'Blocked') {
                    stateDotColor = 'bg-red-500';
                    stateTextClass = 'text-red-500';
                  } else if (agent.state === 'Recovered') {
                    stateDotColor = 'bg-emerald-500';
                    stateTextClass = 'text-emerald-400';
                  }

                  let riskColor = 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5';
                  if (agent.riskScore > 65) {
                    riskColor = 'text-red-400 border-red-500/20 bg-red-500/5';
                  } else if (agent.riskScore > 35) {
                    riskColor = 'text-orange-brand border-orange-brand/20 bg-orange-brand/5';
                  }

                  return (
                    <div 
                      key={agent.name} 
                      className="bg-[#0F1112] border border-[#1F2124] rounded p-5 flex flex-col justify-between h-[160px] relative hover:border-orange-brand/25 transition-all shadow-md"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-3 border-b border-[#1F2124] pb-2.5">
                          <span className="text-xs font-bold text-white font-mono truncate">{agent.name}</span>
                          <span className={`text-[8px] font-mono font-bold px-2 py-0.5 rounded border ${riskColor}`}>
                            RISK_IDX: {agent.riskScore}%
                          </span>
                        </div>

                        <div className="mt-3">
                          <span className="text-[8px] text-zinc-550 font-bold uppercase block font-mono">Telemetry activity //</span>
                          <span className="text-[11px] text-zinc-300 font-mono truncate block mt-0.5">{agent.lastTask}</span>
                        </div>
                      </div>

                      <div className="border-t border-[#1F2124] pt-3 flex items-center justify-between text-[9px] font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${stateDotColor}`} />
                          <span className={`uppercase font-bold ${stateTextClass}`}>{agent.state}</span>
                        </div>
                        <span className="text-zinc-550">DECISION: <span className="text-white uppercase font-bold">{agent.lastDecision}</span></span>
                      </div>
                    </div>
                  );
                })
              )}
            </section>
          </div>
        )}

        {/* TAB 3: WORKFLOWS CONNECTED */}
        {activeTab === 'workflows' && !selectedWorkflowId && (
          <div className="flex-1 flex flex-col gap-6 animate-in fade-in duration-200">
            <div>
              <h3 className="text-xs font-mono font-bold text-white uppercase">Protected Workflows Map</h3>
              <p className="text-[10px] text-zinc-500 mt-1 font-mono uppercase">Direct representation of connected n8n pipelines, depicting where the Guardian proxy intercepts payloads.</p>
            </div>

            <div className="flex flex-col gap-4">
              {safeWorkflows.length === 0 ? (
                <div className="py-16 text-center text-zinc-650 font-mono text-[10px] uppercase">
                  No connected workflows active.
                </div>
              ) : (
                safeWorkflows.map((w) => {
                  return (
                    <div 
                      key={w.id} 
                      onClick={() => setSelectedWorkflowId(w.id)}
                      className="bg-[#0F1112] border border-[#1F2124] hover:border-orange-brand/30 rounded p-6 transition-all shadow-md flex flex-col gap-6 cursor-pointer"
                    >
                      <div className="flex items-center justify-between border-b border-[#1F2124] pb-3">
                        <span className="text-xs font-bold text-white font-mono uppercase">{w.name}</span>
                        <div className="flex items-center gap-4 text-[9px] font-mono text-zinc-500">
                          <span>RUNS: <span className="text-white font-bold">{w.total_runs}</span></span>
                          <span>INTEGRITY: <span className="text-orange-brand font-bold">{w.health_score}%</span></span>
                        </div>
                      </div>

                      {/* Stark node visualization */}
                      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-center text-center font-mono py-2 text-[10px]">
                        <div className="bg-black border border-[#1F2124] rounded py-2 px-3 text-zinc-400">
                          <span className="text-[7px] text-zinc-550 block uppercase font-bold mb-0.5">SOURCE FLOW</span>
                          <span className="text-white font-bold">n8n Execution</span>
                        </div>

                        <div className="text-zinc-650 hidden md:block text-xs">━━━━━━━━▶</div>

                        <div className="bg-orange-brand/5 border border-orange-brand/20 rounded py-2 px-3 text-orange-brand relative overflow-hidden group shadow-inner">
                          <span className="text-[7px] text-orange-brand block uppercase font-bold mb-0.5">INTERCEPT PROXY</span>
                          <span className="text-white font-extrabold flex items-center justify-center gap-1.5">
                            <Shield className="h-3 w-3 animate-pulse" />
                            Guardian Sandbox
                          </span>
                        </div>

                        <div className="text-zinc-650 hidden md:block text-xs">━━━━━━━━▶</div>

                        <div className="bg-black border border-[#1F2124] rounded py-2 px-3 text-zinc-400">
                          <span className="text-[7px] text-zinc-550 block uppercase font-bold mb-0.5">TARGET APIS</span>
                          <span className="text-zinc-300 font-bold truncate block">External Tools Integration</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* WORKFLOW DETAILED VIEW */}
        {selectedWorkflowId && workflowDetail && (
          <div className="flex-1 flex flex-col gap-6 animate-in fade-in duration-150">
            <div className="bg-[#0F1112] border border-[#1F2124] rounded p-6 relative">
              
              {/* Corner accents */}
              <div className="absolute top-0 left-0 w-2.5 h-2.5 border-t border-l border-orange-brand" />
              <div className="absolute top-0 right-0 w-2.5 h-2.5 border-t border-r border-orange-brand" />
              <div className="absolute bottom-0 left-0 w-2.5 h-2.5 border-b border-l border-orange-brand" />
              <div className="absolute bottom-0 right-0 w-2.5 h-2.5 border-b border-r border-orange-brand" />

              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-[#1F2124] pb-4 mb-4 font-mono">
                <div>
                  <span className="text-[8px] text-zinc-500 uppercase">Workflow Details //</span>
                  <h2 className="text-sm font-bold text-white uppercase mt-1">{workflowDetail.workflow.name}</h2>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-left text-[9px]">
                  <div>
                    <span className="text-zinc-550 block">SUCCESS RATE</span>
                    <span className="text-white font-bold block">{workflowDetail.stats.success_rate}%</span>
                  </div>
                  <div>
                    <span className="text-zinc-550 block">RECOVERY RATE</span>
                    <span className="text-orange-brand font-bold block">{workflowDetail.stats.recovery_rate}%</span>
                  </div>
                  <div>
                    <span className="text-zinc-550 block">TOTAL RUNS</span>
                    <span className="text-white font-bold block">{workflowDetail.stats.total_runs}</span>
                  </div>
                  <div>
                    <span className="text-zinc-550 block">KEY ENCRYPTION</span>
                    <span className="text-zinc-400 select-all block truncate max-w-[80px]">{workflowDetail.workflow.key}</span>
                  </div>
                </div>
              </div>

              {/* Insights Section */}
              <div className="mb-6">
                <span className="text-[8px] font-mono text-zinc-550 uppercase font-bold block mb-2">Self-Healing Learnings & Insights //</span>
                <div className="flex flex-col gap-2">
                  {workflowDetail.learnings && Array.isArray(workflowDetail.learnings) ? (
                    workflowDetail.learnings.map((l, i) => (
                      <div key={i} className="bg-black border border-[#1F2124] px-4 py-2.5 rounded text-[10px] font-mono text-zinc-300 flex items-start gap-2.5">
                        <span className="text-orange-brand mt-0.5">•</span>
                        <span>{l}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-[10px] text-zinc-600 font-mono">No learnings logged.</div>
                  )}
                </div>
              </div>

              {/* Recent workflow logs */}
              <div>
                <span className="text-[8px] font-mono text-zinc-550 uppercase font-bold block mb-3">Recent Pipeline Interceptions //</span>
                <div className="flex flex-col gap-3">
                  {(!workflowDetail.recent_audits || workflowDetail.recent_audits.length === 0) ? (
                    <div className="text-[10px] text-zinc-600 font-mono">No logs captured for this workflow.</div>
                  ) : (
                    workflowDetail.recent_audits.slice(0, 5).map((audit) => {
                      const isSelected = selectedAuditId === audit.id;
                      return (
                        <div key={audit.id} className="bg-black border border-[#1F2124] rounded p-4 flex flex-col gap-2 font-mono text-[10px]">
                          <div className="flex items-center justify-between text-[9px] text-zinc-500">
                            <span>AGENT: <strong className="text-white">{audit.agent_id}</strong> (TASK: {audit.task_id})</span>
                            <span>{formatFullDate(audit.created_at)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-white font-bold uppercase">{audit.tool_name} ─▶ <span className="text-zinc-400 font-medium">{audit.decision}</span></span>
                            <button 
                              onClick={() => setSelectedAuditId(isSelected ? null : audit.id)}
                              className="text-[9px] text-orange-brand hover:underline"
                            >
                              {isSelected ? 'Collapse' : 'Inspect'}
                            </button>
                          </div>
                          {isSelected && (
                            <div className="mt-3 border-t border-[#1F2124] pt-3 flex flex-col gap-3">
                              {audit.steps && Array.isArray(audit.steps) && (
                                <div className="border-l border-[#1F2124] pl-2 flex flex-col gap-1 text-[9px] text-zinc-400">
                                  {audit.steps.map((st, idx) => (
                                    <div key={idx}>[{formatTimestamp(st.timestamp)}] {st.message}</div>
                                  ))}
                                </div>
                              )}
                              <pre className="text-[9px] bg-[#0F1112] p-2.5 rounded border border-[#1F2124] text-zinc-500 overflow-x-auto">
                                {JSON.stringify(audit.tool_payload, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* TAB 4: LIVE INTERCEPTIONS */}
        {activeTab === 'interceptions' && (
          <div className="flex-1 flex flex-col gap-6 animate-in fade-in duration-200">
            <div>
              <h3 className="text-xs font-mono font-bold text-white uppercase">Interception Incident Logs</h3>
              <p className="text-[10px] text-zinc-500 mt-1 font-mono uppercase">Detailed reports profiling safety engine payload validations and auto-correct actions.</p>
            </div>

            <section className="flex flex-col gap-4 max-w-4xl">
              {safeAudits.length === 0 ? (
                <div className="py-16 text-center text-zinc-650 font-mono text-[10px] uppercase border border-[#1F2124] bg-[#0F1112] rounded">
                  No intercepted incidents captured yet.
                </div>
              ) : (
                safeAudits.map((audit) => {
                  let policyLabel = 'PII PROTECTION GUARD';
                  let decisionText = 'POLICY CLEAR';
                  let statusColor = 'text-[#FF571A] border-orange-brand/20 bg-orange-brand/5';
                  let explanation = 'No action blocked. Executed successfully.';

                  if (audit.decision === 'ask_human') {
                    policyLabel = 'AMBIGUITY & COMPLETENESS GATE';
                    decisionText = 'SUSPENDED & ESCALATED';
                    statusColor = 'text-white border-orange-brand/40 bg-orange-brand/5';
                    explanation = 'Operator decision hold. Waiting for human approval override parameters.';
                  } else if (audit.decision === 'abort') {
                    policyLabel = 'SECURITY SAFEGUARD RULES';
                    decisionText = 'ACTION BLOCKED';
                    statusColor = 'text-red-500 border-red-500/20 bg-red-500/5';
                    explanation = 'Interposed block. Dangerous action aborted according to payload safety rules.';
                  } else if (audit.steps && Array.isArray(audit.steps) && audit.steps.some(s => s.message && (s.message.toLowerCase().includes('retry') || s.message.toLowerCase().includes('refresh')))) {
                    policyLabel = 'CREDENTIAL RECOVERY ENGINE';
                    decisionText = 'AUTO SANITIZED';
                    statusColor = 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5';
                    explanation = 'Applied automatic access credentials refresh and retried payload.';
                  }

                  return (
                    <div 
                      key={audit.id} 
                      className="bg-[#0F1112] border border-[#1F2124] rounded p-5 flex flex-col gap-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#1F2124] pb-3 font-mono">
                        <div className="text-[10px]">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white uppercase">INCIDENT: {audit.id.substring(0, 16)}</span>
                            <span className="text-zinc-650">/</span>
                            <span className="text-[9px] text-zinc-500">{formatFullDate(audit.created_at)}</span>
                          </div>
                          <p className="text-[9px] text-zinc-500 mt-1 uppercase">
                            SOURCE AGENT: <strong className="text-white">{audit.agent_id}</strong> (TASK: {audit.task_id})
                          </p>
                        </div>
                        <span className={`text-[8px] font-bold uppercase px-2.5 py-0.5 rounded border ${statusColor}`}>
                          {decisionText}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[10px] font-mono">
                        <div>
                          <span className="text-zinc-550 block font-bold uppercase">TARGET TOOL REQUEST</span>
                          <span className="text-white font-extrabold text-[11px] block mt-0.5 uppercase">{audit.tool_name}</span>
                        </div>
                        <div>
                          <span className="text-zinc-550 block font-bold uppercase">RULE SCHEME INVOLVED</span>
                          <span className="text-zinc-300 block mt-0.5 uppercase">{policyLabel}</span>
                        </div>
                      </div>

                      <div className="text-[10px] bg-black border border-[#1F2124] rounded p-3 text-zinc-400 font-mono leading-relaxed">
                        <strong className="text-[8px] text-zinc-500 font-bold uppercase block mb-1">MITIGATION LOG DETAIL:</strong>
                        {explanation}
                      </div>

                      <div>
                        <span className="text-[8px] text-zinc-550 font-bold uppercase block mb-1.5 font-mono">Action Payload Parameters</span>
                        <pre className="text-[9px] font-mono bg-black p-3 rounded border border-[#1F2124] text-zinc-500 overflow-x-auto max-h-[100px]">
                          {JSON.stringify(audit.tool_payload, null, 2)}
                        </pre>
                      </div>
                    </div>
                  );
                })
              )}
            </section>
          </div>
        )}

        {/* TAB 5: HUMAN INTERVENTION BUFFER */}
        {activeTab === 'approvals' && (
          <div className="flex-1 flex flex-col gap-6 animate-in fade-in duration-200">
            <div>
              <h3 className="text-xs font-mono font-bold text-white uppercase">Secured Intervention Hold-Queue</h3>
              <p className="text-[10px] text-zinc-500 mt-1 font-mono uppercase">Suspended action payloads requiring manual operator authorization or param override.</p>
            </div>

            {safeApprovals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center border border-[#1F2124] rounded bg-[#0F1112] max-w-lg mx-auto w-full font-mono">
                <UserCheck className="h-8 w-8 text-zinc-800 mb-2" />
                <p className="text-[10px] font-bold text-zinc-400 uppercase">INTERVENTION BUFFER CLEAR</p>
                <p className="text-[9px] text-zinc-600 mt-1 uppercase">All agent workflows executing without exception interrupts.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {safeApprovals.map((approval) => {
                  return (
                    <div 
                      key={approval.id} 
                      className="bg-[#0F1112] border border-[#1F2124] rounded p-5 flex flex-col gap-4 relative"
                    >
                      {/* Stark active orange corner badge for held queue items */}
                      <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-orange-brand" />

                      <div className="flex items-start justify-between gap-3 border-b border-[#1F2124] pb-3 font-mono">
                        <div>
                          <span className="text-[8px] text-zinc-550 block font-bold uppercase">SECURITY EXCEPTION HOLD</span>
                          <h4 className="text-xs font-black text-white mt-1 uppercase flex items-center gap-1.5">
                            <Terminal className="h-3.5 w-3.5 text-orange-brand" />
                            {approval.tool_name}
                          </h4>
                        </div>
                        <div className="text-right">
                          <span className="text-[8px] text-zinc-550 block uppercase font-bold">CRITIC RISK SCORE</span>
                          <span className="text-xs font-extrabold text-orange-brand flex items-center justify-end gap-1 mt-0.5">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {approval.confidence_score}% Clarity
                          </span>
                        </div>
                      </div>

                      <div className="text-[10px] bg-orange-brand/5 border border-orange-brand/20 rounded p-3 text-orange-brand leading-relaxed font-mono">
                        <strong className="text-[8px] text-white font-bold uppercase block mb-1">ESCALATION EXPLANATION:</strong>
                        {approval.reason}
                      </div>

                      <div className="flex flex-col gap-2 font-mono">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[8px] text-zinc-550 font-bold uppercase">PAYLOAD ATTRIBUTES</span>
                          {editingPayloadId !== approval.id ? (
                            <button 
                              onClick={() => handleStartEdit(approval)}
                              className="text-[8px] text-orange-brand font-bold uppercase hover:underline cursor-pointer"
                            >
                              [Edit Parameters]
                            </button>
                          ) : (
                            <button 
                              onClick={() => setEditingPayloadId(null)}
                              className="text-[8px] text-zinc-500 font-bold uppercase cursor-pointer"
                            >
                              [Discard override]
                            </button>
                          )}
                        </div>

                        {editingPayloadId === approval.id ? (
                          <div className="flex flex-col gap-2">
                            <textarea
                              value={editPayloadText}
                              onChange={(e) => setEditPayloadText(e.target.value)}
                              rows={5}
                              className="w-full text-[10px] font-mono bg-black text-orange-brand p-3 rounded border border-[#1F2124] focus:border-orange-brand outline-none resize-none"
                            />
                            {jsonError && (
                              <p className="text-[9px] text-red-500 font-semibold">{jsonError}</p>
                            )}
                          </div>
                        ) : (
                          <pre className="text-[9px] font-mono bg-black p-3.5 rounded border border-[#1F2124] text-zinc-400 overflow-x-auto max-h-[120px]">
                            {JSON.stringify(approval.tool_payload, null, 2)}
                          </pre>
                        )}
                      </div>

                      {/* Large operator buttons */}
                      <div className="flex items-center gap-3 border-t border-[#1F2124] pt-4 mt-1">
                        <button
                          onClick={() => handleResolveApproval(approval.id, 'reject')}
                          className="flex-1 py-2 bg-black hover:bg-red-950/20 text-red-500 hover:text-red-400 border border-[#1F2124] hover:border-red-500/35 font-extrabold font-mono text-[9px] uppercase tracking-wider rounded flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" /> REJECT ACTION
                        </button>
                        
                        <button
                          onClick={() => handleResolveApproval(approval.id, 'approve')}
                          className="flex-1 py-2 bg-orange-brand hover:bg-[#E04B14] text-black font-extrabold font-mono text-[9px] uppercase tracking-wider rounded flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md"
                        >
                          <Check className="h-3.5 w-3.5" /> APPROVE & RESUME
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 6: SAFETY POLICIES RULES */}
        {activeTab === 'policies' && (
          <div className="flex-1 flex flex-col gap-6 animate-in fade-in duration-200">
            <div>
              <h3 className="text-xs font-mono font-bold text-white uppercase">Active Scan Rules Enforced</h3>
              <p className="text-[10px] text-zinc-500 mt-1 font-mono uppercase">System middleware checks validating structural and security bounds on outbound API calls.</p>
            </div>

            <section className="flex flex-col gap-4 max-w-4xl">
              {safetyPolicies.map((pol) => {
                return (
                  <div 
                    key={pol.id} 
                    className="bg-[#0F1112] border border-[#1F2124] rounded p-5 flex flex-col gap-3 relative"
                  >
                    <div className="flex items-center justify-between border-b border-[#1F2124] pb-3 font-mono text-[10px]">
                      <div className="flex items-center gap-2">
                        <span className="font-bold bg-orange-brand/10 text-orange-brand border border-orange-brand/20 px-2 py-0.5 rounded text-[8px]">
                          {pol.category.toUpperCase()}
                        </span>
                        <h4 className="font-extrabold text-white uppercase">{pol.name}</h4>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-500">HITS: <span className="text-white font-bold">{pol.interceptionsCount}</span></span>
                        <span className="h-1.5 w-1.5 rounded-full bg-orange-brand animate-pulse" />
                        <span className="text-orange-brand font-bold uppercase tracking-wider text-[8px]">{pol.status}</span>
                      </div>
                    </div>

                    <p className="text-[11px] text-zinc-400 leading-relaxed font-mono">
                      {pol.description}
                    </p>

                    <div className="mt-1 flex flex-col gap-2 border-t border-black pt-3">
                      <span className="text-[8px] text-zinc-550 uppercase font-bold font-mono">Scan rules checked //</span>
                      <ul className="flex flex-col gap-1.5 font-mono text-[9px] text-zinc-400">
                        {pol.rules.map((r, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <span className="h-1 w-1 bg-orange-brand rounded-full" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                );
              })}
            </section>
          </div>
        )}

      </main>

      {/* FOOTER */}
      <footer className="border-t border-[#1F2124] bg-black py-4 px-6 mt-12 text-center text-[8px] font-mono text-zinc-600 uppercase tracking-widest">
        SYSTEM SECURED BY HYDRA // GUARDIAN RUNTIME © {new Date().getFullYear()}
      </footer>

    </div>
  );
}
