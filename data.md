# Data Handling in the ZK Battleship Backend

The ZK Battleship backend uses a sophisticated data management approach with Cloudflare Durable Objects as the primary storage mechanism. **All game logic and data now resides in the backend**, with only final results stored on-chain.

## 1. Storage Architecture

### Backend-Driven Game State

```
┌─────────────────────────────────────────────────────────┐
│                    Backend State                        │
├─────────────────────────────────────────────────────────┤
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────┐ │
│ │  Game Session   │ │ Player Profiles │ │ Invite Mgr  │ │
│ │  Durable Object │ │ Durable Object  │ │ Durable Obj │ │
│ ├─────────────────┤ ├─────────────────┤ ├─────────────┤ │
│ │ • Ship boards   │ │ • Player data   │ │ • Invites   │ │
│ │ • Shot history  │ │ • Game history  │ │ • Codes     │ │
│ │ • Turn state    │ │ • Stats         │ │ • Sessions  │ │
│ │ • Timeouts      │ │ • Preferences   │ │ • Status    │ │
│ │ • Game logic    │ │ • Achievements  │ │ • Expiry    │ │
│ └─────────────────┘ └─────────────────┘ └─────────────┘ │
└─────────────────────────────────────────────────────────┘
                           ▲
                           │ Only Final Results
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   Blockchain (MegaETH)                  │
├─────────────────────────────────────────────────────────┤
│ • Game creation records                                 │
│ • Winner addresses                                      │
│ • Final game statistics                                 │
│ • $SHIP token rewards                                   │
│ • Leaderboard data                                      │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

1. **All Game Logic in Backend**: Ship placement, shot validation, hit detection, turn management
2. **Real-time Updates**: WebSocket broadcasting of game events
3. **Persistent Storage**: Durable Objects store all game state
4. **Blockchain Integration**: Only final results and rewards on-chain

## 2. Game Session Data Management

### Complete Game State in Durable Objects

```typescript
interface GameSession {
    // Basic session info
    sessionId: string;
    status: 'CREATED' | 'WAITING' | 'SETUP' | 'ACTIVE' | 'COMPLETED';
    players: string[];
    gameContractAddress: string | null;
    gameId: string | null;
    
    // Game timing
    createdAt: number;
    gameStartedAt: number | null;
    currentTurn: string | null;
    turnStartedAt: number | null;
    lastActivityAt: number;
    
    // Ship and board data (fully stored in backend)
    playerBoards: Map<string, Board>;  // Complete board state per player
    
    // Shot tracking (all shots stored in backend)
    shots: Shot[];  // Complete shot history
    
    // Game rules enforcement
    turnTimeoutId: TimeoutId | null;
    gameTimeoutId: TimeoutId | null;
    TURN_TIMEOUT_MS: 60000;  // 60 seconds
    GAME_TIMEOUT_MS: 600000; // 10 minutes
    
    // Betting game data
    bettingInviteId?: string;
    bettingInfo?: GameBettingInfo;
}
```

### Board Representation

```typescript
interface Board {
    size: number;  // 10x10
    ships: Ship[];
    cells: number[][];  // 0 = water, 1-5 = ship parts
}

interface Ship {
    id: string;
    length: number;
    cells: Array<{ x: number; y: number }>;
    hits: Array<{ x: number; y: number }>;
    isSunk: boolean;
}
```

### Shot Processing Logic

```typescript
interface Shot {
    player: string;
    x: number;
    y: number;
    isHit: boolean;
    timestamp: number;
    shipSunk?: Ship;  // If shot sinks a ship
}

// Backend processes each shot
function processShot(board: Board, x: number, y: number, player: string): ShotResult {
    // 1. Validate coordinates
    // 2. Check if cell was already shot
    // 3. Determine hit/miss from board state
    // 4. Update ship hits if hit
    // 5. Check if ship is sunk
    // 6. Update game state
    // 7. Broadcast to all players
}
```

## 3. Data Persistence Strategy

### Durable Objects as Database

Each game component has its own Durable Object:

```typescript
// Game Session DO - Stores complete game state
export class GameSession {
    private playerBoards: Map<string, Board> = new Map();
    private shots: Shot[] = [];
    private status: GameStatus;
    
