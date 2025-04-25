# Data Handling in the ZK Battleship Backend

The ZK Battleship backend uses a sophisticated data management approach with Cloudflare Durable Objects as the primary storage mechanism. Here's a detailed breakdown of how data is handled:

## 1. Storage Architecture

### Durable Objects as Database

The backend uses Cloudflare Durable Objects as the primary data store, which provides:

- **Durability**: Data persists across worker restarts
- **Consistency**: Single-instance object model prevents race conditions
- **Low latency**: Data is stored close to compute

Each Durable Object serves as a specialized database for a specific domain:

```
┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│    GameSession DO   │   │   PlayerProfile DO  │   │   InviteManager DO  │
├─────────────────────┤   ├─────────────────────┤   ├─────────────────────┤
│ - Session state     │   │ - Player data       │   │ - Invitations       │
│ - Game progress     │   │ - Game history      │   │ - Invite codes      │
│ - Player connections│   │ - Preferences       │   │ - Expiration data   │
│ - Turn tracking     │   │ - Stats             │   │ - Status tracking   │
└─────────────────────┘   └─────────────────────┘   └─────────────────────┘
```

### Storage Backends

The implementation supports two different storage backends (configured in `wrangler.toml`):

```toml
# Migration to standard storage
[[migrations]]
tag = "v1"
new_classes = ["GameSession", "PlayerProfile", "InviteManager"]

# Optional migration to SQLite backend
[[migrations]]
tag = "v2"
new_sqlite_classes = ["GameSession", "PlayerProfile", "InviteManager"]
```

## 2. Data Models

### Game Session Data

```typescript
// Key game session data stored in Durable Object
private sessionId: string;
private status: 'CREATED' | 'WAITING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
private players: string[];  // Wallet addresses
private gameContractAddress: string | null;
private gameId: string | null;
private createdAt: number;
private lastActivityAt: number;
private currentTurn: string | null;
private turnStartedAt: number | null;
private playerBoards: Map<string, string>; // Address -> board commitment
```

### Player Profile Data

```typescript
// Player profile stored in Durable Object
interface PlayerData {
  address: string;
  username: string | null;
  avatar: string | null;
  createdAt: number;
  lastActive: number;
  totalGames: number;
  wins: number;
  losses: number;
  gameHistory: GameHistoryEntry[];
  preferences: PlayerPreferences;
}

interface GameHistoryEntry {
  gameId: string;
  sessionId: string;
  opponent: string;
  startTime: number;
  endTime: number | null;
  outcome: 'win' | 'loss' | 'forfeit' | 'timeout' | 'ongoing' | 'canceled';
}
```

### Invitation Data

```typescript
// Invitation data stored in Durable Object
interface Invitation {
  id: string;
  code: string;
  creator: string;
  createdAt: number;
  expiresAt: number;
  sessionId: string | null;
  status: 'pending' | 'accepted' | 'expired' | 'canceled';
  acceptedBy: string | null;
  acceptedAt: number | null;
}
```

## 3. Data Operations

### Persistent Storage Operations

Data is persisted to Durable Object storage using put/get operations:

```typescript
// Save session data to durable storage
private async saveSessionData(): Promise<void> {
  const sessionData = {
    sessionId: this.sessionId,
    status: this.status,
    players: this.players,
    // ... other session data
  };
  
  await this.state.storage.put('sessionData', sessionData);
}

// Retrieve session data on startup
let sessionData = await this.state.storage.get('sessionData');
```

### In-Memory Caching

For active objects, data is also kept in memory for faster access:

```typescript
// In-memory maps for active data
private playerConnections: Map<string, WebSocket> = new Map();
private invites: Map<string, Invitation> = new Map();
private codeToInviteMap: Map<string, string> = new Map();
```

### Concurrency Control

Durable Objects ensure data consistency through atomic operations and concurrency control:

```typescript
// Atomic data loading on startup
this.state.blockConcurrencyWhile(async () => {
  // Load stored session data on startup
  let sessionData = await this.state.storage.get('sessionData');
  if (sessionData) {
    this.sessionId = sessionData.sessionId;
    this.status = sessionData.status;
    // ... load other properties
  }
});
```

## 4. Data Lifecycle Management

### Data Creation

