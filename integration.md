# ZK Battleship: Integration Flow

Below I'll outline the complete integration flow between the frontend, backend, and blockchain for the ZK Battleship game, detailing each component's responsibilities and how they interact.

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

## Integration Flow

### 1. Game Creation & Invitation

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐
│ Frontend │         │   Backend   │         │  MegaETH    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 1. Connect Wallet   │                       │
     │◄──────────────────►│                       │
     │                     │                       │
     │ 2. Create Invite    │                       │
     │─────────────────────►                       │
     │                     │                       │
     │ 3. Generate Invite Code                     │
     │                     │                       │
     │ 4. Return Invite Link                       │
     │◄─────────────────────                       │
     │                     │                       │
     │ 5. Share Link       │                       │
     │                     │                       │
     │ (Second Player)     │                       │
     │ 6. Open Invite Link │                       │
     │─────────────────────►                       │
     │                     │                       │
     │ 7. Accept Invite    │                       │
     │─────────────────────►                       │
     │                     │                       │
     │ 8. Session Created  │                       │
     │◄─────────────────────                       │
     │                     │                       │
```

**Details:**
1. Player connects wallet to the frontend
2. Frontend calls `POST /api/invites/create` with player's address
3. Backend generates unique invite code (e.g., "ABC-DEF-GH")
4. Frontend receives invite link to share
5. Creator shares link via messaging, social media, etc.
6. Second player opens invite link
7. Second player's frontend accepts the invite via backend
8. Backend creates a game session and notifies both players

### 2. Game Start & Board Placement

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐
│ Frontend │         │   Backend   │         │  MegaETH    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 1. Place Ships (UI) │                       │
     │                     │                       │
     │ 2. Generate Board Commitment                │
     │                     │                       │
     │ 3. Sign Transaction │                       │
     │                     │                       │
     │ 4. Create Game Contract                     │
     │─────────────────────────────────────────────►
     │                     │                       │
     │ 5. Contract Created │                       │
     │◄─────────────────────────────────────────────
     │                     │                       │
     │ 6. Register Contract with Session           │
     │─────────────────────►                       │
     │                     │                       │
     │ 7. Session Updated  │                       │
     │◄─────────────────────                       │
     │                     │                       │
     │ 8. Generate ZK Proof│                       │
     │                     │                       │
     │ 9. Submit Board+Proof                       │
     │─────────────────────────────────────────────►
     │                     │                       │
     │ 10. Event Emitted   │                       │
     │◄─────────────────────────────────────────────
     │                     │                       │
     │                     │ 11. Monitor Events    │
     │                     │◄──────────────────────
     │                     │                       │
     │ 12. Game Ready Notification                 │
     │◄─────────────────────                       │
     │                     │                       │
```

**Details:**
1. Player places ships on their board via UI
2. Frontend generates a cryptographic commitment of the board
3. Player signs transaction with their wallet
4. Frontend calls `GameFactory.createGame(opponent)` on MegaETH
5. MegaETH contract deploys a new game instance (~10ms mini block)
6. Frontend registers contract with backend: `POST /api/contracts/register-game`
7. Backend updates session with contract address and game ID
8. Frontend generates ZK proof that board placement is valid
9. Frontend calls `Game.submitBoard(boardCommitment, zkProof)` on MegaETH
10. MegaETH contract emits events after verifying the proof
11. Backend monitors these events via MegaETH Realtime API
12. Both players receive WebSocket notifications that game is ready

### 3. Gameplay (Taking Shots & Responding)

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐
│ Player 1 │         │   Backend   │         │  MegaETH    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 1. Select Target    │                       │
     │                     │                       │
     │ 2. Make Shot        │                       │
     │─────────────────────────────────────────────►
     │                     │                       │
     │ 3. Shot Event       │                       │
     │◄─────────────────────────────────────────────
     │                     │                       │
     │                     │ 4. Monitor Shot Event │
     │                     │◄──────────────────────
     │                     │                       │
     │                     │ 5. Update Session     │
     │                     │                       │
┌────┴────┐         ┌─────┴──────┐         ┌──────┴──────┐
│ Player 2 │         │   Backend   │         │  MegaETH    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 6. Shot Notification│                       │
     │◄─────────────────────                       │
     │                     │                       │
     │ 7. Determine Hit/Miss                       │
     │                     │                       │
     │ 8. Generate ZK Proof│                       │
     │                     │                       │
     │ 9. Submit Result+Proof                      │
     │─────────────────────────────────────────────►
     │                     │                       │
     │ 10. Result Event    │                       │
     │◄─────────────────────────────────────────────
     │                     │                       │
     │                     │ 11. Monitor Result    │
     │                     │◄──────────────────────
     │                     │                       │
     │ 12. Update All Clients                      │
     │◄─────────────────────                       │
     │                     │                       │
