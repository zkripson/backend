# ZK Battleship: Backend-Driven Integration Flow

This document outlines the comprehensive integration flow between the frontend, backend, and blockchain for the ZK Battleship game, where **all gameplay logic happens in the backend** and only game creation and final results are stored on-chain.

## Component Responsibilities

### Frontend (Client)
- User interface and game visualization
- Board setup and ship placement UI
- WebSocket connection for real-time updates
- REST API calls for game actions
- Wallet integration for contract interactions

### Backend (Cloudflare Workers)
- **All game logic** (ship placement, shot validation, hit detection)
- Session management and turn tracking
- 60-second turn timeouts and 10-minute game limits
- Real-time communication via WebSockets
- Player profiles and game history
- Invitation system with shareable links
- **Betting system** with USDC stakes and winner-takes-all payouts

### Blockchain (Base)
- **Game creation only** (GameFactory.createGame)
- **Final result submission** (winner, game stats)
- **Reward distribution** ($SHIP tokens)
- **Game registration** (linking on-chain game to backend session)
- **Betting contract** (BattleshipBetting) for USDC staking and payouts

## Detailed Integration Flow

### 1. Game Creation & Invitation

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐
│ Player 1 │         │   Backend   │         │  Base    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 1. Create Invite    │                       │
     │────────────────────►│                       │
     │                     │                       │
     │                     │ 2. Create Session     │
     │                     │   (Auto-created)      │
     │                     │                       │
     │ 3. Invite+Session Created                   │
     │◄────────────────────│                       │
     │                     │                       │
     │ 4. Share Invite Link│                       │
     │                     │                       │
┌────┴────┐         ┌─────┴──────┐         ┌──────┴──────┐
│ Player 2 │         │   Backend   │         │  Base    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 5. Accept Invite    │                       │
     │────────────────────►│                       │
     │                     │                       │
     │ 6. Join Session     │                       │
     │◄────────────────────│                       │
     │                     │                       │
```

**Implementation Details:**
1. Player 1 creates an invite via `POST /api/invites/create`
2. **Backend automatically creates a game session** and associates it with the invitation
3. Player 1 receives a shareable invite code/link
4. Player 2 accepts the invite, automatically joining the session
5. Both players connect via WebSocket for real-time updates

### 1.5 Betting Game Creation (Optional)

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐
│ Player 1 │         │   Backend   │         │  Base    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 1. Create Betting Invite                    │
     │   (with stake amount)                       │
     │────────────────────►│                       │
     │                     │ 2. Create Betting     │
     │                     │    Invite On-chain    │
     │                     │──────────────────────►│
     │                     │                       │
     │ 3. Betting Invite Created                   │
     │◄────────────────────│                       │
     │                     │                       │
┌────┴────┐         ┌─────┴──────┐         ┌──────┴──────┐
│ Player 2 │         │   Backend   │         │  Base    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 4. Accept Betting   │                       │
     │────────────────────►│                       │
     │                     │ 5. Accept On-chain   │
     │                     │──────────────────────►│
     │                     │                       │
     │                     │ 6. Create Game from  │
     │                     │    Betting Invite    │
     │                     │──────────────────────►│
     │                     │                       │
     │ 7. Game Ready       │                       │
     │◄────────────────────│                       │
     │                     │                       │
```

**Betting Implementation:**
- `POST /api/invites/create-betting` - Create betting invite with USDC stake
- `POST /api/invites/accept-betting` - Accept and match stake
- Backend interacts with `BattleshipBetting` contract for escrow
- Game creation happens automatically when stakes are matched
- 5% platform fee deducted from winner's payout

### 2. Contract Creation & Registration

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐
│ Player 1 │         │   Backend   │         │  Base    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ WebSocket: player_joined notification       │
     │◄────────────────────│                       │
     │                     │                       │
     │ 1. Create Game Contract                     │
     │──────────────────────────────────────────────►
     │                     │                       │
     │ 2. Contract Created │                       │
     │◄──────────────────────────────────────────────
     │                     │                       │
     │ 3. Register Contract with Session           │
     │────────────────────►│                       │
     │                     │                       │
     │ 4. Contract Registered                      │
     │◄────────────────────│                       │
     │                     │                       │
```

**Contract Functions:**
- `GameFactory.createGame(address opponent)` - Called by Player 1
- No other contract calls needed during gameplay

**Backend API:**
- `POST /api/contracts/register-game` - Register game contract with backend

### 3. Board Placement (Backend-Only)

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐
│ Player 1 │         │   Backend   │         │  Base    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 1. Place Ships (UI) │                       │
     │                     │                       │
     │ 2. Submit Board     │                       │
     │────────────────────►│                       │
     │                     │ 3. Validate & Store   │
     │                     │   (Server-side)       │
     │                     │                       │
     │ 4. Board Confirmed  │                       │
     │◄────────────────────│                       │
     │                     │                       │
     │ 5. WebSocket: board_submitted notification  │
     │◄────────────────────│                       │
     │                     │                       │
┌────┴────┐         ┌─────┴──────┐         ┌──────┴──────┐
│ Player 2 │         │   Backend   │         │  Base    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 6. Submit Board     │                       │
     │────────────────────►│                       │
     │                     │ 7. Validate & Store   │
     │                     │                       │
     │ 8. Game Started     │      No Contract      │
     │◄────────────────────│         Calls         │
     │                     │                       │
```

**Implementation:**
- `POST /api/sessions/:id/submit-board` - Submit ship placement
- Backend validates ship placement rules server-side
- **No ZK proofs required** - validation happens in backend
- **No contract calls** - boards stored in Durable Objects