```typescript
// Initialize a new game session
async initialize(sessionId: string, creator: string): Promise<void> {
  this.sessionId = sessionId;
  this.status = 'CREATED';
  this.players = [creator];
  this.createdAt = Date.now();
  this.lastActivityAt = Date.now();
  
  await this.saveSessionData();
}
```

### Data Updates

```typescript
// Update game state after a shot
private async processGameEvent(event: any, source: string): Promise<void> {
  switch (event.name) {
    case 'ShotFired':
      // Update turn information
      this.lastActivityAt = Date.now();
      this.currentTurn = this.players.find(p => p !== event.player) || null;
      this.turnStartedAt = Date.now();
      
      // Save updated state
      await this.saveSessionData();
      // ... broadcast updates
      break;
  }
}
```

### Data Expiration & Cleanup

Automatic cleanup of expired data using Durable Object alarms:

```typescript
// Schedule cleanup of expired invitations
private scheduleCleanup(): void {
  // Schedule alarm for once a day
  this.state.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
}

// Handle alarm for cleanup
private async handleCleanupAlarm(): Promise<void> {
  const now = Date.now();
  
  // Find invitations that are more than 7 days old or expired
  const toRemove: string[] = [];
  
  for (const [id, invite] of this.invites.entries()) {
    // Remove invitations older than 7 days
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    
    if (invite.createdAt < sevenDaysAgo) {
      toRemove.push(id);
      continue;
    }
    
    // Mark pending invitations as expired if past expiration time
    if (invite.status === 'pending' && now > invite.expiresAt) {
      invite.status = 'expired';
    }
  }
  
  // Remove old invitations
  for (const id of toRemove) {
    const invite = this.invites.get(id);
    if (invite && invite.code) {
      this.codeToInviteMap.delete(invite.code);
    }
    this.invites.delete(id);
  }
  
  // Save changes
  await this.saveInvites();
  
  // Reschedule next cleanup
  this.scheduleCleanup();
}
```

## 5. Real-time Data Synchronization

### WebSocket Broadcasting

Data changes are broadcast to connected clients in real-time:

```typescript
// Broadcast a message to all connected players
private broadcastToAll(message: any): void {
  const messageStr = JSON.stringify(message);
  
  for (const socket of this.playerConnections.values()) {
    try {
      socket.send(messageStr);
    } catch (error) {
      console.error('Error sending message to client:', error);
    }
  }
}
```

### Blockchain Event Synchronization

The backend monitors MegaETH events to keep session data in sync with on-chain state:

```typescript
// Start monitoring game events from the contract
private startGameMonitoring(): void {
  if (!this.gameContractAddress || !this.env.MEGAETH_RPC_URL) {
    return;
  }
  
  // Set up event monitoring
  monitorGameEvents(
    this.env.MEGAETH_RPC_URL,
    this.gameContractAddress,
    (event) => {
      // Process events from the contract
      this.processGameEvent(event, 'contract');
    }
  );
}
```

## 6. Advanced Data Features

### Data Isolation

Each game session's data is completely isolated in its own Durable Object:

```typescript
// Create a new Durable Object for the session
const sessionDO = env.GAME_SESSIONS.get(
  env.GAME_SESSIONS.idFromString(sessionId)
);
```

### Cross-object Data Flow

Data flows between Durable Objects through explicit API calls:

```typescript
// When an invite is accepted, create a game session and register players
const sessionId = crypto.randomUUID();
const sessionDO = this.env.GAME_SESSIONS.get(
  this.env.GAME_SESSIONS.idFromString(sessionId)
);

// Initialize the session with the creator
await sessionDO.fetch(new Request('https://dummy-url/initialize', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    sessionId,
    creator: invite.creator
  })
}));
```

### SQLite Database (Optional)

The configuration includes optional SQLite database storage:

```toml
[[migrations]]
tag = "v2"
new_sqlite_classes = ["GameSession", "PlayerProfile", "InviteManager"]
```

This would enable SQL queries for more complex data operations:

```typescript
// Example of SQL query from the GameSession class (not currently used)
let result = this.ctx.storage.sql
  .exec("SELECT status, players FROM games WHERE session_id = ?")
  .bind(this.sessionId)
  .first();
```