```

**Details:**
1. Player 1 selects target coordinates in UI
2. Frontend calls `Game.makeShot(x, y)` on MegaETH
3. MegaETH contract emits `ShotFired` event (~10ms latency)
4. Backend monitors this event via MegaETH Realtime API
5. Backend updates session state (whose turn, timestamps)
6. Player 2 receives shot notification via WebSocket
7. Player 2's frontend checks local board to determine hit/miss
8. Player 2's frontend generates ZK proof of result validity
9. Player 2's frontend calls `Game.submitShotResult(x, y, isHit, zkProof)`
10. MegaETH contract emits `ShotResult` event after verifying proof
11. Backend monitors this result event
12. Backend notifies both players of the result via WebSocket

### 4. Game Completion & Rewards

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐         ┌────────┐
│ Player 1 │         │   Backend   │         │  MegaETH    │         │  Base  │
└────┬────┘         └──────┬──────┘         └──────┬──────┘         └───┬────┘
     │                     │                       │                    │
     │ 1. Detect Win       │                       │                    │
     │                     │                       │                    │
     │ 2. Generate ZK Proof│                       │                    │
     │                     │                       │                    │
     │ 3. Verify Game End  │                       │                    │
     │─────────────────────────────────────────────►                    │
     │                     │                       │                    │
     │ 4. Game Completed   │                       │                    │
     │◄─────────────────────────────────────────────                    │
     │                     │                       │                    │
     │                     │ 5. Monitor Game End   │                    │
     │                     │◄──────────────────────                     │
     │                     │                       │                    │
     │ 6. Game Over Notification                   │                    │
     │◄─────────────────────                       │                    │
     │                     │                       │                    │
     │ 7. Update Player Profiles                   │                    │
     │                     │                       │                    │
     │ 8. Claim Rewards    │                       │ 9. Message Bridge  │
     │─────────────────────────────────────────────┼────────────────────►
     │                     │                       │                    │
     │                     │                       │                    │ 10. Issue Tokens
     │                     │                       │                    │
     │ 11. Reward Notification                     │                    │
     │◄────────────────────────────────────────────────────────────────┘
     │                     │                       │                    │
```

**Details:**
1. Player 1 detects a win condition (all opponent ships sunk)
2. Frontend generates ZK proof verifying game ending state
3. Frontend calls `Game.verifyGameEnd(zkProof)` on MegaETH
4. MegaETH contract emits `GameCompleted` event after verification
5. Backend monitors this event via MegaETH Realtime API
6. Backend notifies both players of game completion via WebSocket
7. Backend updates player profiles with game outcome
8. Winner frontend initiates reward claim on MegaETH
9. MegaETH sends cross-chain message to Base network
10. Base network issues $SHIP tokens to winner (and participation tokens to both)
11. Players receive notification of reward issuance

## Technical Integration Details

### WebSocket Communication

The backend maintains WebSocket connections with players to provide real-time updates:

```javascript
// Frontend code
const socket = new WebSocket(`wss://api.zkbattleship.com/api/game-updates?sessionId=${sessionId}&address=${playerAddress}`);

socket.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'shot_fired':
      // Update UI to show opponent's shot
      break;
    case 'shot_result':
      // Update board with hit/miss result
      break;
    case 'game_over':
      // Show game completion screen
      break;
  }
});
```

### ZK Proof Generation

The frontend handles all ZK proof generation locally to maintain privacy:

```javascript
// Frontend pseudocode (actual implementation would use a ZK library)
async function generateShotResultProof(board, x, y, isHit) {
  // Create proof that:
  // 1. The shot result is honest based on actual board state
  // 2. Without revealing the entire board
  
  const inputs = {
    boardCommitment: boardCommitmentHash,
    x: x,
    y: y,
    isHit: isHit,
    salt: privateboardSalt
  };
  
  return await zkProver.generateProof('shotResult', inputs);
}
```

### MegaETH Event Monitoring

The backend uses MegaETH's Realtime API for low-latency event monitoring:

```javascript
// Backend code
const ws = new WebSocket("wss://megaeth-realtime.api");

ws.send(JSON.stringify({
  method: 'eth_subscribe',
  params: [
    'logs',
    {
      address: gameContractAddress,
      topics: [
        [
          // Event signatures for game events
          "0x3a9e47588c8175a500eec33e983974e93aec6c02d5ac9985b9e88e27e7a9b3cb", // ShotFired
          "0x9c5f5af1ca785633358f1aa606d964c927558ce3ce5e9e2e270c66c8a65fecd9", // ShotResult
          "0xf168bbf52af41088f8a709042ec88261e309c3c9e7c0f7b66773c27c5da78c57"  // GameCompleted
        ]
      ]
    }
  ],
  id: 1
}));
```

This integration flow maximizes the strengths of each component:
- **Frontend**: Handles user experience and ZK proof generation
- **Backend**: Manages sessions, player connections, and real-time communication
- **MegaETH**: Provides low-latency, authoritative game logic verification
- **Base**: Handles token economics and rewards