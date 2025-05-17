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
- 15-second turn timeouts and 3-minute game limits
- Real-time communication via WebSockets
- Player profiles and game history
- Invitation system with shareable links
- **Betting system** with USDC stakes and winner-takes-all payouts
- **Automatic on-chain game creation** when players join

### Blockchain (Base)
- **Game creation** handled automatically by backend
- **Final result submission** (winner, game stats)
- **Reward distribution** ($SHIP tokens)
- **Betting contract** (BattleshipBetting) for USDC staking and payouts

## API Reference

### 1. Invitations

#### Create Regular Invitation
```http
POST /api/invites/create
Content-Type: application/json

{
    "creator": "0x1234567890abcdef1234567890abcdef12345678",
    "expirationHours": 24
}
```

**Response:**
```json
{
    "success": true,
    "inviteId": "550e8400-e29b-41d4-a716-446655440000",
    "code": "ABC-DEF-GH",
    "sessionId": "123e4567-e89b-12d3-a456-426614174000",
    "expiresAt": 1234567890000
}
```

#### Accept Invitation
```http
POST /api/invites/accept
Content-Type: application/json

{
    "code": "ABC-DEF-GH",
    "player": "0x9876543210fedcba9876543210fedcba98765432"
}
```

**Response:**
```json
{
    "success": true,
    "sessionId": "123e4567-e89b-12d3-a456-426614174000",
    "gameId": 123,
    "gameContractAddress": "0xabcd1234567890abcdef1234567890abcdef1234",
    "players": [
        "0x1234567890abcdef1234567890abcdef12345678",
        "0x9876543210fedcba9876543210fedcba98765432"
    ]
}
```

#### Cancel Invitation
```http
POST /api/invites/cancel
Content-Type: application/json

{
    "inviteId": "550e8400-e29b-41d4-a716-446655440000",
    "creator": "0x1234567890abcdef1234567890abcdef12345678"
}
```

**Response:**
```json
{
    "success": true,
    "inviteId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "canceled"
}
```

#### Get Invitation Status
```http
GET /api/invites/:id
```

**Response:**
```json
{
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "code": "ABC-DEF-GH",
    "creator": "0x1234567890abcdef1234567890abcdef12345678",
    "createdAt": 1234567890000,
    "expiresAt": 1234567890000,
    "sessionId": "123e4567-e89b-12d3-a456-426614174000",
    "status": "pending",
    "acceptedBy": null,
    "acceptedAt": null
}
```

#### Get Invitation by Code
```http
GET /api/invites/code/:code
```

**Response:**
```json
{
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "code": "ABC-DEF-GH",
    "creator": "0x1234567890abcdef1234567890abcdef12345678",
    "createdAt": 1234567890000,
    "expiresAt": 1234567890000,
    "sessionId": "123e4567-e89b-12d3-a456-426614174000",
    "status": "pending",
    "acceptedBy": null,
    "acceptedAt": null
}
```

### 2. Betting Invitations

#### Create Betting Invitation
```http
POST /api/invites/create-betting
Content-Type: application/json

{
    "creator": "0x1234567890abcdef1234567890abcdef12345678",
    "stakeAmountUSDC": "10",
    "expirationHours": 24
}
```

**Response:**
```json
{
    "success": true,
    "inviteId": "550e8400-e29b-41d4-a716-446655440000",
    "onChainId": 42,
    "code": "BET-ABC-DEF",
    "stakeAmountUSDC": "10",
    "totalPool": "20",
    "expiresAt": 1234567890000
}
```

#### Accept Betting Invitation
```http
POST /api/invites/accept-betting
Content-Type: application/json

{
    "code": "BET-ABC-DEF",
    "player": "0x9876543210fedcba9876543210fedcba98765432"
}
```

**Response:**
```json
{
    "success": true,
    "sessionId": "123e4567-e89b-12d3-a456-426614174000",
    "gameId": 123,
    "gameContractAddress": "0xabcd1234567890abcdef1234567890abcdef1234",
    "totalPool": "20",
    "platformFee": "1",
    "winnerPayout": "19"
}
```

#### Cancel Betting Invitation
```http
POST /api/invites/cancel-betting
Content-Type: application/json

{
    "inviteId": "550e8400-e29b-41d4-a716-446655440000",
    "creator": "0x1234567890abcdef1234567890abcdef12345678"
}
```

**Response:**
```json
{
    "success": true,
    "inviteId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "canceled",
    "stakeRefunded": true
}
```

### 3. Game Sessions

#### Create Session (Usually done automatically with invites)
```http
POST /api/sessions/create
Content-Type: application/json

{
    "creator": "0x1234567890abcdef1234567890abcdef12345678"
}
```

**Response:**
```json
{
    "success": true,
    "sessionId": "123e4567-e89b-12d3-a456-426614174000",
    "status": "CREATED",
    "players": ["0x1234567890abcdef1234567890abcdef12345678"]
}
```

#### Get Session Status
```http
GET /api/sessions/:id
```

