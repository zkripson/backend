# ZK Battleship: Integration Flow

This document outlines the comprehensive integration flow between the frontend, backend, and blockchain for the ZK Battleship game, detailing each component's responsibilities and the specific contract functions to call at each step.

## Component Responsibilities

### Frontend (Client)
- User interface and interactions
- Board visualization and game controls
- Wallet connection and transaction signing
- **ZK proof generation** (critical for privacy)
- Direct smart contract interactions

### Backend (Cloudflare)
- Session management and matchmaking
- Player profiles and game history
- Invitation system with shareable links
- Real-time communication via WebSockets
- Contract event monitoring

### Blockchain (MegaETH)
- Game logic enforcement
- Cryptographic verification of ZK proofs
- Authoritative game state
- Mini-block processing (~10ms latency)

## Detailed Integration Flow

### 1. Game Creation & Invitation

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐
│ Player 1 │         │   Backend   │         │  MegaETH    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 1. Create Invite    │                       │
     │─────────────────────►                       │
     │                     │                       │
     │                     │ 2. Create Session     │
     │                     │                       │
     │ 3. Invite+Session Created                   │
     │◄─────────────────────                       │
     │                     │                       │
     │ 4. Share Invite Link│                       │
     │                     │                       │
┌────┴────┐         ┌─────┴──────┐         ┌──────┴──────┐
│ Player 2 │         │   Backend   │         │  MegaETH    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 5. Accept Invite    │                       │
     │─────────────────────►                       │
     │                     │                       │
     │ 6. Join Session     │                       │
     │◄─────────────────────                       │
     │                     │                       │
```

**Contract Functions: None yet**

**Backend API Calls:**
- `POST /api/invites/create` - Player 1 creates invite (session is automatically created)
- `POST /api/invites/accept` - Player 2 accepts invite (joins existing session)

**Implementation Details:**
1. Player 1 creates an invite via the backend
2. Backend automatically creates a game session and associates it with the invitation
3. Player 1 receives a shareable invite code/link
4. Player 1 shares link with Player 2 via messaging, social media, etc.
5. Player 2 opens the invite link and accepts it
6. Backend adds Player 2 to the existing session and notifies both players
7. Both players connect to the session via WebSocket to receive real-time updates

### 2. Contract Creation & Registration

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐
│ Player 1 │         │   Backend   │         │  MegaETH    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ WebSocket: player_joined notification       │
     │◄─────────────────────                       │
     │                     │                       │
     │ 1. Create Game Contract                     │
     │─────────────────────────────────────────────►
     │                     │                       │
     │ 2. Contract Created │                       │
     │◄─────────────────────────────────────────────
     │                     │                       │
     │ 3. Register Contract with Session           │
     │─────────────────────►                       │
     │                     │                       │
     │ 4. Contract Registered                      │
     │◄─────────────────────                       │
     │                     │                       │
┌────┴────┐         ┌─────┴──────┐         ┌──────┴──────┐
│ Player 2 │         │   Backend   │         │  MegaETH    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 5. WebSocket: contract_registered notification
     │◄─────────────────────                       │
     │                     │                       │
```

**Contract Functions:**
- `GameFactory.createGame(address opponent)` - Called by Player 1

**Backend API Calls:**
- `POST /api/contracts/register-game` - Register game contract with backend

**Implementation Details:**
1. When Player 2 joins session, Player 1 automatically receives WebSocket notification
2. Player 1's client calls `GameFactory.createGame(player2Address)` on MegaETH
3. MegaETH deploys a new BattleshipGameProxy with current implementation
4. Player 1's client registers the new contract with backend via API call
5. Backend updates session with contract address and notifies both players

### 3. Board Placement & Game Setup

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐
│ Player 1 │         │   Backend   │         │  MegaETH    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 1. Place Ships (UI) │                       │
     │                     │                       │
     │ 2. Generate Board Commitment + ZK Proof     │
     │                     │                       │
     │ 3. Submit Board+Proof                       │
     │─────────────────────────────────────────────►
     │                     │                       │
     │ 4. Board Submitted Event                    │
     │◄─────────────────────────────────────────────
     │                     │                       │
     │                     │ 5. Monitor Events     │
     │                     │◄──────────────────────
     │                     │                       │
     │ 6. WebSocket: board_submitted notification  │
     │◄─────────────────────                       │
     │                     │                       │
