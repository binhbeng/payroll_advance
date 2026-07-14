#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

/// Maximum percentage (basis points, 0-10000) of accrued salary that an
/// employee may draw as an advance. Defaults to 5000 (50%).
const DEFAULT_ADVANCE_CAP_BPS: u32 = 5_000;

/// Seconds in a 30-day accrual month used for salary time-weighting.
const SECONDS_IN_MONTH: u64 = 30 * 24 * 60 * 60;

/// Status code for a newly created, not-yet-reviewed advance request.
const STATUS_PENDING: u32 = 0;
/// Status code for an employer-approved advance request that has been paid out.
const STATUS_APPROVED: u32 = 1;
/// Status code for an employer-rejected advance request.
const STATUS_REJECTED: u32 = 2;

/// Storage keys for the `PayrollAdvance` contract.
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// Contract administrator (the deployer / factory owner).
    Admin,
    /// Per-employee payroll record, keyed by employee `Address`.
    Employee(Address),
    /// A specific advance request, keyed by `(employee, request_id)`.
    Request(Address, u32),
    /// Monotonic counter of advance requests for an employee.
    RequestCount(Address),
}

/// On-chain record describing an employee and the state of their salary.
#[derive(Clone)]
#[contracttype]
pub struct Employee {
    /// Employer that registered the employee (authorised to approve / repay).
    pub employer: Address,
    /// Gross monthly salary, in the smallest token unit (e.g. stroops / cents).
    pub monthly_salary: u64,
    /// Maximum advance as basis points of accrued salary (0..=10_000).
    pub advance_cap_bps: u32,
    /// Outstanding (un-repaid) advance amount currently owed by the employee.
    pub outstanding: u64,
    /// Sum of all approved-but-unrepaid advance amounts (running ledger).
    pub total_advanced: u64,
    /// Last ledger timestamp the employee's accrued balance was updated.
    pub last_accrual_ts: u64,
    /// Salary that has accrued since the last payroll settlement.
    pub accrued_balance: u64,
    /// Whether the employee record is still active.
    pub active: bool,
}

/// Advance request submitted by an employee and acted on by the employer.
#[derive(Clone)]
#[contracttype]
pub struct AdvanceRequest {
    /// Requested advance amount.
    pub amount: u64,
    /// 0 = pending, 1 = approved, 2 = rejected.
    pub status: u32,
    /// Ledger timestamp the request was created.
    pub created_ts: u64,
}

/// `PayrollAdvance` is an employer-funded salary-advance protocol built on
/// Soroban. Distinct from peer-to-peer lending, every flow is anchored to a
/// single employer–employee relationship: the employee requests an advance on
/// salary they have already accrued, the employer reviews and approves it, and
/// the outstanding balance is repaid out of the next payroll run.
///
/// The contract does not move any tokens itself. It maintains an internal
/// ledger of obligations between employer and employee, designed to be
/// reconciled with the employer's off-chain or token-based payroll system.
#[contract]
pub struct PayrollAdvance;

