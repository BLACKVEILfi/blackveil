// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title BLACKVEIL — a banking house for people and their agents, settled in USDG on Robinhood Chain.
/// @notice Accounts with handles, payments, requests to pay, and agent vaults that can only spend
///         inside a mandate this contract enforces. Holding the charter token ($VEIL) unlocks more
///         agent slots and short handles.
/// @dev No upgrade path, no pause, no way for the owner to move account, vault or pending funds.
///      The owner can only: set the charter token once, set the charter threshold, set the fee
///      recipient, and hand over ownership. Fees are fixed in code: 0.10 %, capped at 2 USDG.
contract BlackveilBank {
    // ───────────────────────────── constants ─────────────────────────────

    uint256 public constant FEE_BPS = 10; // 0.10 %
    uint256 public constant FEE_CAP = 2e6; // 2 USDG (6 decimals)
    uint256 public constant FREE_AGENT_SLOTS = 1;
    uint256 public constant CHARTER_AGENT_SLOTS = 10;
    uint256 public constant SHORT_HANDLE_MAX = 4; // handles of 3–4 characters need a charter
    uint256 public constant WINDOW = 1 days;

    enum Route {
        Settles,
        Queues,
        Refuses
    }

    enum Reason {
        None,
        Paused,
        Revoked,
        ZeroAmount,
        NotAllowlisted,
        OverPerPayment,
        OverDaily,
        InsufficientVault
    }

    uint8 internal constant ACTIVE = 1;
    uint8 internal constant PAUSED = 2;
    uint8 internal constant REVOKED = 3;

    uint8 internal constant OPEN = 1;
    uint8 internal constant DONE = 2; // request paid / pending approved
    uint8 internal constant CLOSED = 3; // request cancelled / pending rejected

    // kinds in Payment events
    uint8 public constant KIND_DIRECT = 0;
    uint8 public constant KIND_REQUEST = 1;
    uint8 public constant KIND_AGENT = 2;
    uint8 public constant KIND_APPROVED = 3;

    struct Agent {
        address owner;
        address signer;
        uint256 perPayment;
        uint256 perDay;
        uint256 reviewAbove;
        uint256 vault;
        uint256 spent;
        uint256 windowStart;
        uint8 status;
        bool allowlistOnly;
    }

    struct Pending {
        uint256 agentId;
        address to;
        uint256 amount;
        uint256 fee;
        bytes32 ref;
        bool toWallet;
        uint8 state;
    }

    struct Request {
        address payee;
        uint256 amount;
        uint64 expiry;
        uint8 state;
        bytes32 memo;
    }

    // ───────────────────────────── storage ─────────────────────────────

    IERC20 public immutable usdg;
    address public owner;
    address public feeRecipient;
    IERC20 public charterToken;
    uint256 public charterMin;
    uint256 public feesAccrued;

    mapping(address => uint256) public balanceOf;
    mapping(bytes32 => address) public handleOwner;
    mapping(address => string) public handleOf;

    Agent[] internal _agents; // id = index + 1
    mapping(address => uint256[]) internal _agentsOf;
    mapping(address => uint256) public liveAgents; // active + paused, i.e. slots in use
    mapping(uint256 => mapping(address => bool)) public allowed;

    Pending[] internal _pending; // id = index + 1
    Request[] internal _requests; // id = index + 1

    uint256 private _lock = 1;

    // ───────────────────────────── events ─────────────────────────────

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, address indexed to, uint256 amount);
    event Payment(
        address indexed from, address indexed to, uint256 amount, uint256 fee, bytes32 ref, uint8 kind, uint256 refId, bool toWallet
    );
    event HandleSet(address indexed account, string handle, string previous);

    event AgentCreated(uint256 indexed id, address indexed owner, address indexed signer);
    event MandateSet(uint256 indexed id, uint256 perPayment, uint256 perDay, uint256 reviewAbove, bool allowlistOnly);
    event AllowSet(uint256 indexed id, address indexed recipient, bool allowed);
    event AgentFunded(uint256 indexed id, uint256 amount);
    event AgentDefunded(uint256 indexed id, uint256 amount);
    event AgentStatus(uint256 indexed id, uint8 status);
    event SignerRotated(uint256 indexed id, address indexed signer);
    event AgentRefused(uint256 indexed id, address indexed to, uint256 amount, Reason reason, bytes32 ref);
    event Queued(uint256 indexed pendingId, uint256 indexed agentId, address indexed to, uint256 amount, bytes32 ref);
    event Approved(uint256 indexed pendingId);
    event Rejected(uint256 indexed pendingId);

    event RequestCreated(uint256 indexed id, address indexed payee, uint256 amount, uint64 expiry, bytes32 memo);
    event RequestCancelled(uint256 indexed id);

    event CharterTokenSet(address token);
    event CharterMinSet(uint256 amount);
    event FeeRecipientSet(address recipient);
    event OwnershipTransferred(address indexed previous, address indexed next);
    event FeesSwept(address indexed to, uint256 amount);

    // ───────────────────────────── errors ─────────────────────────────

    error NotOwner();
    error NotAgentOwner();
    error NotSigner();
    error Reentrant();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance();
    error InsufficientVault();
    error BadHandle();
    error HandleTaken();
    error CharterRequired();
    error NoHandle();
    error NoSlot();
    error UnknownAgent();
    error UnknownPending();
    error UnknownRequest();
    error NotOpen();
    error Expired();
    error AgentNotLive();
    error AlreadySet();
    error TransferFailed();

    // ───────────────────────────── modifiers ─────────────────────────────

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrant();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IERC20 usdg_, address owner_, address feeRecipient_) {
        if (address(usdg_) == address(0) || owner_ == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        usdg = usdg_;
        owner = owner_;
        feeRecipient = feeRecipient_;
        emit OwnershipTransferred(address(0), owner_);
        emit FeeRecipientSet(feeRecipient_);
    }

    // ───────────────────────────── views ─────────────────────────────

    function feeFor(uint256 amount) public pure returns (uint256) {
        uint256 f = (amount * FEE_BPS) / 10_000;
        return f > FEE_CAP ? FEE_CAP : f;
    }

    function hasCharter(address account) public view returns (bool) {
        IERC20 t = charterToken;
        if (address(t) == address(0)) return false;
        return t.balanceOf(account) >= charterMin;
    }

    function agentSlots(address account) public view returns (uint256) {
        return hasCharter(account) ? CHARTER_AGENT_SLOTS : FREE_AGENT_SLOTS;
    }

    function resolve(string calldata handle) external view returns (address) {
        return handleOwner[keccak256(bytes(handle))];
    }

    function agentCount() external view returns (uint256) {
        return _agents.length;
    }

    function pendingCount() external view returns (uint256) {
        return _pending.length;
    }

    function requestCount() external view returns (uint256) {
        return _requests.length;
    }

    function agent(uint256 id) external view returns (Agent memory a) {
        a = _agent(id);
        if (block.timestamp >= a.windowStart + WINDOW) a.spent = 0; // report what the current window has spent
    }

    function agentsOf(address account) external view returns (uint256[] memory) {
        return _agentsOf[account];
    }

    function pending(uint256 id) external view returns (Pending memory) {
        if (id == 0 || id > _pending.length) revert UnknownPending();
        return _pending[id - 1];
    }

    function request(uint256 id) external view returns (Request memory) {
        if (id == 0 || id > _requests.length) revert UnknownRequest();
        return _requests[id - 1];
    }

    /// @notice What would happen if the agent asked to pay `amount` to `to` right now.
    function routeFor(uint256 id, address to, uint256 amount) public view returns (Route, Reason) {
        Agent storage a = _agent(id);
        if (a.status == REVOKED) return (Route.Refuses, Reason.Revoked);
        if (a.status == PAUSED) return (Route.Refuses, Reason.Paused);
        if (amount == 0) return (Route.Refuses, Reason.ZeroAmount);
        if (a.allowlistOnly && !allowed[id][to]) return (Route.Refuses, Reason.NotAllowlisted);
        if (amount > a.perPayment) return (Route.Refuses, Reason.OverPerPayment);
        if (a.vault < amount + feeFor(amount)) return (Route.Refuses, Reason.InsufficientVault);
        if (amount > a.reviewAbove) return (Route.Queues, Reason.None);
        uint256 spentNow = block.timestamp >= a.windowStart + WINDOW ? 0 : a.spent;
        if (spentNow + amount > a.perDay) return (Route.Refuses, Reason.OverDaily);
        return (Route.Settles, Reason.None);
    }

    // ───────────────────────────── handles ─────────────────────────────

    /// @notice Claim or change your handle. Lowercase a–z, 0–9 and inner hyphens, 3–20 characters.
    ///         Handles of 3–4 characters need a charter. The previous handle is released.
    function setHandle(string calldata handle) external {
        bytes memory b = bytes(handle);
        if (!_validHandle(b)) revert BadHandle();
        if (b.length <= SHORT_HANDLE_MAX && !hasCharter(msg.sender)) revert CharterRequired();
        bytes32 key = keccak256(b);
        address holder = handleOwner[key];
        if (holder == msg.sender) return;
        if (holder != address(0)) revert HandleTaken();
        string memory previous = handleOf[msg.sender];
        if (bytes(previous).length != 0) delete handleOwner[keccak256(bytes(previous))];
        handleOwner[key] = msg.sender;
        handleOf[msg.sender] = handle;
        emit HandleSet(msg.sender, handle, previous);
    }

    function releaseHandle() external {
        string memory previous = handleOf[msg.sender];
        if (bytes(previous).length == 0) revert NoHandle();
        delete handleOwner[keccak256(bytes(previous))];
        delete handleOf[msg.sender];
        emit HandleSet(msg.sender, "", previous);
    }

    function _validHandle(bytes memory b) internal pure returns (bool) {
        uint256 n = b.length;
        if (n < 3 || n > 20) return false;
        if (b[0] == "-" || b[n - 1] == "-") return false;
        for (uint256 i; i < n; ++i) {
            bytes1 c = b[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-";
            if (!ok) return false;
        }
        return true;
    }

    // ───────────────────────────── account ─────────────────────────────

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _pull(msg.sender, amount);
        balanceOf[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount, address to) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = balanceOf[msg.sender];
        if (bal < amount) revert InsufficientBalance();
        balanceOf[msg.sender] = bal - amount;
        _push(to, amount);
        emit Withdrawn(msg.sender, to, amount);
    }

    /// @notice Pay `amount` to `to`. The receiver gets the full amount; the fee is added on the payer.
    /// @param fromWallet pull amount + fee from your wallet (needs approval) instead of your bank balance
    /// @param toWallet send USDG straight to the receiver's wallet instead of crediting their bank balance
    function pay(address to, uint256 amount, bytes32 ref, bool fromWallet, bool toWallet) external nonReentrant {
        _pay(msg.sender, to, amount, ref, KIND_DIRECT, 0, fromWallet, toWallet);
    }

    function payHandle(string calldata handle, uint256 amount, bytes32 ref, bool fromWallet, bool toWallet)
        external
        nonReentrant
    {
        address to = handleOwner[keccak256(bytes(handle))];
        if (to == address(0)) revert NoHandle();
        _pay(msg.sender, to, amount, ref, KIND_DIRECT, 0, fromWallet, toWallet);
    }

    // ───────────────────────────── requests to pay ─────────────────────────────

    function createRequest(uint256 amount, uint64 expiry, bytes32 memo) external returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        if (expiry != 0 && expiry <= block.timestamp) revert Expired();
        _requests.push(Request({payee: msg.sender, amount: amount, expiry: expiry, state: OPEN, memo: memo}));
        id = _requests.length;
        emit RequestCreated(id, msg.sender, amount, expiry, memo);
    }

    function cancelRequest(uint256 id) external {
        Request storage r = _request(id);
        if (r.payee != msg.sender) revert NotOwner();
        if (r.state != OPEN) revert NotOpen();
        r.state = CLOSED;
        emit RequestCancelled(id);
    }

    function payRequest(uint256 id, bool fromWallet) external nonReentrant {
        Request storage r = _request(id);
        if (r.state != OPEN) revert NotOpen();
        if (r.expiry != 0 && block.timestamp > r.expiry) revert Expired();
        r.state = DONE;
        _pay(msg.sender, r.payee, r.amount, r.memo, KIND_REQUEST, id, fromWallet, false);
    }

    // ───────────────────────────── agents ─────────────────────────────

    /// @notice Give an agent its own vault. The agent's key can spend from the vault inside the mandate
    ///         and do nothing else: no withdrawals, no changing its limits, no rotating its own key.
    function createAgent(address signer, uint256 perPayment, uint256 perDay, uint256 reviewAbove, bool allowlistOnly)
        external
        returns (uint256 id)
    {
        if (signer == address(0)) revert ZeroAddress();
        if (liveAgents[msg.sender] >= agentSlots(msg.sender)) revert NoSlot();
        _agents.push(
            Agent({
                owner: msg.sender,
                signer: signer,
                perPayment: perPayment,
                perDay: perDay,
                reviewAbove: reviewAbove,
                vault: 0,
                spent: 0,
                windowStart: 0,
                status: ACTIVE,
                allowlistOnly: allowlistOnly
            })
        );
        id = _agents.length;
        _agentsOf[msg.sender].push(id);
        liveAgents[msg.sender] += 1;
        emit AgentCreated(id, msg.sender, signer);
        emit MandateSet(id, perPayment, perDay, reviewAbove, allowlistOnly);
    }

    function setMandate(uint256 id, uint256 perPayment, uint256 perDay, uint256 reviewAbove, bool allowlistOnly)
        external
    {
        Agent storage a = _owned(id);
        if (a.status == REVOKED) revert AgentNotLive();
        a.perPayment = perPayment;
        a.perDay = perDay;
        a.reviewAbove = reviewAbove;
        a.allowlistOnly = allowlistOnly;
        emit MandateSet(id, perPayment, perDay, reviewAbove, allowlistOnly);
    }

    function setAllowed(uint256 id, address recipient, bool ok) external {
        _owned(id);
        allowed[id][recipient] = ok;
        emit AllowSet(id, recipient, ok);
    }

    function fundAgent(uint256 id, uint256 amount) external {
        Agent storage a = _owned(id);
        if (a.status == REVOKED) revert AgentNotLive();
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balanceOf[msg.sender];
        if (bal < amount) revert InsufficientBalance();
        balanceOf[msg.sender] = bal - amount;
        a.vault += amount;
        emit AgentFunded(id, amount);
    }

    function defundAgent(uint256 id, uint256 amount) external {
        Agent storage a = _owned(id);
        if (amount == 0) revert ZeroAmount();
        if (a.vault < amount) revert InsufficientVault();
        a.vault -= amount;
        balanceOf[msg.sender] += amount;
        emit AgentDefunded(id, amount);
    }

    function pauseAgent(uint256 id, bool paused) external {
        Agent storage a = _owned(id);
        if (a.status == REVOKED) revert AgentNotLive();
        a.status = paused ? PAUSED : ACTIVE;
        emit AgentStatus(id, a.status);
    }

    /// @notice Revoke for good: the vault returns to your balance and the slot is freed.
    ///         Payments already waiting for review stay reserved until you approve or reject them.
    function revokeAgent(uint256 id) external {
        Agent storage a = _owned(id);
        if (a.status == REVOKED) revert AgentNotLive();
        a.status = REVOKED;
        liveAgents[msg.sender] -= 1;
        uint256 v = a.vault;
        if (v != 0) {
            a.vault = 0;
            balanceOf[msg.sender] += v;
            emit AgentDefunded(id, v);
        }
        emit AgentStatus(id, REVOKED);
    }

    function rotateSigner(uint256 id, address signer) external {
        Agent storage a = _owned(id);
        if (a.status == REVOKED) revert AgentNotLive();
        if (signer == address(0)) revert ZeroAddress();
        a.signer = signer;
        emit SignerRotated(id, signer);
    }

    /// @notice Called by the agent's own key. Settles inside the mandate, queues for review above the
    ///         review threshold, and otherwise records a refusal without moving funds.
    function agentPay(uint256 id, address to, uint256 amount, bytes32 ref, bool toWallet)
        external
        nonReentrant
        returns (Route route, uint256 pendingId)
    {
        Agent storage a = _agent(id);
        if (msg.sender != a.signer) revert NotSigner();
        if (to == address(0)) revert ZeroAddress();
        Reason reason;
        (route, reason) = routeFor(id, to, amount);
        if (route == Route.Refuses) {
            emit AgentRefused(id, to, amount, reason, ref);
            return (route, 0);
        }
        uint256 fee = feeFor(amount);
        a.vault -= amount + fee;
        if (route == Route.Queues) {
            _pending.push(
                Pending({agentId: id, to: to, amount: amount, fee: fee, ref: ref, toWallet: toWallet, state: OPEN})
            );
            pendingId = _pending.length;
            emit Queued(pendingId, id, to, amount, ref);
            return (route, pendingId);
        }
        if (block.timestamp >= a.windowStart + WINDOW) {
            a.windowStart = block.timestamp;
            a.spent = 0;
        }
        a.spent += amount;
        _settle(a.owner, to, amount, fee, ref, KIND_AGENT, id, toWallet);
    }

    function approve(uint256 pendingId) external nonReentrant {
        Pending storage p = _pendingOwned(pendingId);
        p.state = DONE;
        emit Approved(pendingId);
        _settle(msg.sender, p.to, p.amount, p.fee, p.ref, KIND_APPROVED, pendingId, p.toWallet);
    }

    function reject(uint256 pendingId) external {
        Pending storage p = _pendingOwned(pendingId);
        p.state = CLOSED;
        Agent storage a = _agents[p.agentId - 1];
        uint256 back = p.amount + p.fee;
        if (a.status == REVOKED) {
            balanceOf[msg.sender] += back; // a revoked agent holds nothing; the reserve goes home
        } else {
            a.vault += back;
        }
        emit Rejected(pendingId);
    }

    // ───────────────────────────── owner ─────────────────────────────

    function setCharterToken(IERC20 token) external onlyOwner {
        if (address(charterToken) != address(0)) revert AlreadySet();
        if (address(token) == address(0)) revert ZeroAddress();
        charterToken = token;
        emit CharterTokenSet(address(token));
    }

    function setCharterMin(uint256 amount) external onlyOwner {
        charterMin = amount;
        emit CharterMinSet(amount);
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    /// @notice Anyone may push accrued fees to the fee recipient.
    function sweepFees() external nonReentrant {
        uint256 f = feesAccrued;
        if (f == 0) revert ZeroAmount();
        feesAccrued = 0;
        _push(feeRecipient, f);
        emit FeesSwept(feeRecipient, f);
    }

    // ───────────────────────────── internals ─────────────────────────────

    function _pay(
        address from,
        address to,
        uint256 amount,
        bytes32 ref,
        uint8 kind,
        uint256 refId,
        bool fromWallet,
        bool toWallet
    ) internal {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 fee = feeFor(amount);
        if (fromWallet) {
            _pull(from, amount + fee);
        } else {
            uint256 bal = balanceOf[from];
            if (bal < amount + fee) revert InsufficientBalance();
            balanceOf[from] = bal - amount - fee;
        }
        _settle(from, to, amount, fee, ref, kind, refId, toWallet);
    }

    /// @dev amount + fee have already been taken from the payer's side.
    function _settle(
        address from,
        address to,
        uint256 amount,
        uint256 fee,
        bytes32 ref,
        uint8 kind,
        uint256 refId,
        bool toWallet
    ) internal {
        feesAccrued += fee;
        if (toWallet) _push(to, amount);
        else balanceOf[to] += amount;
        emit Payment(from, to, amount, fee, ref, kind, refId, toWallet);
    }

    function _agent(uint256 id) internal view returns (Agent storage) {
        if (id == 0 || id > _agents.length) revert UnknownAgent();
        return _agents[id - 1];
    }

    function _owned(uint256 id) internal view returns (Agent storage a) {
        a = _agent(id);
        if (a.owner != msg.sender) revert NotAgentOwner();
    }

    function _pendingOwned(uint256 id) internal view returns (Pending storage p) {
        if (id == 0 || id > _pending.length) revert UnknownPending();
        p = _pending[id - 1];
        if (_agents[p.agentId - 1].owner != msg.sender) revert NotAgentOwner();
        if (p.state != OPEN) revert NotOpen();
    }

    function _request(uint256 id) internal view returns (Request storage) {
        if (id == 0 || id > _requests.length) revert UnknownRequest();
        return _requests[id - 1];
    }

    function _pull(address from, uint256 amount) internal {
        uint256 before = usdg.balanceOf(address(this));
        _call(abi.encodeCall(IERC20.transferFrom, (from, address(this), amount)));
        if (usdg.balanceOf(address(this)) - before != amount) revert TransferFailed();
    }

    function _push(address to, uint256 amount) internal {
        _call(abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function _call(bytes memory data) internal {
        (bool ok, bytes memory ret) = address(usdg).call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