┌────┴────┐         ┌─────┴──────┐         ┌──────┴──────┐
│ Player 2 │         │   Backend   │         │  MegaETH    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 7. Place Ships (UI) │                       │
     │                     │                       │
     │ 8. Generate Board Commitment + ZK Proof     │
     │                     │                       │
     │ 9. Submit Board+Proof                       │
     │─────────────────────────────────────────────►
     │                     │                       │
     │ 10. Board Submitted Event                   │
     │◄─────────────────────────────────────────────
     │                     │                       │
     │                     │ 11. Monitor Events    │
     │                     │◄──────────────────────
     │                     │                       │
     │ 12. Game Ready Notification (To Both Players)
     │◄─────────────────────                       │
     │                     │                       │
```

**Contract Functions:**
- `BattleshipGameImplementation.submitBoard(bytes32 boardCommitment, bytes calldata zkProof)` - Called by both players

**Implementation Details:**
1. Player places ships on their board via UI
2. Frontend generates a cryptographic commitment of the board:
   - Encodes the board state (ship positions)
   - Generates a random salt
   - Creates a commitment hash
3. Frontend generates ZK proof that board placement is valid:
   - Proves ships have correct sizes (5,4,3,3,2)
   - Proves no ships overlap
   - Proves all ships are within board boundaries
4. Player calls `submitBoard(boardCommitment, zkProof)` on the game contract
5. Game contract verifies the proof using ZKVerifier contract
6. Once both players submit valid boards, game automatically transitions to active state
7. Backend notifies both players that game is ready to start

### 4. Gameplay - Taking Shots & Responding

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐
│ Active   │         │   Backend   │         │  MegaETH    │
│ Player   │         │             │         │             │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 1. Select Target    │                       │
     │                     │                       │
     │ 2. Make Shot(x,y)   │                       │
     │─────────────────────────────────────────────►
     │                     │                       │
     │ 3. ShotFired Event  │                       │
     │◄─────────────────────────────────────────────
     │                     │                       │
     │                     │ 4. Monitor Event      │
     │                     │◄──────────────────────
     │                     │                       │
     │                     │ 5. Update Session     │
     │                     │                       │
┌────┴────┐         ┌─────┴──────┐         ┌──────┴──────┐
│ Target   │         │   Backend   │         │  MegaETH    │
│ Player   │         │             │         │             │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 6. Shot Notification│                       │
     │◄─────────────────────                       │
     │                     │                       │
     │ 7. Check Local Board & Determine Hit/Miss   │
     │                     │                       │
     │ 8. Generate ZK Proof│                       │
     │                     │                       │
     │ 9. Submit Result+Proof                      │
     │─────────────────────────────────────────────►
     │                     │                       │
     │ 10. ShotResult Event│                       │
     │◄─────────────────────────────────────────────
     │                     │                       │
     │                     │ 11. Monitor Event     │
     │                     │◄──────────────────────
     │                     │                       │
     │ 12. Update All Clients                      │
     │◄─────────────────────                       │
     │                     │                       │
```

**Contract Functions:**
- `BattleshipGameImplementation.makeShot(uint8 x, uint8 y)` - Called by active player
- `BattleshipGameImplementation.submitShotResult(uint8 x, uint8 y, bool isHit, bytes calldata zkProof)` - Called by target player

**Implementation Details:**
1. Active player selects target coordinates on UI
2. Frontend calls `makeShot(x, y)` on game contract
3. Contract emits `ShotFired` event and updates turn information
4. Backend monitors event via MegaETH Realtime API
5. Target player receives shot notification via WebSocket
6. Target player's frontend checks local board to determine hit/miss
7. Target player's frontend generates ZK proof to verify result:
   - Proves the shot result (hit/miss) is correct based on board state
   - Proves without revealing entire board