**Response:**
```json
{
    "sessionId": "123e4567-e89b-12d3-a456-426614174000",
    "status": "ACTIVE",
    "players": [
        "0x1234567890abcdef1234567890abcdef12345678",
        "0x9876543210fedcba9876543210fedcba98765432"
    ],
    "currentTurn": "0x1234567890abcdef1234567890abcdef12345678",
    "gameContractAddress": "0xabcd1234567890abcdef1234567890abcdef1234",
    "gameId": 123,
    "gameStartedAt": 1234567890000,
    "turnStartedAt": 1234567890000,
    "shots": [
        {
            "player": "0x1234567890abcdef1234567890abcdef12345678",
            "x": 3,
            "y": 7,
            "isHit": true,
            "timestamp": 1234567890000
        }
    ],
    "sunkShips": {
        "0x1234567890abcdef1234567890abcdef12345678": 1,
        "0x9876543210fedcba9876543210fedcba98765432": 0
    },
    "timeouts": {
        "turnTimeoutMs": 15000,
        "gameTimeoutMs": 180000
    },
    "isBettingGame": false,
    "bettingInfo": null
}
```

#### Submit Board
```http
POST /api/sessions/:id/submit-board
Content-Type: application/json

{
    "address": "0x1234567890abcdef1234567890abcdef12345678",
    "boardCommitment": "0xabcdef123456",
    "ships": [
        {
            "id": "carrier",
            "length": 5,
            "cells": [
                {"x": 0, "y": 0},
                {"x": 0, "y": 1},
                {"x": 0, "y": 2},
                {"x": 0, "y": 3},
                {"x": 0, "y": 4}
            ]
        },
        {
            "id": "battleship",
            "length": 4,
            "cells": [
                {"x": 2, "y": 2},
                {"x": 3, "y": 2},
                {"x": 4, "y": 2},
                {"x": 5, "y": 2}
            ]
        }
        // ... other ships
    ]
}
```

**Response:**
```json
{
    "success": true,
    "allBoardsSubmitted": true,
    "gameStatus": "ACTIVE"
}
```

#### Make Shot
```http
POST /api/sessions/:id/make-shot
Content-Type: application/json

{
    "address": "0x1234567890abcdef1234567890abcdef12345678",
    "x": 5,
    "y": 7
}
```

**Response:**
```json
{
    "success": true,
    "isHit": true,
    "shipSunk": false,
    "nextTurn": "0x9876543210fedcba9876543210fedcba98765432",
    "sunkShips": {
        "0x1234567890abcdef1234567890abcdef12345678": 1,
        "0x9876543210fedcba9876543210fedcba98765432": 0
    }
}
```

#### Forfeit Game
```http
POST /api/sessions/:id/forfeit
Content-Type: application/json

{
    "address": "0x1234567890abcdef1234567890abcdef12345678"
}
```

**Response:**
```json
{
    "success": true,
    "status": "COMPLETED",
    "winner": "0x9876543210fedcba9876543210fedcba98765432"
}
```

### 4. Player Profiles

#### Get Player Profile
```http
GET /api/players/:address
```

**Response:**
```json
{
    "address": "0x1234567890abcdef1234567890abcdef12345678",
    "username": "SailorMoon",
    "avatar": "https://example.com/avatar.png",
    "createdAt": 1234567890000,
    "lastActive": 1234567890000,
    "totalGames": 42,
    "wins": 25,
    "losses": 17,
    "gameHistory": [
        {
            "gameId": "123",
            "sessionId": "123e4567-e89b-12d3-a456-426614174000",
            "opponent": "0x9876543210fedcba9876543210fedcba98765432",
            "startTime": 1234567890000,
            "endTime": 1234567890000,
            "outcome": "win",
            "gameDuration": 300000,
            "shipsDestroyed": 5,
            "shotsFired": 42,
            "accuracy": 40
        }
    ],
    "preferences": {
        "notifications": true,
        "theme": "dark",
        "soundEnabled": true
    }
}
```

#### Update Player Profile
```http
PUT /api/players/:address/profile
Content-Type: application/json

{
    "username": "NewUsername",
    "avatar": "https://example.com/new-avatar.png"
}
```

**Response:**
```json
{
    "success": true,
    "profile": {
        "address": "0x1234567890abcdef1234567890abcdef12345678",
        "username": "NewUsername",
        "avatar": "https://example.com/new-avatar.png"
    }
}
```

### 5. Admin & Monitoring

#### Health Check
```http
GET /admin/health
```

**Response:**
```json
{
    "status": "healthy",
    "timestamp": 1234567890000,
    "services": {
        "durableObjects": "operational",
        "database": "operational",
        "blockchain": "operational"
    }
}
```

#### Get Metrics
```http
GET /admin/metrics
Authorization: Bearer {admin-token}
```

**Response:**
```json
{
    "activeSessions": 42,
    "totalGames": 1337,
    "playersOnline": 84,
    "performance": {
        "avgResponseTime": 45,
        "requestsPerSecond": 100,
        "errorRate": 0.01
    }
}
```

## WebSocket Events

### Connection
```javascript
const ws = new WebSocket('wss://backend.url/api/game-updates?sessionId={sessionId}&address={playerAddress}');
```

