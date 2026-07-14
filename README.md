# payroll_advance

## Project Title
payroll_advance

## Project Description
Employees regularly run into short-term cash-flow gaps long before payday: an
unexpected medical bill, a family emergency, a deposit on a new apartment.
Traditional solutions — payday lenders, credit-card cash advances — are
expensive, slow, or both. `payroll_advance` is a Soroban smart contract that
lets an employee draw a portion of the salary they have *already earned but not
yet been paid*, with the employer reviewing and approving every request. The
advance is then automatically recovered from the next payroll run, so the
employee never owes a third-party lender and the employer keeps full control
of cash going out the door. Unlike peer-to-peer lending protocols, every flow
is anchored to a single employer–employee relationship: there is no pooled
liquidity, no collateral, and no interest — only an honest accounting of
salary that has accrued.

## Project Vision
Our long-term vision is to make on-chain payroll the default for the global
gig and remote-work economy. `payroll_advance` is the first building block of
that stack: a transparent, auditable record of every advance, approval, and
repayment between an employer and each of its workers. We envision a future
where the same primitives compose into recurring payroll streams, multi-party
employer DAOs, and cross-border salary payments, all settled on Stellar with
sub-second finality and negligible fees.

## Key Features
- **Employer-funded, employer-controlled** — every advance must be approved
  by the employee's registered employer before it counts as outstanding.
  No peer-to-peer lending, no third-party risk.
- **Time-weighted accrual** — the contract computes how much salary an
  employee has already earned since the last payroll cycle using the ledger
  timestamp, so advances are always backed by real, accrued wages.
- **Per-employee cap** — the employer sets a maximum advance percentage
  (basis points of accrued salary) at registration, defaulting to 50%.
  Employees cannot over-borrow against future earnings.
- **Request lifecycle** — every request moves through `pending → approved`
  or `pending → rejected`, with the full history stored on-chain for audit.
- **Payroll-driven repayment** — `repay_advance` records a deduction from the
  next payroll run; once the outstanding balance hits zero the accrual clock
  is reset and the employee is eligible for a new advance.
- **Event emission** — registration, requests, approvals, rejections, and
  repayments all publish Soroban events, making the contract fully
  indexable for dashboards and accounting back-ends.
- **Zero token transfers** — the contract is a pure ledger of obligations
  and is designed to be reconciled with the employer's token-based payroll
  system. This keeps the on-chain footprint small, the audit trail clean,
  and the contract safe to reason about.

## Contract

- **Network:** Stellar Testnet (Public)
- **Scope:** finance dApp — see `contracts/payroll_advance/src/lib.rs` for the full payroll_advance business logic.
- **Functions exposed:** see `Key Features` above and the `pub fn` list in `lib.rs`.
- **Contract ID:** `<to be deployed on Stellar Testnet>`
- **Explorer template:** `https://stellar.expert/explorer/testnet/contract/<to`
- **Screenshot of deployed contract on Stellar Expert:**
  `_(Screenshot of the contract page on Stellar Expert will appear here after deploy.)_`


## Future Scope
- **Token-denominated accounting** — switch the internal ledger from raw
  integer units to a configurable Stellar asset (USDC, a custom
  payroll-stablecoin, etc.) and integrate the Stellar `token` contract for
  real advance payouts and payroll deductions.
- **Recurring payroll streams** — compose `payroll_advance` with a
  `payroll_stream` contract so advances are debited continuously from the
  employee's salary stream rather than settled in a single `repay_advance`
  call.
- **Multi-employer / DAO payroll** — relax the `Employee.employer` field
  into a `Vec<Address>` so the same person can have multiple employers or
  be paid by a multisig / DAO treasury.
- **Mobile-first frontend** — ship a Freighter-wallet dApp that lets
  employees see their accrued balance, request an advance, and track
  repayment history from their phone.
- **Off-chain notifications** — index the emitted Soroban events and push
  push-notifications / emails to employees and employers when state changes
  (request submitted, approved, deducted, etc.).
- **Governance for defaults** — let the `admin` tune the default
  `advance_cap_bps` and the `SECONDS_IN_MONTH` constant via a governance
  vote, so the protocol can adapt to different jurisdictions and pay
  cadences (weekly, bi-weekly, semi-monthly).
- **Full unit-test suite** — port the manual test plan into `cargo test`
  with `testutils` and add property-based tests for the accrual math and
  the "one outstanding advance at a time" invariant.

## Profile

- **Name:** <!-- Fill github name -->
- **Project:** `payroll_advance` (finance)
- **Built with:** Soroban SDK 25, Rust, Stellar Testnet