8. Target player's frontend calls `submitShotResult(x, y, isHit, zkProof)`
9. Game contract verifies proof and updates game state accordingly
10. Backend notifies both players of shot result
11. UI updates to reflect new game state

### 5. Game Completion & Rewards

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐         ┌────────┐
│ Winner   │         │   Backend   │         │  MegaETH    │         │  Base  │
└────┬────┘         └──────┬──────┘         └──────┬──────┘         └───┬────┘
     │                     │                       │                    │
     │ 1. Detect Win       │                       │                    │
     │                     │                       │                    │
     │ 2. Generate ZK Proof│                       │                    │
     │                     │                       │                    │
     │ 3. Verify Game End  │                       │                    │
     │─────────────────────────────────────────────►                    │
     │                     │                       │                    │
     │ 4. GameCompleted Event                      │                    │
     │◄─────────────────────────────────────────────                    │
     │                     │                       │                    │
     │                     │ 5. Monitor Event      │                    │
     │                     │◄──────────────────────                     │
     │                     │                       │                    │
     │ 6. Game Over Notification                   │                    │
     │◄─────────────────────                       │                    │
     │                     │                       │                    │
     │ 7. Claim Rewards    │                       │                    │
     │─────────────────────────────────────────────►                    │
     │                     │                       │                    │
     │ 8. RewardClaimed Event                      │                    │
     │◄─────────────────────────────────────────────                    │
     │                     │                       │                    │
     │                     │ 9. Mint Rewards via Backend                │
     │                     │────────────────────────────────────────────►
     │                     │                       │                    │
     │ 10. Reward Notification                     │                    │
     │◄────────────────────────────────────────────────────────────────┘
     │                     │                       │                    │