    // Save all game data to durable storage
    private async saveSessionData(): Promise<void> {
        const sessionData = {
            sessionId: this.sessionId,
            status: this.status,
            players: this.players,
            playerBoards: Array.from(this.playerBoards.entries()),
            shots: this.shots,
            currentTurn: this.currentTurn,
            // ... all other game state
        };
        
        await this.state.storage.put('sessionData', sessionData);
        await this.state.storage.put('gameData', {
            gameStartedAt: this.gameStartedAt,
            shots: this.shots,
        });
    }
}
```

### Data Recovery

```typescript
// On startup, recover complete game state
private async loadSessionData(): Promise<void> {
    const sessionData = await this.state.storage.get('sessionData');
    const gameData = await this.state.storage.get('gameData');
    
    if (sessionData) {
        this.sessionId = sessionData.sessionId;
        this.status = sessionData.status;
        this.players = sessionData.players;
        
        // Reconstruct playerBoards from saved data
        this.playerBoards = new Map();
        for (const [player, boardData] of sessionData.playerBoards) {
            this.playerBoards.set(player, JSON.parse(boardData));
        }
        
        // Restore shot history
        this.shots = gameData?.shots || [];
        
        // Resume timeouts if game is active
        this.resumeTimeouts();
    }
}
```

## 4. Real-time State Synchronization

### WebSocket Broadcasting

All state changes are immediately broadcast to connected players:

```typescript
// After processing a shot
async function handleMakeShotRequest(x: number, y: number, player: string) {
    // 1. Process shot in backend
    const result = await this.processShot(x, y, player);
    
    // 2. Update internal state
    this.shots.push(result);
    await this.saveSessionData();
    
    // 3. Broadcast to all players immediately
    this.broadcastToAll({
        type: 'shot_fired',
        player: player,
        x: x,
        y: y,
        isHit: result.isHit,
        nextTurn: this.currentTurn,
        sunkShips: this.getSunkShipsCount()
    });
    
    // 4. No contract calls needed
}
```

### State Consistency

```typescript
// All players receive the same state updates
interface GameStateMessage {
    type: 'session_state';
    data: {
        sessionId: string;
        status: string;
        players: string[];
        currentTurn: string | null;
        shots: Shot[];
        sunkShips: Record<string, number>;
        timeouts: {
            turnTimeoutMs: number;
            gameTimeoutMs: number;
        };
    };
}
```

## 5. Betting System Data

### Betting Invitation Structure

```typescript
interface BettingInvite {
    id: string;
    code: string | null;
    creator: string;
    stakeAmount: string;      // USDC amount (6 decimals)
    acceptor: string | null;
    createdAt: number;
    expiresAt: number;
    onChainInviteId: string | null;
    transactionHash: `0x${string}` | null;
    betStatus: 'Open' | 'Matched' | 'Escrowed' | 'Resolved' | 'Cancelled' | 'Expired';
    gameStatus?: 'CREATED' | 'WAITING' | 'SETUP' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
    gameId: string | null;
    sessionId: string | null;
    fundsDistributed: boolean;
}

interface GameBettingInfo {
    inviteId: string;
    totalPool: string;  // Total USDC staked (2x stake)
    resolved: boolean;
}
```

### Betting Flow Data

```typescript
// Betting invite creation
interface BettingInviteCreateRequest {
    creator: string;
    stakeAmount: string;
}

// Betting acceptance
interface BettingInviteAcceptRequest {
    inviteId: string;
    acceptor: string;
}

// WebSocket messages for betting
type BettingResolvedMessage = {
    type: 'betting_resolved';
    gameId: number;
    winner: string | null;
    timestamp: number;
}

type BettingErrorMessage = {
    type: 'betting_error';
    message: string;
    gameId: number;
    timestamp: number;
}
```

## 6. Blockchain Data Integration

### Minimal On-Chain Storage

Only essential data goes to the blockchain:

```typescript
// What goes to blockchain
interface GameResult {
    gameId: string;
    player1: string;
    player2: string;
    winner: string | null;
    startTime: number;
    endTime: number;
    totalShots: number;
    endReason: 'COMPLETED' | 'FORFEIT' | 'TIMEOUT' | 'TIME_LIMIT';
}

// Backend submits final results
async function submitGameResult(result: GameResult) {
    // Only called once at game end
    await gameContract.submitGameResult(
        result.gameId,
        result.winner,
        result.endTime,
        result.totalShots,
        result.endReason
    );
    
    // Triggers reward distribution automatically
}