#[contractimpl]
impl PayrollAdvance {
    /// Initialise the contract, recording `admin` as the protocol owner.
    /// May only be called once.
    pub fn init(env: Env, admin: Address) {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("PayrollAdvance: already initialised");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Register `employee` under `employer` with the given `monthly_salary`
    /// (smallest unit). `advance_cap_bps` is the maximum percentage of accrued
    /// salary the employee may request, expressed in basis points (0..=10_000).
    /// Requires authorisation from `employer`.
    pub fn register_employee(
        env: Env,
        employer: Address,
        employee: Address,
        monthly_salary: u64,
        advance_cap_bps: u32,
    ) {
        employer.require_auth();

        if monthly_salary == 0 {
            panic!("PayrollAdvance: salary must be positive");
        }
        if advance_cap_bps > 10_000 {
            panic!("PayrollAdvance: cap must be <= 10000 bps");
        }
        if employer == employee {
            panic!("PayrollAdvance: employer and employee must differ");
        }

        let key = DataKey::Employee(employee.clone());
        if env.storage().instance().has(&key) {
            panic!("PayrollAdvance: employee already registered");
        }

        let now = env.ledger().timestamp();
        let record = Employee {
            employer: employer.clone(),
            monthly_salary,
            advance_cap_bps,
            outstanding: 0,
            total_advanced: 0,
            last_accrual_ts: now,
            accrued_balance: 0,
            active: true,
        };
        env.storage().instance().set(&key, &record);
        env.storage()
            .instance()
            .set(&DataKey::RequestCount(employee.clone()), &0u32);

        // Emit a registration event tagged with a stable symbol for indexers.
        env.events().publish(
            (Symbol::new(&env, "register_employee"), employer, employee),
            monthly_salary,
        );
    }

    /// Employee-initiated request for a salary advance of `amount` (smallest
    /// unit). The amount must be positive, must not exceed the per-period
    /// advance cap on the employee's currently accrued salary, and the
    /// employee must not have any outstanding (un-repaid) advance from a
    /// previous request. Returns the new request id (monotonically increasing
    /// per employee).
    pub fn request_advance(env: Env, employee: Address, amount: u64) -> u32 {
        employee.require_auth();
        if amount == 0 {
            panic!("PayrollAdvance: amount must be positive");
        }

        let key = DataKey::Employee(employee.clone());
        let mut record: Employee = env
            .storage()
            .instance()
            .get(&key)
            .expect("PayrollAdvance: employee not registered");
        if !record.active {
            panic!("PayrollAdvance: employee inactive");
        }
        if record.outstanding > 0 {
            panic!("PayrollAdvance: existing advance must be repaid first");
        }

        // Roll the accrued balance forward to "now" using time-weighting.
        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(record.last_accrual_ts);
        let new_accrual = (record.monthly_salary.saturating_mul(elapsed))
            / SECONDS_IN_MONTH;
        record.accrued_balance = record.accrued_balance.saturating_add(new_accrual);
        record.last_accrual_ts = now;

        let cap_bps = if record.advance_cap_bps == 0 {
            DEFAULT_ADVANCE_CAP_BPS
        } else {
            record.advance_cap_bps
        };
        let max_advance = (record.accrued_balance.saturating_mul(cap_bps as u64)) / 10_000;
        if amount > max_advance {
            panic!("PayrollAdvance: amount exceeds advance cap");
        }

        // Persist the refreshed employee state BEFORE allocating the id, so a
        // failure here cannot leave a dangling request counter.
        env.storage().instance().set(&key, &record);

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RequestCount(employee.clone()))
            .unwrap_or(0);
        let new_id = count.saturating_add(1);

        let req = AdvanceRequest {
            amount,
            status: STATUS_PENDING,
            created_ts: now,
        };
        env.storage()
            .instance()
            .set(&DataKey::Request(employee.clone(), new_id), &req);
        env.storage()
            .instance()
            .set(&DataKey::RequestCount(employee.clone()), &new_id);

        env.events().publish(
            (
                Symbol::new(&env, "request_advance"),
                employee.clone(),
                new_id,
            ),
            amount,
        );

        new_id
    }

    /// Employer approves a previously submitted advance request. The
    /// `request_id` must correspond to a still-pending request; on approval,
    /// the requested amount is added to the employee's outstanding balance and
    /// the request status is flipped to `STATUS_APPROVED`. Requires
    /// authorisation from the registered employer.
    pub fn approve_advance(
        env: Env,
        employer: Address,
        employee: Address,
        request_id: u32,
    ) {
        employer.require_auth();

        let emp_key = DataKey::Employee(employee.clone());
        let mut record: Employee = env
            .storage()
            .instance()
            .get(&emp_key)
            .expect("PayrollAdvance: employee not registered");
        if record.employer != employer {
            panic!("PayrollAdvance: not the registered employer");
        }

        let req_key = DataKey::Request(employee.clone(), request_id);
        let mut req: AdvanceRequest = env
            .storage()
            .instance()
            .get(&req_key)
            .expect("PayrollAdvance: request not found");
        if req.status != STATUS_PENDING {
            panic!("PayrollAdvance: request not pending");
        }

        req.status = STATUS_APPROVED;
        record.outstanding = record.outstanding.saturating_add(req.amount);
        record.total_advanced = record.total_advanced.saturating_add(req.amount);
        // Reduce the accrued bucket by what we just advanced against it so the
        // employee cannot double-spend accrued salary on a second request.
        record.accrued_balance = record.accrued_balance.saturating_sub(req.amount);

        env.storage().instance().set(&req_key, &req);
        env.storage().instance().set(&emp_key, &record);

        env.events().publish(
            (
                Symbol::new(&env, "approve_advance"),
                employer,
                employee,
                request_id,
            ),
            req.amount,
        );
    }