### 4. Gameplay - Taking Shots (Backend-Only)

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐
│ Player 1 │         │   Backend   │         │  Base    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 1. Select Target    │                       │
     │                     │                       │
     │ 2. Make Shot(x,y)   │                       │
     │────────────────────►│                       │
     │                     │ 3. Process Shot       │
     │                     │   - Check hit/miss    │
     │                     │   - Update ship state │
     │                     │   - Switch turns      │
     │                     │                       │
     │ 4. Shot Result      │      No Contract      │
     │◄────────────────────│         Calls         │
     │                     │                       │
     │ 5. WebSocket Updates to Both Players        │
     │◄────────────────────│──────────────────────►│
     │                     │                       │
```

**Implementation:**
- `POST /api/sessions/:id/make-shot` - Fire a shot
- Backend handles all game logic:
  - Hit/miss detection
  - Ship sinking calculation
  - Turn switching
  - Timeout management
- **Real-time WebSocket updates** to both players
- **No contract interactions** during gameplay

### 5. Game Completion & Rewards

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐
│ Winner   │         │   Backend   │         │  Base    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ 1. Game Ends        │                       │
     │   (All ships sunk)  │                       │
     │                     │ 2. Submit Final Result│
     │                     │──────────────────────►│
     │                     │   - Winner address    │
     │                     │   - Game stats        │
     │                     │   - End reason        │
     │                     │                       │
     │ 3. WebSocket: game_over notification        │
     │◄────────────────────│                       │
     │                     │                       │
     │                     │ 4. Mint $SHIP Rewards │
     │                     │◄──────────────────────│
     │                     │                       │
     │ 5. Reward Notifications (Both Players)      │
     │◄────────────────────────────────────────────│
     │                     │                       │
```

**Implementation:**
- Backend **automatically detects** game end conditions
- Backend calls **simplified contract function** to submit results
- Contract **automatically distributes** $SHIP token rewards
- No need for players to manually claim rewards
- For betting games, additional flow:
  - Backend calls `BattleshipBetting.resolveGame()` 
  - Winner receives 95% of total pool (2x stake minus 5% fee)
  - Platform receives 5% fee
  - USDC distributed automatically

### 5.5 Betting Game Resolution

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐
│ Winner   │         │   Backend   │         │  Base    │
└────┬────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │
     │ Game Ends (Betting) │                       │
     │                     │ 1. Submit Game Result │
     │                     │──────────────────────►│
     │                     │                       │
     │                     │ 2. Resolve Betting   │
     │                     │──────────────────────►│
     │                     │   - Distribute USDC   │
     │                     │   - Platform fee     │
     │                     │                       │
     │ 3. WebSocket: betting_resolved              │
     │◄────────────────────│                       │
     │                     │                       │
     │ 4. USDC Payout      │◄──────────────────────│
     │◄────────────────────────────────────────────│
     │                     │                       │
```

## Frontend Integration Guide

### Game Actions (REST API)

Instead of calling smart contracts, the frontend makes REST API calls:

```javascript
// Make a shot
async function makeShot(x, y) {
    const response = await fetch(`/api/sessions/${sessionId}/make-shot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            address: playerAddress,
            x: x,
            y: y
        })
    });
    // Result comes immediately from backend
    const result = await response.json();
    // UI updates via WebSocket, not from this response
}

// Submit board placement
async function submitBoard(ships) {
    const response = await fetch(`/api/sessions/${sessionId}/submit-board`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            address: playerAddress,
            ships: ships
        })
    });
    // Backend validates and stores board
}
```

### WebSocket Integration

```javascript
const ws = new WebSocket(`ws://backend.url/api/game-updates?sessionId=${sessionId}&address=${playerAddress}`);

ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    switch (message.type) {
        case 'shot_fired':
            updateUI({
                shooter: message.player,
                target: { x: message.x, y: message.y },
                isHit: message.isHit,
                nextTurn: message.nextTurn
            });
            break;
            
        case 'game_over':
            showGameOverScreen(message.winner, message.reason);
            if (message.finalState.isBettingGame) {
                showBettingInfo(message.finalState.bettingInfo);
            }
            break;
            
        case 'betting_resolved':
            showBettingPayout(message.winner, message.gameId);
            break;
            
        case 'betting_error':
            showBettingError(message.message);
            break;
    }
};
```

### Contract Integration (Minimal)

Only two contract interactions needed:

```javascript
// 1. Create game (done once)
async function createGame(opponentAddress) {
    const tx = await gameFactory.createGame(opponentAddress);
    const receipt = await tx.wait();
    const gameId = receipt.events[0].args.gameId;
    
    // Register with backend
    await fetch('/api/contracts/register-game', {
        method: 'POST',
        body: JSON.stringify({
            sessionId: sessionId,
            gameId: gameId.toString(),
            gameContractAddress: receipt.events[0].address
        })
    });
}

// 2. No other contract calls needed!
// All gameplay happens via backend REST API and WebSockets
```

## Key Benefits of Backend Architecture

1. **Faster Gameplay**: No waiting for blockchain confirmations
2. **Better UX**: Immediate feedback for all moves
3. **Cost Efficient**: Only pay gas for game creation and final results
4. **Simpler Implementation**: No ZK circuits or complex proof generation
5. **Automatic Timeouts**: Backend handles all timing logic
6. **Real-time Updates**: WebSocket notifications keep all players synchronized

## Security Considerations

1. **Game Integrity**: Backend validates all moves and maintains authoritative state
2. **Final Results**: Only final outcomes are submitted to blockchain for rewards
3. **Player Authentication**: Wallet signatures validate player identity
4. **Session Security**: Game sessions are isolated and access-controlled
5. **Audit Trail**: All moves are logged for potential dispute resolution

This architecture provides a seamless gaming experience with the security benefits of blockchain for final settlement and rewards, while keeping the gameplay fast and responsive.