```

**Contract Functions:**
- `BattleshipGameImplementation.verifyGameEnd(bytes32 boardCommitment, bytes calldata zkProof)` - Called by player who wins
- `BattleshipGameImplementation.claimReward()` - Called by both players

**Implementation Details:**
1. When a player detects a win condition (all opponent ships sunk):
   - Frontend generates ZK proof of winning state
   - Calls `verifyGameEnd(boardCommitment, zkProof)`
   - Game contract verifies proof and transitions to completed state
2. Backend monitors `GameCompleted` event via Realtime API
3. Backend notifies both players of game completion via WebSocket
4. Players call `claimReward()` on game contract
5. Backend service mints $SHIP tokens on Base network for both players:
   - Winner receives participation + victory bonus
   - Loser receives participation reward only

## Frontend Contract Interface Guide

Here's a detailed guide to the contract functions that the frontend must call during gameplay:

### 1. Game Factory Contract

```solidity
// Create a new game with opponent
function createGame(address opponent) external returns (uint256 gameId)
```

**When to call:** Automatically after Player 2 joins the session
**Parameters:**
- `opponent`: Address of Player 2
**Returns:** The unique game ID

### 2. Game Implementation Contract

```solidity
// Submit board with ZK proof
function submitBoard(bytes32 boardCommitment, bytes calldata zkProof) external
```

**When to call:** After player places ships on board
**Parameters:**
- `boardCommitment`: Hash commitment of board state
- `zkProof`: Zero-knowledge proof that board is valid

```solidity
// Make a shot at opponent's board
function makeShot(uint8 x, uint8 y) external
```

**When to call:** On player's turn, when they select target coordinates
**Parameters:**
- `x`: X-coordinate (0-9)
- `y`: Y-coordinate (0-9)

```solidity
// Submit result of a shot with proof
function submitShotResult(
    uint8 x,
    uint8 y,
    bool isHit,
    bytes calldata zkProof
) external
```

**When to call:** After opponent makes a shot at player's board
**Parameters:**
- `x`: X-coordinate of the shot
- `y`: Y-coordinate of the shot
- `isHit`: Whether the shot hit a ship
- `zkProof`: Zero-knowledge proof that result is correct

```solidity
// Verify game end with proof
function verifyGameEnd(bytes32 boardCommitment, bytes calldata zkProof) external
```

**When to call:** When player detects win condition (all opponent ships sunk)
**Parameters:**
- `boardCommitment`: Commitment to opponent's board
- `zkProof`: Zero-knowledge proof that all ships are sunk

```solidity
// Claim rewards after game completion
function claimReward() external
```

**When to call:** After game completion is confirmed
**Parameters:** None

## ZK Proof Responsibilities

Zero-knowledge proofs are a critical component of ZK Battleship, allowing us to verify game integrity without revealing private information. Here's exactly who generates and verifies each proof:

### 1. Board Placement Proofs

**BOTH players generate their own board proofs:**

- **Player 1:**
  - Places ships on their board
  - Generates a commitment hash of their board layout
  - Creates ZK proof that their board is valid (correct ship sizes/placement)
  - Calls `submitBoard(boardCommitment1, zkProof1)`
  - Smart contract verifies the proof via ZKVerifier

- **Player 2:**
  - Does the same with their own board
  - Calls `submitBoard(boardCommitment2, zkProof2)`
  - Smart contract verifies their proof

### 2. Shot Result Proofs

**The TARGET player (person being shot at) generates the proof:**

- When it's Player 1's turn:
  - Player 1 calls `makeShot(x, y)` targeting Player 2's board
  - Player 2 receives the shot via WebSocket notification
  - Player 2 checks their local board to determine hit/miss
  - Player 2 generates ZK proof that result is truthful
  - Player 2 calls `submitShotResult(x, y, isHit, zkProof)`
  - Smart contract verifies Player 2's proof

- When it's Player 2's turn:
  - Player 2 calls `makeShot(x, y)` targeting Player 1's board
  - Player 1 receives the shot notification
  - Player 1 generates the proof about their board
  - Player 1 calls `submitShotResult(x, y, isHit, zkProof)`
  - Smart contract verifies Player 1's proof

### 3. Game End Proofs

**The WINNING player generates the proof:**

- If Player 1 wins:
  - Player 1 detects they've sunk all Player 2's ships
  - Player 1 generates ZK proof that all ships are sunk
  - Player 1 calls `verifyGameEnd(player2BoardCommitment, zkProof)`
  - Smart contract verifies the proof

- If Player 2 wins:
  - Player 2 detects they've sunk all Player 1's ships
  - Player 2 generates and submits the end-game proof
  - Smart contract verifies it

This approach maintains both privacy and game integrity:
- Only you know your own ship positions (private information)
- You must prove your responses are honest (verified by ZK proofs)
- Your opponent never sees your full board, only hit/miss results
- The smart contract verifies all proofs, acting as the trusted referee

## Optimized User Experience

To minimize user interactions:

1. **Streamlined Invitation Flow:**
   - Player 1 creates an invitation link in one click
   - Behind the scenes, a session is automatically created
   - Player 2 joins with a single click on the invite link
   - No manual session creation or management needed

2. **Automatic Contract Creation:**
   - When Player 2 joins a session, Player 1's client automatically calls `createGame()`
   - No manual confirmation needed for contract creation

3. **Streamlined Setup Flow:**
   - Player places ships via drag-and-drop or auto-placement
   - Single "Ready" button generates commitment, proof, and submits board

4. **One-Click Shooting:**
   - Player clicks on target grid cell
   - Frontend automatically calls `makeShot()` without confirmation

5. **Automatic Response to Shots:**
   - When shot received, frontend automatically:
     - Determines hit/miss
     - Generates proof
     - Submits result
   - No confirmation needed from user

6. **End Game Detection:**
   - Frontend automatically detects when all ships are sunk
   - Automatically submits game end verification
   - No manual claim needed

## Error Handling & Resilience

- **Transaction Failures:**
  - Implement automatic retry logic with exponential backoff
  - Show clear error messages and recovery options

- **Session Reconnection:**
  - Maintain local game state to recover after disconnections
  - Automatically reconnect to WebSocket and re-sync state

- **Proof Generation Failures:**
  - Cache proof inputs for retry
  - Allow manual triggering of proof generation if automatic process fails

By following this integration guide, you'll create a seamless experience where users focus on gameplay strategy rather than technical interactions.