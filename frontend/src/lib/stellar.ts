import { Contract, TransactionBuilder, Networks, nativeToScVal, scValToNative, Account } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { isConnected, getAddress, signTransaction, requestAccess } from "@stellar/freighter-api";

export const CONTRACT_ID = "CD7VI2LYVGCLMMRYXYR3RPD3Z4Y2L7DNMUZCUX2MFRK3E23OIL2EUPNG";
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = Networks.TESTNET;

const server = new Server(RPC_URL);
const contract = new Contract(CONTRACT_ID);

export interface EmployeeData {
  employer: string;
  monthly_salary: bigint;
  advance_cap_bps: number;
  outstanding: bigint;
  total_advanced: bigint;
  last_accrual_ts: bigint;
  accrued_balance: bigint;
  active: boolean;
}

export interface AdvanceRequest {
  amount: bigint;
  status: number; // 0 = pending, 1 = approved, 2 = rejected
  created_ts: bigint;
}

export interface AdvanceRequestWithId extends AdvanceRequest {
  id: number;
}

// Check Freighter Connection and Get Wallet Address
export async function checkFreighter(requestPermission: boolean = false) {
  if (typeof window !== "undefined") {
    let attempts = 0;
    while (attempts < 6) {
      if ((window as any).freighterApi) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      attempts++;
    }
  }

  let connected = false;
  try {
    const res: any = await isConnected();
    connected = !!(res && (typeof res === "boolean" ? res : res.isConnected));
  } catch (e) {
    console.error("isConnected check failed:", e);
  }

  if (!connected && typeof window !== "undefined" && (window as any).freighterApi) {
    connected = true;
  }

  if (!connected) {
    return { connected: false, publicKey: "", isInstalled: false };
  }

  try {
    const result = requestPermission ? await requestAccess() : await getAddress();
    if (result.error) {
      console.warn("Freighter connection returned error:", result.error);
      return { connected: false, publicKey: "", isInstalled: true, error: result.error };
    }
    return { connected: !!result.address, publicKey: result.address || "", isInstalled: true };
  } catch (e: any) {
    console.error("Freighter call failed:", e);
    return { connected: false, publicKey: "", isInstalled: true, error: e.message || e };
  }
}

// Fetch XLM Balance from Horizon
export async function getXlmBalance(publicKey: string): Promise<string> {
  try {
    const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${publicKey}`);
    if (res.status === 404) return "0.0000";
    const data = await res.json();
    const native = data.balances?.find((b: any) => b.asset_type === "native");
    return native ? parseFloat(native.balance).toFixed(4) : "0.0000";
  } catch (e) {
    console.error("Error fetching balance:", e);
    return "0.0000";
  }
}

// Request Friendbot to fund Testnet Account
export async function fundWithFriendbot(publicKey: string): Promise<boolean> {
  try {
    const res = await fetch(`https://friendbot.stellar.org/?addr=${publicKey}`);
    return res.ok;
  } catch (e) {
    console.error("Error funding account:", e);
    return false;
  }
}