    /// Employer rejects a pending advance request. Requires authorisation
    /// from the registered employer.
    pub fn reject_advance(
        env: Env,
        employer: Address,
        employee: Address,
        request_id: u32,
    ) {
        employer.require_auth();

        let emp_key = DataKey::Employee(employee.clone());
        let record: Employee = env
            .storage()
            .instance()
            .get(&emp_key)
            .expect("PayrollAdvance: employee not registered");
        if record.employer != employer {
            panic!("PayrollAdvance: not the registered employer");
        }

        let req_key = DataKey::Request(employee.clone(), request_id);
        let mut req: AdvanceRequest = env
            .storage()
            .instance()
            .get(&req_key)
            .expect("PayrollAdvance: request not found");
        if req.status != STATUS_PENDING {
            panic!("PayrollAdvance: request not pending");
        }
        req.status = STATUS_REJECTED;
        env.storage().instance().set(&req_key, &req);

        env.events().publish(
            (
                Symbol::new(&env, "reject_advance"),
                employer,
                employee,
                request_id,
            ),
            req.amount,
        );
    }

    /// Employer records a repayment of `amount` against the employee's
    /// outstanding advance, simulating a deduction from the next payroll
    /// cycle. If the repayment clears the outstanding balance, the accrued
    /// balance is reset to zero. Requires authorisation from the registered
    /// employer.
    pub fn repay_advance(
        env: Env,
        employer: Address,
        employee: Address,
        amount: u64,
    ) {
        employer.require_auth();
        if amount == 0 {
            panic!("PayrollAdvance: amount must be positive");
        }

        let emp_key = DataKey::Employee(employee.clone());
        let mut record: Employee = env
            .storage()
            .instance()
            .get(&emp_key)
            .expect("PayrollAdvance: employee not registered");
        if record.employer != employer {
            panic!("PayrollAdvance: not the registered employer");
        }
        if amount > record.outstanding {
            panic!("PayrollAdvance: amount exceeds outstanding");
        }

        record.outstanding -= amount;
        if record.outstanding == 0 {
            // Full settlement: reset the accrual clock for the next pay period.
            record.accrued_balance = 0;
            record.last_accrual_ts = env.ledger().timestamp();
        }
        env.storage().instance().set(&emp_key, &record);

        env.events().publish(
            (
                Symbol::new(&env, "repay_advance"),
                employer,
                employee,
            ),
            amount,
        );
    }

    /// Read-only view: return the employee's currently outstanding advance
    /// amount. Returns `0` for an unregistered employee.
    pub fn outstanding(env: Env, employee: Address) -> u64 {
        let key = DataKey::Employee(employee);
        env.storage()
            .instance()
            .get::<_, Employee>(&key)
            .map(|r| r.outstanding)
            .unwrap_or(0)
    }

    /// Read-only view: return the number of advance requests the employee
    /// has submitted (across all statuses). Returns `0` for an unregistered
    /// employee.
    pub fn request_count(env: Env, employee: Address) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::RequestCount(employee))
            .unwrap_or(0)
    }

    /// Read-only view: return the full employee payroll record, or panic if
    /// the employee has not been registered.
    pub fn get_employee(env: Env, employee: Address) -> Employee {
        env.storage()
            .instance()
            .get(&DataKey::Employee(employee))
            .expect("PayrollAdvance: employee not registered")
    }

    /// Read-only view: return the advance request identified by
    /// `(employee, request_id)`, or panic if the request does not exist.
    pub fn get_request(env: Env, employee: Address, request_id: u32) -> AdvanceRequest {
        env.storage()
            .instance()
            .get(&DataKey::Request(employee, request_id))
            .expect("PayrollAdvance: request not found")
    }
}