// Betting-specific blockchain data
interface BettingBlockchainData {
    inviteId: number;
    creator: string;
    stakeAmount: bigint;  // USDC amount in wei
    totalPool: bigint;
    winner: string | null;
    platformFee: bigint;
    resolved: boolean;
}

// Submit betting game result
async function resolveBettingGame(gameId: number, winner: string | null) {
    await bettingContract.resolveGame(gameId, winner);
    // Automatically distributes USDC to winner
}
```

### Contract Event Monitoring

Backend no longer monitors individual game moves, only:

```typescript
// Monitor contract events for:
// 1. Game creation confirmations
// 2. Reward distribution events
// 3. Final result submissions

// No event monitoring for individual shots/moves
```

## 6. Data Analytics & Statistics

### Player Statistics

```typescript
interface PlayerStats {
    totalGames: number;
    wins: number;
    losses: number;
    winStreak: number;
    averageGameDuration: number;
    averageShots: number;
    shipHitAccuracy: number;
    timeouts: number;
    forfeits: number;
}

// Updated from backend game results, not blockchain
async function updatePlayerStats(player: string, gameResult: GameResult) {
    // Direct update in PlayerProfile Durable Object
    // No need to query blockchain
}
```

### Game Analytics

```typescript
// Comprehensive game data available in backend
interface GameAnalytics {
    shotPatterns: Shot[];
    shipPlacements: Ship[];
    gamePhases: {
        setup: number;
        earlyGame: Shot[];
        midGame: Shot[];
        endGame: Shot[];
    };
    turnTimings: number[];
    hitAccuracy: number;
}
```

## 7. Data Security & Validation

### Server-Side Validation

All game rules enforced in backend:

```typescript
class GameValidator {
    static validateShipPlacement(ships: Ship[]): boolean {
        // Backend validates:
        // - Correct number of ships
        // - Proper ship lengths
        // - No overlapping ships
        // - Ships within board bounds
        // - Ships don't touch each other
    }
    
    static validateShot(x: number, y: number, game: GameSession): boolean {
        // Backend validates:
        // - Coordinates within bounds
        // - Player's turn
        // - Cell not already shot
        // - Game in active state
    }
}
```

### Data Integrity

```typescript
// Authoritative game state in backend
// No possibility of client-side manipulation
// Complete audit trail of all game events
interface AuditLog {
    timestamp: number;
    player: string;
    action: 'SHOT' | 'BOARD_SUBMIT' | 'FORFEIT';
    details: any;
    result: any;
}
```

## 8. Performance Optimizations

### In-Memory Caching

```typescript
export class GameSession {
    // Active game state in memory for fast access
    private playerBoards: Map<string, Board> = new Map();
    private shots: Shot[] = [];
    private playerConnections: Map<string, WebSocket> = new Map();
    
    // Periodic saves to durable storage
    private async saveSessionData(): Promise<void> {
        // Async save doesn't block gameplay
    }
}
```

### Efficient Updates

```typescript
// Only serialize and broadcast changes, not full state
interface ShotUpdate {
    type: 'shot_result';
    player: string;
    x: number;
    y: number;
    isHit: boolean;
    shipSunk?: Ship;
    // Not entire game state
}
```

## 9. Testing Strategy

### Mock Data Generation

```typescript
export class TestHelpers {
    static createMockGame(): GameSession {
        // Generate test game with realistic data
        // All test data in backend, no blockchain needed
    }
    
    static simulateGameplay(game: GameSession, moves: Shot[]): void {
        // Simulate complete games for testing
        // Process shots in backend validation
    }
}
```

### Data Validation

```typescript
// Comprehensive backend testing
describe('GameSession', () => {
    it('should handle complete game lifecycle', async () => {
        // Test all game states in backend
        // Verify shot processing
        // Check win conditions
        // Validate timeouts
    });
});
```

## Summary

This backend-driven architecture provides:

1. **Complete Game Logic in Backend**: All validation and state management
2. **Real-time Synchronization**: WebSocket updates keep all players in sync
3. **Durable Storage**: All game data persists across worker restarts
4. **Minimal Blockchain Interaction**: Only creation and final results on-chain
5. **Better Performance**: No waiting for blockchain confirmations
6. **Easier Testing**: All logic accessible for unit/integration tests
7. **Rich Analytics**: Complete game data available for analysis

The backend serves as the authoritative source for all game state, providing a smooth gaming experience while maintaining the benefits of blockchain for final settlement and rewards.