### Outbound Events (Backend → Frontend)

#### Initial State
```json
{
    "type": "session_state",
    "data": {
        "sessionId": "123e4567-e89b-12d3-a456-426614174000",
        "status": "ACTIVE",
        "players": ["0x1234...", "0x5678..."],
        "currentTurn": "0x1234...",
        "gameStartedAt": 1682541234567,
        "turnStartedAt": 1682541234567,
        "shots": [...],
        "sunkShips": {...},
        "timeouts": {
            "turnTimeoutMs": 15000,
            "gameTimeoutMs": 180000
        }
    }
}
```

#### Player Joined
```json
{
    "type": "player_joined",
    "address": "0x9876543210fedcba9876543210fedcba98765432",
    "players": ["0x1234...", "0x9876..."],
    "status": "WAITING",
    "gameContractAddress": "0xabcd...",
    "gameId": 123
}
```

#### Board Submitted
```json
{
    "type": "board_submitted",
    "player": "0x1234...",
    "allBoardsSubmitted": true,
    "gameStatus": "ACTIVE"
}
```

#### Shot Fired
```json
{
    "type": "shot_fired",
    "player": "0x1234...",
    "x": 3,
    "y": 7,
    "isHit": true,
    "nextTurn": "0x5678...",
    "turnStartedAt": 1682541239012,
    "sunkShips": {
        "0x1234...": 1,
        "0x5678...": 0
    }
}
```

#### Ship Sunk
```json
{
    "type": "ship_sunk",
    "player": "0x1234...",
    "targetPlayer": "0x5678...",
    "ship": {
        "id": "carrier",
        "length": 5,
        "cells": [{"x": 0, "y": 0}, {"x": 0, "y": 1}, ...],
        "isSunk": true
    },
    "totalSunk": 2
}
```

#### Turn Timeout
```json
{
    "type": "turn_timeout",
    "previousPlayer": "0x1234...",
    "nextTurn": "0x5678...",
    "turnStartedAt": 1682541239012,
    "message": "Turn timed out, switching to opponent"
}
```

#### Game Over
```json
{
    "type": "game_over",
    "status": "COMPLETED",
    "winner": "0x1234...",
    "reason": "COMPLETED",
    "finalState": {
        "shots": [...],
        "sunkShips": {
            "0x1234...": 5,
            "0x5678...": 3
        },
        "gameStartedAt": 1682541234567,
        "gameEndedAt": 1682541534567,
        "duration": 300000,
        "isBettingGame": false,
        "bettingInfo": null
    },
    "playerStats": {
        "0x1234...": {
            "address": "0x1234...",
            "shotsCount": 42,
            "hitsCount": 17,
            "accuracy": 40,
            "shipsSunk": 5,
            "avgTurnTime": 8500
        },
        "0x5678...": {
            "address": "0x5678...",
            "shotsCount": 38,
            "hitsCount": 12,
            "accuracy": 32,
            "shipsSunk": 3,
            "avgTurnTime": 7200
        }
    }
}
```

#### Betting Resolved
```json
{
    "type": "betting_resolved",
    "gameId": 123,
    "winner": "0x1234...",
    "timestamp": 1234567890
}
```

#### Betting Error
```json
{
    "type": "betting_error",
    "message": "Failed to resolve betting. Please contact support.",
    "gameId": 123,
    "timestamp": 1234567890
}
```

### Inbound Events (Frontend → Backend)

#### Ping
```json
{
    "type": "ping"
}
```

#### Pong (Response)
```json
{
    "type": "pong",
    "timestamp": 1234567890
}
```

#### Chat Message
```json
{
    "type": "chat",
    "text": "Good game!"
}
```

#### Request Game State
```json
{
    "type": "request_game_state"
}
```

## Error Responses

All error responses follow this format:
```json
{
    "error": "Invalid move",
    "code": "INVALID_MOVE",
    "details": {
        "reason": "Cell already shot",
        "x": 5,
        "y": 7
    }
}
```

Common error codes:
- `INVALID_REQUEST` - Missing or invalid parameters
- `UNAUTHORIZED` - Player not authorized for this action
- `INVALID_GAME_STATE` - Action not allowed in current game state
- `INVALID_MOVE` - Invalid game move
- `SESSION_NOT_FOUND` - Game session doesn't exist
- `TIMEOUT` - Request timed out
- `RATE_LIMITED` - Too many requests

## Security Considerations

1. **Authentication**: All API requests must include player address
2. **Authorization**: Backend validates player ownership for all actions
3. **Rate Limiting**: Implement per-IP and per-player rate limits
4. **Input Validation**: All inputs are validated server-side
5. **State Management**: Game state is authoritative on backend

## Best Practices

1. **Error Handling**: Always handle API errors gracefully
2. **Retry Logic**: Implement exponential backoff for failed requests
3. **WebSocket Reconnection**: Automatic reconnection with backoff
4. **State Synchronization**: Trust backend state over local state
5. **Optimistic Updates**: Show immediate UI feedback, reconcile with backend

This comprehensive API documentation provides all the information needed to integrate with the ZK Battleship backend.