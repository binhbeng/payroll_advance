"use client";

import { useState, useEffect, useRef } from "react";
import {
  checkFreighter,
  getXlmBalance,
  fundWithFriendbot,
  initContract,
  registerEmployee,
  requestAdvance,
  approveAdvance,
  rejectAdvance,
  repayAdvance,
  queryEmployee,
  queryOutstanding,
  queryAllRequests,
  CONTRACT_ID,
  EmployeeData,
  AdvanceRequestWithId
} from "../lib/stellar";
import {
  Wallet,
  Coins,
  ArrowRightLeft,
  Users,
  UserCheck,
  User,
  PlusCircle,
  Clock,
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertTriangle,
  RefreshCw,
  Search,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  FileText,
  Percent,
  Settings,
  DollarSign,
  Activity,
  HeartHandshake
} from "lucide-react";

interface WatchlistItem {
  address: string;
  name: string;
  monthlySalary: number; // in USD
  registeredAt: string;
}

interface LogEntry {
  timestamp: string;
  message: string;
  hash?: string;
  type: "info" | "success" | "error";
}

export default function PayFlowDashboard() {
  // Wallet states
  const [connected, setConnected] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [xlmBalance, setXlmBalance] = useState("0.0000");
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [fundingAccount, setFundingAccount] = useState(false);

  // Layout states
  const [activeTab, setActiveTab] = useState<"employee" | "employer">("employee");
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Watchlist (stored locally for easy testing)
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [watchlistNameInput, setWatchlistNameInput] = useState("");
  const [watchlistAddressInput, setWatchlistAddressInput] = useState("");

  // Employee Portal states
  const [searchEmployeeAddress, setSearchEmployeeAddress] = useState("");
  const [employeeProfile, setEmployeeProfile] = useState<EmployeeData | null>(null);
  const [employeeRequests, setEmployeeRequests] = useState<AdvanceRequestWithId[]>([]);
  const [loadingEmployee, setLoadingEmployee] = useState(false);
  const [advanceAmountInput, setAdvanceAmountInput] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);

  // Employer Portal states
  const [regEmployeeAddress, setRegEmployeeAddress] = useState("");
  const [regMonthlySalary, setRegMonthlySalary] = useState("3000.00");
  const [regCapBps, setRegCapBps] = useState("5000"); // 50%
  const [submittingReg, setSubmittingReg] = useState(false);

  const [manageEmployeeAddress, setManageEmployeeAddress] = useState("");
  const [manageProfile, setManageProfile] = useState<EmployeeData | null>(null);
  const [manageRequests, setManageRequests] = useState<AdvanceRequestWithId[]>([]);
  const [loadingManage, setLoadingManage] = useState(false);
  const [repayAmountInput, setRepayAmountInput] = useState("");
  const [submittingRepay, setSubmittingRepay] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<Record<number, boolean>>({});

  // Contract init state
  const [submittingInit, setSubmittingInit] = useState(false);

  // Real-time ticking time state
  const [currentTime, setCurrentTime] = useState<number>(Math.floor(Date.now() / 1000));

  // Ticker timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000));
    }, 200);
    return () => clearInterval(timer);
  }, []);

  // Initialize and load persistent data
  useEffect(() => {
    // 1. Initial wallet auto-check
    const autoCheck = async () => {
      try {
        const status = await checkFreighter();
        if (status.connected && status.publicKey) {
          setConnected(true);
          setPublicKey(status.publicKey);
          const balance = await getXlmBalance(status.publicKey);
          setXlmBalance(balance);
          
          // Seed search input by default
          setSearchEmployeeAddress(status.publicKey);
          setManageEmployeeAddress(status.publicKey);
        }
      } catch (e) {
        console.error("Auto check wallet failed", e);
      }
    };
    autoCheck();

    // 2. Load watchlist
    const stored = localStorage.getItem("payflow_watchlist");
    if (stored) {
      try {
        setWatchlist(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse watchlist", e);
      }
    } else {
      // Seed some demo entries to make testing easy
      const demo: WatchlistItem[] = [
        {
          address: "GA5TBCJIL6A7WGWNKTUOKYFPLQN7SM5JNAGB74WSAPIH3FHKAJPJPB6G",
          name: "Alice (Stellar Demo)",
          monthlySalary: 5000.0,
          registeredAt: new Date().toLocaleDateString(),
        },
      ];
      setWatchlist(demo);
      localStorage.setItem("payflow_watchlist", JSON.stringify(demo));
    }

    addLog("PayFlow dashboard initialized. Ready for transactions.", undefined, "info");
  }, []);

  // Helper: Log message
  const addLog = (message: string, hash?: string, type: "info" | "success" | "error" = "info") => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [{ timestamp: time, message, hash, type }, ...prev]);
  };

  // Connect Wallet Action
  const handleConnectWallet = async () => {
    setLoadingWallet(true);
    addLog("Requesting wallet connection via Freighter...");
    try {
      const status = await checkFreighter();
      if (status.connected && status.publicKey) {
        setConnected(true);
        setPublicKey(status.publicKey);
        addLog(`Connected Freighter successfully! Wallet: ${shortenAddress(status.publicKey)}`, undefined, "success");
        
        const balance = await getXlmBalance(status.publicKey);
        setXlmBalance(balance);
        if (parseFloat(balance) === 0) {
          addLog("Notice: Account balance is 0 XLM. Request Friendbot funds below to transact.", undefined, "info");
        }
      } else {
        setConnected(false);
        setPublicKey("");
        if (status.isInstalled) {
          if (status.error) {
            addLog(`Connection rejected by Freighter: ${status.error}`, undefined, "error");
          } else {
            addLog("Freighter wallet is locked. Please open extension and enter password.", undefined, "error");
          }
        } else {
          addLog("Freighter wallet extension not found. Please install the Freighter browser extension.", undefined, "error");
        }
      }
    } catch (e: any) {
      addLog(`Wallet connection error: ${e.message || e}`, undefined, "error");
    } finally {
      setLoadingWallet(false);
    }
  };

  // Fund Wallet Action
  const handleFundWallet = async () => {
    if (!publicKey) return;
    setFundingAccount(true);
    addLog(`Requesting Testnet Friendbot for account: ${shortenAddress(publicKey)}...`);
    try {
      const ok = await fundWithFriendbot(publicKey);
      if (ok) {
        addLog("Friendbot transaction completed successfully! Funding account...", undefined, "success");
        const balance = await getXlmBalance(publicKey);
        setXlmBalance(balance);
      } else {
        addLog("Friendbot rejected request. The account may already be funded or service is busy.", undefined, "error");
      }
    } catch (e: any) {
      addLog(`Friendbot error: ${e.message || e}`, undefined, "error");
    } finally {
      setFundingAccount(false);
    }
  };

  // Watchlist Actions
  const handleAddToWatchlist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!watchlistAddressInput.trim()) return;
    if (watchlistAddressInput.length !== 56 || !watchlistAddressInput.startsWith("G")) {
      addLog("Invalid Stellar Address format.", undefined, "error");
      return;
    }

    const newItem: WatchlistItem = {
      address: watchlistAddressInput.trim(),
      name: watchlistNameInput.trim() || `Worker (${shortenAddress(watchlistAddressInput)})`,
      monthlySalary: parseFloat(regMonthlySalary) || 3000,
      registeredAt: new Date().toLocaleDateString(),
    };

    const updated = [newItem, ...watchlist.filter((item) => item.address !== newItem.address)];
    setWatchlist(updated);
    localStorage.setItem("payflow_watchlist", JSON.stringify(updated));
    setWatchlistNameInput("");
    setWatchlistAddressInput("");
    addLog(`Added ${newItem.name} to watchlist.`, undefined, "success");
  };

  const handleRemoveFromWatchlist = (address: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = watchlist.filter((item) => item.address !== address);
    setWatchlist(updated);
    localStorage.setItem("payflow_watchlist", JSON.stringify(updated));
    addLog("Removed address from watchlist.", undefined, "info");
  };

  const selectWatchlistItem = (address: string) => {
    if (activeTab === "employee") {
      setSearchEmployeeAddress(address);
      handleQueryEmployeeProfile(address);
    } else {
      setManageEmployeeAddress(address);
      handleQueryManageProfile(address);
    }
  };

  // Query Employee Profile (Employee Tab)
  const handleQueryEmployeeProfile = async (addressToQuery?: string) => {
    const addr = addressToQuery || searchEmployeeAddress;
    if (!addr || addr.length !== 56 || !addr.startsWith("G")) {
      addLog("Please enter a valid Stellar Public Address to query.", undefined, "error");
      return;
    }
    setLoadingEmployee(true);
    setEmployeeProfile(null);
    setEmployeeRequests([]);
    try {
      const profile = await queryEmployee(addr);
      if (profile) {
        setEmployeeProfile(profile);
        addLog(`Loaded profile for employee: ${shortenAddress(addr)}`, undefined, "success");
        // Load requests
        const requests = await queryAllRequests(addr);
        setEmployeeRequests(requests);
      } else {
        addLog(`Address ${shortenAddress(addr)} is not registered as an employee on-chain.`, undefined, "error");
      }
    } catch (e: any) {
      addLog(`Failed to query employee profile: ${e.message || e}`, undefined, "error");
    } finally {
      setLoadingEmployee(false);
    }
  };

  // Query Employee Profile (Employer Tab)
  const handleQueryManageProfile = async (addressToQuery?: string) => {
    const addr = addressToQuery || manageEmployeeAddress;
    if (!addr || addr.length !== 56 || !addr.startsWith("G")) {
      addLog("Please enter a valid Stellar Public Address to manage.", undefined, "error");
      return;
    }
    setLoadingManage(true);
    setManageProfile(null);
    setManageRequests([]);
    try {
      const profile = await queryEmployee(addr);
      if (profile) {
        setManageProfile(profile);
        addLog(`Loaded employer management data for: ${shortenAddress(addr)}`, undefined, "success");
        // Load requests
        const requests = await queryAllRequests(addr);
        setManageRequests(requests);
      } else {
        addLog(`Worker ${shortenAddress(addr)} is not registered under you or is inactive.`, undefined, "error");
      }
    } catch (e: any) {
      addLog(`Failed to load worker profile: ${e.message || e}`, undefined, "error");
    } finally {
      setLoadingManage(false);
    }
  };

  // Register Employee Action (Employer Tab)
  const handleRegisterEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) {
      addLog("Please connect your Freighter wallet to register an employee.", undefined, "error");
      return;
    }
    if (!regEmployeeAddress || regEmployeeAddress.length !== 56 || !regEmployeeAddress.startsWith("G")) {
      addLog("Please enter a valid Stellar Address for the employee.", undefined, "error");
      return;
    }

    const salaryFloat = parseFloat(regMonthlySalary);
    if (isNaN(salaryFloat) || salaryFloat <= 0) {
      addLog("Please enter a valid monthly salary.", undefined, "error");
      return;
    }

    const capBps = parseInt(regCapBps);
    if (isNaN(capBps) || capBps < 0 || capBps > 10000) {
      addLog("Cap Bps must be a number between 0 and 10000 (0-100%).", undefined, "error");
      return;
    }

    setSubmittingReg(true);
    addLog(`Submitting worker registration for: ${shortenAddress(regEmployeeAddress)}...`);

    const monthlySalaryCents = BigInt(Math.round(salaryFloat * 100));

    try {
      await registerEmployee(
        publicKey,
        regEmployeeAddress,
        monthlySalaryCents,
        capBps,
        (status, hash) => {
          addLog(status, hash, "info");
        }
      );
      addLog(`Successfully registered employee: ${shortenAddress(regEmployeeAddress)}!`, undefined, "success");
      
      // Auto add to watchlist
      const newItem: WatchlistItem = {
        address: regEmployeeAddress,
        name: `Worker (${shortenAddress(regEmployeeAddress)})`,
        monthlySalary: salaryFloat,
        registeredAt: new Date().toLocaleDateString(),
      };
      setWatchlist((prev) => [newItem, ...prev.filter((i) => i.address !== newItem.address)]);
      localStorage.setItem("payflow_watchlist", JSON.stringify([newItem, ...watchlist.filter((i) => i.address !== newItem.address)]));

      // Reset forms
      setRegEmployeeAddress("");
      
      // Refresh management screen if loaded
      if (manageEmployeeAddress === regEmployeeAddress) {
        handleQueryManageProfile();
      }
    } catch (e: any) {
      addLog(`Registration failed: ${e.message || e}`, undefined, "error");
    } finally {
      setSubmittingReg(false);
    }
  };

  // Request Salary Advance Action (Employee Tab)
  const handleRequestAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) {
      addLog("Please connect your Freighter wallet to request an advance.", undefined, "error");
      return;
    }
    if (!employeeProfile) {
      addLog("No employee profile loaded.", undefined, "error");
      return;
    }

    const reqAmtFloat = parseFloat(advanceAmountInput);
    if (isNaN(reqAmtFloat) || reqAmtFloat <= 0) {
      addLog("Please enter a valid advance amount.", undefined, "error");
      return;
    }

    const reqAmtCents = BigInt(Math.round(reqAmtFloat * 100));
    setSubmittingRequest(true);
    addLog(`Submitting request for salary advance of $${reqAmtFloat.toFixed(2)}...`);

    try {
      await requestAdvance(publicKey, reqAmtCents, (status, hash) => {
        addLog(status, hash, "info");
      });
      addLog(`Advance request submitted successfully! Pending employer approval.`, undefined, "success");
      setAdvanceAmountInput("");
      
      // Refresh profile
      handleQueryEmployeeProfile(publicKey);
    } catch (e: any) {
      addLog(`Request failed: ${e.message || e}`, undefined, "error");
    } finally {
      setSubmittingRequest(false);
    }
  };

  // Approve Advance Action (Employer Tab)
  const handleApproveRequest = async (requestId: number) => {
    if (!connected || !manageProfile) return;
    setActionInProgress((prev) => ({ ...prev, [requestId]: true }));
    addLog(`Approving advance request #${requestId} for worker: ${shortenAddress(manageEmployeeAddress)}...`);
    try {
      await approveAdvance(publicKey, manageEmployeeAddress, requestId, (status, hash) => {
        addLog(status, hash, "info");
      });
      addLog(`Approved advance request #${requestId} successfully! Payout registered.`, undefined, "success");
      
      // Refresh profile
      handleQueryManageProfile(manageEmployeeAddress);
    } catch (e: any) {
      addLog(`Failed to approve request: ${e.message || e}`, undefined, "error");
    } finally {
      setActionInProgress((prev) => ({ ...prev, [requestId]: false }));
    }
  };

  // Reject Advance Action (Employer Tab)
  const handleRejectRequest = async (requestId: number) => {
    if (!connected || !manageProfile) return;
    setActionInProgress((prev) => ({ ...prev, [requestId]: true }));
    addLog(`Rejecting advance request #${requestId} for worker: ${shortenAddress(manageEmployeeAddress)}...`);
    try {
      await rejectAdvance(publicKey, manageEmployeeAddress, requestId, (status, hash) => {
        addLog(status, hash, "info");
      });
      addLog(`Rejected advance request #${requestId} successfully.`, undefined, "success");
      
      // Refresh profile
      handleQueryManageProfile(manageEmployeeAddress);
    } catch (e: any) {
      addLog(`Failed to reject request: ${e.message || e}`, undefined, "error");
    } finally {
      setActionInProgress((prev) => ({ ...prev, [requestId]: false }));
    }
  };

  // Repay/Deduct Advance Action (Employer Tab)
  const handleRepayAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !manageProfile) {
      addLog("Please connect your wallet and load a worker profile to repay.", undefined, "error");
      return;
    }

    const repayAmtFloat = parseFloat(repayAmountInput);
    if (isNaN(repayAmtFloat) || repayAmtFloat <= 0) {
      addLog("Please enter a valid repayment amount.", undefined, "error");
      return;
    }

    const repayAmtCents = BigInt(Math.round(repayAmtFloat * 100));
    setSubmittingRepay(true);
    addLog(`Recording payroll deduction / repayment of $${repayAmtFloat.toFixed(2)} for worker: ${shortenAddress(manageEmployeeAddress)}...`);
    
    try {
      await repayAdvance(publicKey, manageEmployeeAddress, repayAmtCents, (status, hash) => {
        addLog(status, hash, "info");
      });
      addLog(`Recorded repayment of $${repayAmtFloat.toFixed(2)} successfully! outstanding balance reduced.`, undefined, "success");
      setRepayAmountInput("");
      
      // Refresh profile
      handleQueryManageProfile(manageEmployeeAddress);
    } catch (e: any) {
      addLog(`Repayment recording failed: ${e.message || e}`, undefined, "error");
    } finally {
      setSubmittingRepay(false);
    }
  };

  // Admin Initialise Action
  const handleInitialize = async () => {
    if (!connected) {
      addLog("Connect Freighter wallet first to initialize contract.", undefined, "error");
      return;
    }
    setSubmittingInit(true);
    addLog("Submitting admin initialization request for contract...");
    try {
      await initContract(publicKey, (status, hash) => {
        addLog(status, hash, "info");
      });
      addLog("Contract initialized successfully as admin!", undefined, "success");
    } catch (e: any) {
      addLog(`Initialization failed: ${e.message || e}`, undefined, "error");
    } finally {
      setSubmittingInit(false);
    }
  };

  // Shorten public keys for UI
  const shortenAddress = (address: string) => {
    if (!address) return "";
    return `${address.slice(0, 5)}...${address.slice(-5)}`;
  };

  // Calculate realtime ticked wage values
  const SECONDS_IN_MONTH = 30 * 24 * 60 * 60;

  // For Employee Dashboard
  let tickingUsdEarned = 0;
  let maxEmployeeAdvance = 0;
  if (employeeProfile) {
    const elapsed = currentTime - Number(employeeProfile.last_accrual_ts);
    const accruedSinceLastCents = (Number(employeeProfile.monthly_salary) * elapsed) / SECONDS_IN_MONTH;
    const totalAccruedCents = Number(employeeProfile.accrued_balance) + accruedSinceLastCents;
    tickingUsdEarned = totalAccruedCents / 100;
    maxEmployeeAdvance = (totalAccruedCents * employeeProfile.advance_cap_bps) / 10000 / 100;
  }

  // Format real-time ticker string (returns [main, fractional])
  const getTickerFormat = (amount: number) => {
    const fixed = amount.toFixed(7);
    const main = fixed.slice(0, -5); // includes decimal and first 2 cents digits
    const fraction = fixed.slice(-5); // micro-cents ticking fast
    return [main, fraction];
  };

  const [tickerMain, tickerFraction] = getTickerFormat(tickingUsdEarned);

  // Status mapping helper
  const getStatusBadge = (status: number) => {
    switch (status) {
      case 0: return <span className="badge badge-pending">Pending</span>;
      case 1: return <span className="badge badge-approved">Approved</span>;
      case 2: return <span className="badge badge-rejected">Rejected</span>;
      default: return null;
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* HEADER */}
      <header className="app-header">
        <div className="header-container">
          <div className="brand">
            <Coins className="text-primary" size={28} />
            <span>PayFlow</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            {connected ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                    <Wallet size={14} className="text-secondary" />
                    {shortenAddress(publicKey)}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.25rem" }}>
                    <Coins size={12} />
                    {xlmBalance} XLM
                  </div>
                </div>
                
                <button 
                  className="btn btn-secondary btn-icon" 
                  onClick={handleFundWallet}
                  disabled={fundingAccount}
                  title="Request Friendbot XLM Testnet Funds"
                >
                  <RefreshCw size={16} className={fundingAccount ? "animate-spin" : ""} style={{ animation: fundingAccount ? "spin 1s linear infinite" : "none" }} />
                </button>
              </div>
            ) : (
              <button className="btn btn-primary" onClick={handleConnectWallet} disabled={loadingWallet}>
                <Wallet size={16} />
                {loadingWallet ? "Connecting..." : "Connect Wallet"}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="container" style={{ flex: 1 }}>
        <div className="grid-1-2">
          
          {/* LEFT SIDEBAR COLUMN */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            
            {/* WATCHLIST / REGISTRY WATCHLIST */}
            <div className="card">
              <h3 className="card-title">
                <Users size={18} style={{ color: "var(--color-primary)" }} />
                Employee Watchlist
              </h3>
              <p style={{ fontSize: "0.85rem", marginBottom: "1rem", color: "var(--text-secondary)" }}>
                Quick-select registered workers to load their dashboard profiles instantly:
              </p>

              <div className="watchlist">
                {watchlist.length > 0 ? (
                  watchlist.map((item) => (
                    <div 
                      key={item.address} 
                      className={`watchlist-item ${(activeTab === "employee" && searchEmployeeAddress === item.address) || (activeTab === "employer" && manageEmployeeAddress === item.address) ? "selected" : ""}`}
                      onClick={() => selectWatchlistItem(item.address)}
                    >
                      <div className="watchlist-info">
                        <span className="watchlist-address">{item.name}</span>
                        <span className="watchlist-sub">
                          Monthly Salary: ${(item.monthlySalary).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <button 
                        className="btn-icon" 
                        style={{ padding: "0.25rem", borderRadius: "4px" }}
                        onClick={(e) => handleRemoveFromWatchlist(item.address, e)}
                        title="Remove from watchlist"
                      >
                        <XCircle size={14} style={{ color: "var(--color-danger)" }} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div style={{ textAlign: "center", padding: "1.5rem 0", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                    Watchlist is empty
                  </div>
                )}
              </div>

              {/* Add to watchlist manually */}
              <form onSubmit={handleAddToWatchlist} style={{ marginTop: "1rem", borderTop: "1px solid var(--border-color)", paddingTop: "1rem" }}>
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Worker Name"
                    value={watchlistNameInput}
                    onChange={(e) => setWatchlistNameInput(e.target.value)}
                    style={{ flex: 1, padding: "0.5rem" }}
                  />
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Stellar Public Key"
                    value={watchlistAddressInput}
                    onChange={(e) => setWatchlistAddressInput(e.target.value)}
                    style={{ flex: 2, padding: "0.5rem" }}
                  />
                </div>
                <button type="submit" className="btn btn-secondary" style={{ width: "100%", padding: "0.5rem" }}>
                  <PlusCircle size={14} /> Add to Watchlist
                </button>
              </form>
            </div>

            {/* CONTRACT CONFIG & UTILITIES */}
            <div className="card">
              <h3 className="card-title">
                <Settings size={18} style={{ color: "var(--color-info)" }} />
                Smart Contract Settings
              </h3>
              <div className="stats-list" style={{ gap: "0.5rem" }}>
                <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                  <strong>Contract ID:</strong>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", background: "rgba(0,0,0,0.3)", padding: "0.5rem", borderRadius: "6px", overflowX: "auto", margin: "0.25rem 0" }}>
                    {CONTRACT_ID}
                  </div>
                  <a 
                    href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`} 
                    target="_blank" 
                    rel="noreferrer"
                    className="log-link"
                    style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", margin: 0, fontSize: "0.8rem" }}
                  >
                    View on StellarExpert <ExternalLink size={12} />
                  </a>
                </div>

                <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "0.75rem", marginTop: "0.5rem" }}>
                  <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                    If setting up the contract on a fresh deployment, run the initialization to register the admin:
                  </p>
                  <button 
                    className="btn btn-secondary" 
                    style={{ width: "100%", padding: "0.5rem", fontSize: "0.85rem" }}
                    onClick={handleInitialize}
                    disabled={submittingInit || !connected}
                  >
                    <Activity size={14} />
                    {submittingInit ? "Initializing..." : "Initialize Contract"}
                  </button>
                </div>
              </div>
            </div>

            {/* QUICK PROTOCOL GUIDE */}
            <div className="card">
              <h3 className="card-title">
                <HeartHandshake size={18} style={{ color: "var(--color-success)" }} />
                PayFlow Principles
              </h3>
              <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                <p><strong>🔒 Employer Funded:</strong> Advances are drawn against registered salaries directly funded by employers. No pooled capital, interest, or collateral.</p>
                <p><strong>📈 Accrued Wages:</strong> Workers draw up to their custom cap (default 50%) based on wages dynamically accrued since the last payday cycle.</p>
                <p><strong>🔄 Settlement Cycles:</strong> When an employer runs payroll, they submit a deduction. Once fully repaid, the outstanding is reset to 0, and the worker accrues salary anew.</p>
              </div>
            </div>

          </div>

          {/* RIGHT VIEW COLUMN (DASHBOARDS) */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            
            {/* PORTAL NAV TABS */}
            <div className="tabs-container">
              <button 
                className={`tab-btn ${activeTab === "employee" ? "active" : ""}`}
                onClick={() => setActiveTab("employee")}
              >
                <User size={16} />
                Employee Dashboard
              </button>
              <button 
                className={`tab-btn ${activeTab === "employer" ? "active" : ""}`}
                onClick={() => setActiveTab("employer")}
              >
                <UserCheck size={16} />
                Employer Dashboard
              </button>
            </div>

            {/* TAB CONTENT: EMPLOYEE DASHBOARD */}
            {activeTab === "employee" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                
                {/* Search Employee Box */}
                <div className="card">
                  <h3 className="card-title">
                    <Search size={18} style={{ color: "var(--color-primary)" }} />
                    Inspect Employee Ledger
                  </h3>
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Stellar Public Key (starts with G...)"
                      value={searchEmployeeAddress}
                      onChange={(e) => setSearchEmployeeAddress(e.target.value)}
                    />
                    <button 
                      className="btn btn-primary"
                      onClick={() => handleQueryEmployeeProfile()}
                      disabled={loadingEmployee}
                    >
                      {loadingEmployee ? "Loading..." : "Load"}
                    </button>
                  </div>
                </div>

                {/* Main Profile Info & Ticker */}
                {employeeProfile && (
                  <>
                    {/* Live Ticker Card */}
                    <div className="card" style={{ padding: 0 }}>
                      <div className="ticker-container">
                        <div className="ticker-label">Dynamically Accrued Salary (Real-time)</div>
                        <div className="ticker-amount">
                          <span>$</span>{tickerMain}
                          <span className="ticker-cents">{tickerFraction.slice(0, 2)}</span>
                          <span className="ticker-decimals">{tickerFraction.slice(2)}</span>
                        </div>
                        <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: "0.5rem", display: "flex", justifyContent: "center", gap: "0.5rem" }}>
                          <span>Accumulating salary since:</span>
                          <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                            {new Date(Number(employeeProfile.last_accrual_ts) * 1000).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div style={{ padding: "0 1.5rem 1.5rem" }}>
                        <div className="grid-2" style={{ marginBottom: "1rem" }}>
                          <div className="stat-item">
                            <span className="stat-label"><Coins size={14} /> Monthly Salary</span>
                            <span className="stat-value">${(Number(employeeProfile.monthly_salary) / 100).toLocaleString()}</span>
                          </div>
                          <div className="stat-item">
                            <span className="stat-label"><Percent size={14} /> Max Advance Cap</span>
                            <span className="stat-value">{(employeeProfile.advance_cap_bps / 100).toFixed(1)}%</span>
                          </div>
                        </div>

                        <div className="grid-3">
                          <div className="stat-item">
                            <span className="stat-label" style={{ color: "var(--color-danger)" }}><ArrowRightLeft size={14} /> Outstanding</span>
                            <span className="stat-value mono" style={{ color: employeeProfile.outstanding > 0 ? "var(--color-danger)" : "inherit" }}>
                              ${(Number(employeeProfile.outstanding) / 100).toFixed(2)}
                            </span>
                          </div>
                          <div className="stat-item">
                            <span className="stat-label" style={{ color: "var(--color-success)" }}><CheckCircle2 size={14} /> Total Advanced</span>
                            <span className="stat-value mono" style={{ color: "var(--color-success)" }}>
                              ${(Number(employeeProfile.total_advanced) / 100).toFixed(2)}
                            </span>
                          </div>
                          <div className="stat-item">
                            <span className="stat-label"><User size={14} /> Status</span>
                            <span className={`badge ${employeeProfile.active ? "badge-active" : "badge-inactive"}`}>
                              {employeeProfile.active ? "Active" : "Inactive"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Request Advance Form */}
                    <div className="card">
                      <h3 className="card-title">
                        <ArrowRightLeft size={18} style={{ color: "var(--color-primary)" }} />
                        Request Salary Advance
                      </h3>

                      {employeeProfile.outstanding > BigInt(0) ? (
                        <div className="alert-box danger">
                          <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                          <div>
                            <strong>Draw limit locked.</strong> You have an outstanding advance balance of <strong>${(Number(employeeProfile.outstanding) / 100).toFixed(2)}</strong>. This balance must be repaid in full via employer payroll deduction before you can request a new advance.
                          </div>
                        </div>
                      ) : (
                        <form onSubmit={handleRequestAdvance}>
                          <div className="form-group">
                            <label className="form-label">Advance Request Amount (USD)</label>
                            <div style={{ position: "relative" }}>
                              <span style={{ position: "absolute", left: "1rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}>$</span>
                              <input
                                type="number"
                                step="0.01"
                                className="form-input"
                                placeholder="0.00"
                                value={advanceAmountInput}
                                onChange={(e) => setAdvanceAmountInput(e.target.value)}
                                style={{ paddingLeft: "2rem" }}
                                max={maxEmployeeAdvance}
                                min="0.01"
                              />
                            </div>
                            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.35rem", display: "block" }}>
                              Maximum available to draw now: <strong>${maxEmployeeAdvance.toFixed(2)}</strong> ({(employeeProfile.advance_cap_bps / 100).toFixed(1)}% of your accrued ${tickingUsdEarned.toFixed(2)})
                            </span>
                          </div>

                          <button 
                            type="submit" 
                            className="btn btn-primary" 
                            style={{ width: "100%" }}
                            disabled={submittingRequest || !connected || parseFloat(advanceAmountInput) <= 0 || parseFloat(advanceAmountInput) > maxEmployeeAdvance}
                          >
                            {submittingRequest ? "Submitting Request..." : "Submit Advance Request"}
                          </button>
                        </form>
                      )}
                    </div>

                    {/* Requests History Timeline */}
                    <div className="card">
                      <h3 className="card-title">
                        <Clock size={18} style={{ color: "var(--color-info)" }} />
                        Request History
                      </h3>
                      {employeeRequests.length > 0 ? (
                        <div className="timeline">
                          {employeeRequests.map((req) => (
                            <div className="timeline-item" key={req.id}>
                              <div className="timeline-dot-wrapper">
                                <div className={`timeline-indicator ${req.status === 0 ? "pending" : req.status === 1 ? "approved" : "rejected"}`}></div>
                                <div className="timeline-line"></div>
                              </div>
                              <div className="timeline-content">
                                <div>
                                  <span className="timeline-amount">${(Number(req.amount) / 100).toFixed(2)}</span>
                                  <div className="timeline-date">
                                    Request #{req.id} • {new Date(Number(req.created_ts) * 1000).toLocaleString()}
                                  </div>
                                </div>
                                <div>
                                  {getStatusBadge(req.status)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ textAlign: "center", padding: "2rem 0", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                          No advance requests submitted yet.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* TAB CONTENT: EMPLOYER DASHBOARD */}
            {activeTab === "employer" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                
                {/* Register New Employee Form */}
                <div className="card">
                  <h3 className="card-title">
                    <UserCheck size={18} style={{ color: "var(--color-success)" }} />
                    Register New Employee
                  </h3>
                  <form onSubmit={handleRegisterEmployee}>
                    <div className="form-group">
                      <label className="form-label">Employee Public Key (Stellar Address)</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="GD..."
                        value={regEmployeeAddress}
                        onChange={(e) => setRegEmployeeAddress(e.target.value)}
                        required
                      />
                    </div>

                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label">Gross Monthly Salary (USD)</label>
                        <div style={{ position: "relative" }}>
                          <span style={{ position: "absolute", left: "1rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}>$</span>
                          <input
                            type="number"
                            step="0.01"
                            className="form-input"
                            placeholder="3000.00"
                            value={regMonthlySalary}
                            onChange={(e) => setRegMonthlySalary(e.target.value)}
                            style={{ paddingLeft: "2rem" }}
                            required
                          />
                        </div>
                      </div>
                      
                      <div className="form-group">
                        <label className="form-label">Advance Draw Cap (%)</label>
                        <select 
                          className="form-input" 
                          value={regCapBps} 
                          onChange={(e) => setRegCapBps(e.target.value)}
                          style={{ background: "rgba(4, 5, 11, 0.7)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", padding: "0.75rem 1rem", height: "46px" }}
                        >
                          <option value="1000">10% of accrued wages</option>
                          <option value="2500">25% of accrued wages</option>
                          <option value="5000">50% of accrued wages (Default)</option>
                          <option value="7500">75% of accrued wages</option>
                          <option value="9000">90% of accrued wages</option>
                        </select>
                      </div>
                    </div>

                    <button 
                      type="submit" 
                      className="btn btn-success" 
                      style={{ width: "100%" }}
                      disabled={submittingReg || !connected}
                    >
                      {submittingReg ? "Registering Employee..." : "Register Employee"}
                    </button>
                  </form>
                </div>

                {/* Manage Worker Portal */}
                <div className="card">
                  <h3 className="card-title">
                    <Settings size={18} style={{ color: "var(--color-primary)" }} />
                    Manage Employee Advances
                  </h3>
                  <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="GD..."
                      value={manageEmployeeAddress}
                      onChange={(e) => setManageEmployeeAddress(e.target.value)}
                    />
                    <button 
                      className="btn btn-primary"
                      onClick={() => handleQueryManageProfile()}
                      disabled={loadingManage}
                    >
                      {loadingManage ? "Loading..." : "Load Profile"}
                    </button>
                  </div>

                  {manageProfile && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", borderTop: "1px solid var(--border-color)", paddingTop: "1.25rem" }}>
                      
                      {/* Brief Stats */}
                      <div className="grid-2">
                        <div className="stat-item">
                          <span className="stat-label">Outstanding Owed</span>
                          <span className="stat-value mono" style={{ color: "var(--color-danger)" }}>
                            ${(Number(manageProfile.outstanding) / 100).toFixed(2)}
                          </span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">Registered Employer</span>
                          <span className="stat-value" style={{ fontSize: "0.8rem" }}>
                            {shortenAddress(manageProfile.employer)}
                          </span>
                        </div>
                      </div>

                      {/* Repay Advance Form */}
                      {manageProfile.outstanding > BigInt(0) && (
                        <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid var(--border-color)", padding: "1rem", borderRadius: "10px" }}>
                          <h4 style={{ fontSize: "0.95rem", marginBottom: "0.75rem", color: "var(--text-primary)" }}>
                            Log Payroll Repayment / Deduction
                          </h4>
                          <form onSubmit={handleRepayAdvance}>
                            <div style={{ display: "flex", gap: "0.5rem" }}>
                              <div style={{ position: "relative", flex: 1 }}>
                                <span style={{ position: "absolute", left: "1rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}>$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  className="form-input"
                                  placeholder="0.00"
                                  value={repayAmountInput}
                                  onChange={(e) => setRepayAmountInput(e.target.value)}
                                  style={{ paddingLeft: "2rem" }}
                                  max={Number(manageProfile.outstanding) / 100}
                                  required
                                />
                              </div>
                              <button 
                                type="submit" 
                                className="btn btn-success"
                                disabled={submittingRepay || !connected}
                              >
                                {submittingRepay ? "Recording..." : "Record Repayment"}
                              </button>
                            </div>
                            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.35rem", display: "block" }}>
                              Records a salary deduction. Max repayment: <strong>${(Number(manageProfile.outstanding) / 100).toFixed(2)}</strong>.
                            </span>
                          </form>
                        </div>
                      )}

                      {/* Pending Approvals Section */}
                      <div>
                        <h4 style={{ fontSize: "0.95rem", marginBottom: "0.75rem" }}>
                          Review Pending Advance Requests
                        </h4>
                        {manageRequests.filter((r) => r.status === 0).length > 0 ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                            {manageRequests.filter((r) => r.status === 0).map((req) => (
                              <div 
                                key={req.id} 
                                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.85rem", background: "rgba(245, 158, 11, 0.04)", border: "1px solid rgba(245, 158, 11, 0.2)", borderRadius: "8px" }}
                              >
                                <div>
                                  <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "var(--color-warning)" }}>
                                    ${(Number(req.amount) / 100).toFixed(2)}
                                  </div>
                                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.15rem" }}>
                                    Request #{req.id} • {new Date(Number(req.created_ts) * 1000).toLocaleDateString()}
                                  </div>
                                </div>
                                <div style={{ display: "flex", gap: "0.5rem" }}>
                                  <button 
                                    className="btn btn-success" 
                                    style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
                                    onClick={() => handleApproveRequest(req.id)}
                                    disabled={actionInProgress[req.id]}
                                  >
                                    Approve
                                  </button>
                                  <button 
                                    className="btn btn-danger" 
                                    style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
                                    onClick={() => handleRejectRequest(req.id)}
                                    disabled={actionInProgress[req.id]}
                                  >
                                    Reject
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ textAlign: "center", padding: "1.5rem", border: "1px dashed var(--border-color)", borderRadius: "8px", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                            No pending requests for this employee.
                          </div>
                        )}
                      </div>

                      {/* Request History List */}
                      <div>
                        <h4 style={{ fontSize: "0.95rem", marginBottom: "0.5rem" }}>All Requests History</h4>
                        {manageRequests.length > 0 ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                            {manageRequests.map((req) => (
                              <div key={req.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.6rem 0.85rem", background: "rgba(255,255,255,0.01)", border: "1px solid var(--border-color)", borderRadius: "6px", fontSize: "0.85rem" }}>
                                <div>
                                  <span style={{ fontWeight: 600 }}>Request #{req.id}</span>
                                  <span style={{ marginLeft: "0.5rem", color: "var(--text-secondary)" }}>
                                    ${(Number(req.amount) / 100).toFixed(2)}
                                  </span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                    {new Date(Number(req.created_ts) * 1000).toLocaleDateString()}
                                  </span>
                                  {getStatusBadge(req.status)}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "0.5rem" }}>
                            No requests found.
                          </div>
                        )}
                      </div>

                    </div>
                  )}
                </div>

              </div>
            )}

            {/* TRANSACTION LOG TERMINAL */}
            <div className="terminal-card">
              <div className="terminal-header">
                <div className="terminal-dots">
                  <div className="terminal-dot red"></div>
                  <div className="terminal-dot yellow"></div>
                  <div className="terminal-dot green"></div>
                </div>
                <div className="terminal-title">Stellar Soroban Live logs</div>
                <div style={{ width: "42px" }}></div>
              </div>
              
              <div className="terminal-logs">
                {logs.map((log, idx) => (
                  <div key={idx} className={`log-item ${log.type}`}>
                    <span className="log-time">[{log.timestamp}]</span>
                    <span>{log.message}</span>
                    {log.hash && (
                      <a 
                        href={`https://stellar.expert/explorer/testnet/tx/${log.hash}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="log-link"
                      >
                        [Explorer]
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>
      </main>

      {/* FOOTER */}
      <footer className="footer">
        <div className="container" style={{ padding: "0 1.5rem" }}>
          <p>© {new Date().getFullYear()} PayFlow Salary Advance Portal. Powered by Stellar Soroban smart contracts.</p>
          <p style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Smart Contract: <a href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`} target="_blank" rel="noreferrer" className="footer-link" style={{ fontFamily: "var(--font-mono)" }}>{CONTRACT_ID}</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