// Execute state-changing contract call via Freighter
export async function executeContractCall(
  functionName: string,
  args: any[],
  sourceAddress: string,
  onStatusUpdate?: (status: string, txHash?: string) => void
): Promise<any> {
  if (onStatusUpdate) onStatusUpdate("Loading account sequence from Stellar Testnet...");

  let account: Account;
  try {
    const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${sourceAddress}`);
    if (res.status === 404) {
      throw new Error("Your account does not exist on Stellar Testnet yet. Please fund it first.");
    }
    const data = await res.json();
    account = new Account(sourceAddress, data.sequence);
  } catch (e: any) {
    throw new Error(e.message || "Failed to load account sequence from Horizon.");
  }

  if (onStatusUpdate) onStatusUpdate("Building Soroban transaction call...");

  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(0)
    .build();

  if (onStatusUpdate) onStatusUpdate("Simulating transaction to estimate gas & footprint...");

  let preparedTx;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (e: any) {
    console.error("Simulation failed:", e);
    throw new Error(`Simulation failed: ${e.message || JSON.stringify(e)}`);
  }

  if (onStatusUpdate) onStatusUpdate("Requesting signature from Freighter wallet...");

  const xdr = preparedTx.toXDR();
  const signResult: any = await signTransaction(xdr, {
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  if (signResult.error) {
    throw new Error(`Freighter signing rejected: ${signResult.error}`);
  }

  const signedTxXdr = signResult.signedTxXdr || signResult;
  if (!signedTxXdr) {
    throw new Error("Freighter did not return a signed transaction.");
  }

  if (onStatusUpdate) onStatusUpdate("Submitting transaction to Stellar Testnet...");

  const parsedSignedTx = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
  const sendRes = await server.sendTransaction(parsedSignedTx);

  if (sendRes.status === "ERROR" || !sendRes.hash) {
    throw new Error(`Transaction submission failed: ${JSON.stringify(sendRes)}`);
  }

  const txHash = sendRes.hash;
  if (onStatusUpdate) onStatusUpdate("Polling transaction status...", txHash);
  
  let attempts = 0;
  const maxAttempts = 30;
  
  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const txStatus = await server.getTransaction(txHash);
    
    if (txStatus.status === "SUCCESS") {
      if (onStatusUpdate) onStatusUpdate("Transaction completed successfully!", txHash);
      return { ...txStatus, hash: txHash };
    } else if (txStatus.status === "FAILED") {
      console.error("Transaction failed on-chain:", txStatus);
      throw new Error(`Transaction execution failed. Check explorer for details.`);
    } else {
      attempts++;
    }
  }
  
  throw new Error("Transaction execution timed out. Please check the explorer.");
}

// Simulate read-only contract calls
export async function simulateContractCall(
  functionName: string,
  args: any[]
): Promise<any> {
  const dummyPublicKeyValid = "GA5TBCJIL6A7WGWNKTUOKYFPLQN7SM5JNAGB74WSAPIH3FHKAJPJPB6G";

  const tx = new TransactionBuilder(
    new Account(dummyPublicKeyValid, "0"),
    {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    }
  )
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(0)
    .build();

  try {
    const sim: any = await server.simulateTransaction(tx);
    if (sim.error) {
      throw new Error(`Simulation failed: ${sim.error}`);
    }
    const retval = sim.result?.retval;
    if (retval) {
      return scValToNative(retval);
    }
    return null;
  } catch (e: any) {
    console.error(`Simulation error for ${functionName}:`, e);
    throw e;
  }
}

// Smart Contract State-Changing Actions

export async function initContract(
  admin: string,
  onStatusUpdate?: (status: string, txHash?: string) => void
): Promise<any> {
  const args = [
    nativeToScVal(admin, { type: "address" })
  ];
  return executeContractCall("init", args, admin, onStatusUpdate);
}

export async function registerEmployee(
  employer: string,
  employee: string,
  monthlySalary: bigint,
  advanceCapBps: number,
  onStatusUpdate?: (status: string, txHash?: string) => void
): Promise<any> {
  const args = [
    nativeToScVal(employer, { type: "address" }),
    nativeToScVal(employee, { type: "address" }),
    nativeToScVal(monthlySalary, { type: "u64" }),
    nativeToScVal(advanceCapBps, { type: "u32" }),
  ];
  return executeContractCall("register_employee", args, employer, onStatusUpdate);
}

export async function requestAdvance(
  employee: string,
  amount: bigint,
  onStatusUpdate?: (status: string, txHash?: string) => void
): Promise<any> {
  const args = [
    nativeToScVal(employee, { type: "address" }),
    nativeToScVal(amount, { type: "u64" }),
  ];
  return executeContractCall("request_advance", args, employee, onStatusUpdate);
}

export async function approveAdvance(
  employer: string,
  employee: string,
  requestId: number,
  onStatusUpdate?: (status: string, txHash?: string) => void
): Promise<any> {
  const args = [
    nativeToScVal(employer, { type: "address" }),
    nativeToScVal(employee, { type: "address" }),
    nativeToScVal(requestId, { type: "u32" }),
  ];
  return executeContractCall("approve_advance", args, employer, onStatusUpdate);
}

export async function rejectAdvance(
  employer: string,
  employee: string,
  requestId: number,
  onStatusUpdate?: (status: string, txHash?: string) => void
): Promise<any> {
  const args = [
    nativeToScVal(employer, { type: "address" }),
    nativeToScVal(employee, { type: "address" }),
    nativeToScVal(requestId, { type: "u32" }),
  ];
  return executeContractCall("reject_advance", args, employer, onStatusUpdate);
}

export async function repayAdvance(
  employer: string,
  employee: string,
  amount: bigint,
  onStatusUpdate?: (status: string, txHash?: string) => void
): Promise<any> {
  const args = [
    nativeToScVal(employer, { type: "address" }),
    nativeToScVal(employee, { type: "address" }),
    nativeToScVal(amount, { type: "u64" }),
  ];
  return executeContractCall("repay_advance", args, employer, onStatusUpdate);
}

// Smart Contract Read-Only Queries

export async function queryEmployee(employee: string): Promise<EmployeeData | null> {
  const args = [nativeToScVal(employee, { type: "address" })];
  try {
    const raw = await simulateContractCall("get_employee", args);
    if (!raw) return null;

    return {
      employer: String(raw.employer),
      monthly_salary: BigInt(raw.monthly_salary ?? 0),
      advance_cap_bps: Number(raw.advance_cap_bps),
      outstanding: BigInt(raw.outstanding ?? 0),
      total_advanced: BigInt(raw.total_advanced ?? 0),
      last_accrual_ts: BigInt(raw.last_accrual_ts ?? 0),
      accrued_balance: BigInt(raw.accrued_balance ?? 0),
      active: Boolean(raw.active),
    };
  } catch (e) {
    console.error(`Error querying employee info for ${employee}:`, e);
    return null;
  }
}

export async function queryRequestCount(employee: string): Promise<number> {
  const args = [nativeToScVal(employee, { type: "address" })];
  try {
    const count = await simulateContractCall("request_count", args);
    return Number(count ?? 0);
  } catch (e) {
    console.error(`Error querying request count for ${employee}:`, e);
    return 0;
  }
}

export async function queryOutstanding(employee: string): Promise<bigint> {
  const args = [nativeToScVal(employee, { type: "address" })];
  try {
    const amt = await simulateContractCall("outstanding", args);
    return BigInt(amt ?? 0);
  } catch (e) {
    console.error(`Error querying outstanding for ${employee}:`, e);
    return BigInt(0);
  }
}

export async function queryRequest(employee: string, requestId: number): Promise<AdvanceRequest | null> {
  const args = [
    nativeToScVal(employee, { type: "address" }),
    nativeToScVal(requestId, { type: "u32" }),
  ];
  try {
    const raw = await simulateContractCall("get_request", args);
    if (!raw) return null;
    return {
      amount: BigInt(raw.amount ?? 0),
      status: Number(raw.status),
      created_ts: BigInt(raw.created_ts ?? 0),
    };
  } catch (e) {
    console.error(`Error querying request ${requestId} for ${employee}:`, e);
    return null;
  }
}

export async function queryAllRequests(employee: string): Promise<AdvanceRequestWithId[]> {
  try {
    const count = await queryRequestCount(employee);
    if (count === 0) return [];
    
    const promises = [];
    for (let id = 1; id <= count; id++) {
      promises.push(
        queryRequest(employee, id).then((req) => {
          if (!req) return null;
          return {
            ...req,
            id,
          } as AdvanceRequestWithId;
        })
      );
    }
    
    const results = await Promise.all(promises);
    return results.filter((r): r is AdvanceRequestWithId => r !== null).reverse();
  } catch (e) {
    console.error(`Error querying all requests for ${employee}:`, e);
    return [];
  }
}
