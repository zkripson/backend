# ZK Battleship WebSocket Integration Guide

This guide provides detailed instructions for frontend developers to integrate with the ZK Battleship backend using WebSockets for real-time game updates. **All gameplay logic now happens in the backend**, with WebSockets providing instant updates to all players.

## 1. Architecture Overview

```
┌────────────┐     WebSocket      ┌────────────┐     REST API     ┌────────────┐
│  Frontend  │◄──────────────────►│  Backend   │◄─────────────────│  Frontend  │
│  (Player)  │   Real-time        │  (Session) │   Game Actions   │  (Player)  │
└────────────┘   Updates          └────────────┘                  └────────────┘
                                         │
                                         │ Game Logic
                                         ▼
                                  ┌─────────────┐
                                  │   Durable   │
                                  │   Objects   │
                                  │ (Game State)│
                                  └─────────────┘
```

## 2. Connection Establishment

### Connection URL Format

```javascript
// WebSocket endpoint includes session and player identification
const wsUrl = `wss://your-backend.workers.dev/api/game-updates?sessionId=${sessionId}&address=${playerAddress}`;

// Example:
// wss://battleship-api.example.com/api/game-updates?sessionId=123e4567-e89b-12d3-a456-426614174000&address=0x1234...
```

### Required Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| sessionId | Unique game session identifier | 123e4567-e89b-12d3-a456-426614174000 |
| address | Player's wallet address | 0x1234567890abcdef1234567890abcdef12345678 |

### Connection Setup

```javascript
export class GameWebSocketService {
    constructor(
        private backendUrl: string,
        private sessionId: string,
        private playerAddress: string
    ) {}
    
    connect(): void {
        const wsUrl = `${this.backendUrl.replace('http', 'ws')}/api/game-updates?sessionId=${this.sessionId}&address=${this.playerAddress}`;
        
        this.ws = new WebSocket(wsUrl);
        this.setupEventHandlers();
    }
    
    private setupEventHandlers(): void {
        this.ws.onopen = () => {
            console.log('WebSocket connected - ready for real-time updates');
            this.triggerEvent('connected', {});
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleGameUpdate(data);
        };
        
        this.ws.onclose = () => this.handleReconnection();
        this.ws.onerror = (error) => this.handleError(error);
    }
}
```

## 3. Message Types (Backend to Frontend)

The backend sends real-time updates about game state changes:

### 3.1 Initial State Message

Sent immediately after connection:

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
        "shots": [
            {"player": "0x1234...", "x": 3, "y": 7, "isHit": true, "timestamp": 1682541234567}
        ],
        "sunkShips": {"0x1234...": 1, "0x5678...": 0},
        "timeouts": {
            "turnTimeoutMs": 60000,
            "gameTimeoutMs": 600000
        }
    }
}
```

### 3.2 Board Submission

```json
{
    "type": "board_submitted",
    "player": "0x1234...",
    "allBoardsSubmitted": true,
    "gameStatus": "ACTIVE"
}
```

### 3.3 Shot Fired (Real-time)

```json
{
    "type": "shot_fired",
    "player": "0x1234...",
    "x": 3,
    "y": 7,
    "isHit": true,
    "nextTurn": "0x5678...",
    "turnStartedAt": 1682541239012,
    "sunkShips": {"0x1234...": 1, "0x5678...": 0}
}
```

### 3.4 Ship Sunk

```json
{
    "type": "ship_sunk",
    "player": "0x1234...",
    "targetPlayer": "0x5678...",
    "ship": {
        "id": "ship-0",
        "length": 5,
        "cells": [{"x": 1, "y": 1}, {"x": 2, "y": 1}, ...],
        "isSunk": true
    },
    "totalSunk": 2
}
```

### 3.5 Turn Timeout

```json
{
    "type": "turn_timeout",
    "previousPlayer": "0x1234...",
    "nextTurn": "0x5678...",
    "turnStartedAt": 1682541239012,
    "message": "Turn timed out, switching to opponent"
}
```

### 3.6 Game Over

```json
{
    "type": "game_over",
    "status": "COMPLETED",
    "winner": "0x1234...",
    "reason": "COMPLETED",  // or "FORFEIT", "TIMEOUT", "TIME_LIMIT"
    "finalState": {
        "shots": [...],
        "sunkShips": {"0x1234...": 5, "0x5678...": 3},
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
            "accuracy": 40,  // percentage
            "shipsSunk": 5,
            "avgTurnTime": 8500  // milliseconds
        },
        "0x5678...": {
            "address": "0x5678...",
            "shotsCount": 38,
            "hitsCount": 12,
            "accuracy": 32,  // percentage
            "shipsSunk": 3,
            "avgTurnTime": 7200  // milliseconds
        }
    }
}
```

## 4. Game Actions via REST API

**Important**: Game actions are now performed via REST API calls, not contract calls!

### 4.1 Make a Shot

```javascript
async function makeShot(x, y) {
    // Call backend REST API, not smart contract
    const response = await fetch(`/api/sessions/${sessionId}/make-shot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            address: playerAddress,
            x: x,
            y: y
        })
    });
    
    const result = await response.json();
    
    if (result.success) {
        // Backend processes immediately
        // UI updates come via WebSocket 'shot_fired' message
        console.log('Shot processed by backend');
    } else {
        // Handle error (invalid shot, not your turn, etc.)
        showError(result.error);
    }
}
```

### 4.2 Submit Board

```javascript
async function submitBoard(ships) {
    // Submit to backend, not blockchain
    const response = await fetch(`/api/sessions/${sessionId}/submit-board`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            address: playerAddress,
            ships: ships  // Backend validates ship placement
        })
    });
    
    const result = await response.json();
    
    if (result.success) {
        // Backend validates and stores board
        // UI updates via WebSocket 'board_submitted' message
    } else {
        showError(result.error);
    }
}
```

## 5. Complete Integration Example

```typescript
class BattleshipGameController {
    private ws: GameWebSocketService;
    private gameState: GameState;
    
    constructor(sessionId: string, playerAddress: string) {
        this.ws = new GameWebSocketService(
            'wss://battleship-api.example.com',
            sessionId,
            playerAddress
        );
        
        this.setupEventHandlers();
        this.ws.connect();
    }
    
    private setupEventHandlers(): void {
        // Handle real-time game updates via WebSocket
        this.ws.on('session_state', (data) => {
            this.gameState = data.data;
            this.updateGameUI();
        });
        
        this.ws.on('shot_fired', (data) => {
            // Immediate visual feedback
            this.showShotAnimation(data.x, data.y);
            this.updateBoardCell(data.x, data.y, data.isHit ? 'hit' : 'miss');
            this.updateTurnIndicator(data.nextTurn);
            this.updateShipCounts(data.sunkShips);
        });
        
        this.ws.on('ship_sunk', (data) => {
            this.showShipSunkAnimation(data.ship);
            this.updateShipsList(data.targetPlayer, data.ship);
        });
        
        this.ws.on('turn_timeout', (data) => {
            this.showTimeoutMessage(data.message);
            this.updateTurnIndicator(data.nextTurn);
        });
        
        this.ws.on('game_over', (data) => {
            this.showGameOverScreen(data.winner, data.reason);
            this.displayFinalStats(data.finalState);
            
            // Display comprehensive player statistics
            Object.entries(data.playerStats).forEach(([address, stats]) => {
                this.displayPlayerStats({
                    address: stats.address,
                    shotsCount: stats.shotsCount,
                    hitsCount: stats.hitsCount,
                    accuracy: `${stats.accuracy}%`,
                    shipsSunk: stats.shipsSunk,
                    avgTurnTime: `${(stats.avgTurnTime / 1000).toFixed(1)}s`
                });
            });
        });
    }
    
    // Game actions via REST API
    async onCellClicked(x: number, y: number): Promise<void> {
        // Check if it's our turn (client-side)
        if (this.gameState.currentTurn !== this.playerAddress) {
            this.showMessage("It's not your turn!");
            return;
        }
        
        // Check if cell already shot (client-side optimization)
        if (this.isCellAlreadyShot(x, y)) {
            this.showMessage("Already shot at this location!");
            return;
        }
        
        // Disable UI during shot processing
        this.disableBoard();
        
        try {
            // Make shot via REST API (not contract!)
            await this.makeShot(x, y);
            // Result will come via WebSocket
        } catch (error) {
            this.showError('Failed to make shot: ' + error.message);
            this.enableBoard();
        }
    }
    
    private async makeShot(x: number, y: number): Promise<void> {
        const response = await fetch(`/api/sessions/${this.sessionId}/make-shot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                address: this.playerAddress,
                x,
                y
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to make shot');
        }
    }
}
```

## 6. Comparison: Old vs New Architecture

### Old Architecture (Contract-Based)
```javascript
// OLD: Every shot required contract interaction
async function makeShot(x, y) {
    // 1. Call smart contract
    const tx = await gameContract.makeShot(x, y);
    
    // 2. Wait for confirmation (~10ms on MegaETH)
    await tx.wait();
    
    // 3. Wait for opponent to submit result
    // 4. Generate ZK proof for hit/miss
    // 5. Submit proof to contract
    // 6. Wait for confirmation again
    
    // Total: Multiple round trips, proofs, confirmations
}
```

### New Architecture (Backend-Based)
```javascript
// NEW: Immediate backend processing
async function makeShot(x, y) {
    // 1. Call backend REST API
    const response = await fetch('/api/sessions/123/make-shot', {
        method: 'POST',
        body: JSON.stringify({ address: '0x...', x, y })
    });
    
    // 2. Backend processes immediately
    // 3. WebSocket update with result (<10ms)
    // 4. UI updates instantly
    
    // Total: Single API call, immediate feedback
}
```

## 7. Error Handling

```javascript
class GameWebSocketService {
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    
    private handleError(error: Event): void {
        console.error('WebSocket error:', error);
        
        // Show user-friendly error
        this.triggerEvent('error', {
            message: 'Connection error. Attempting to reconnect...',
            type: 'connection'
        });
    }
    
    private handleReconnection(): void {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
            
            setTimeout(() => {
                console.log(`Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                this.connect();
            }, delay);
        } else {
            this.triggerEvent('error', {
                message: 'Unable to reconnect. Please refresh the page.',
                type: 'fatal'
            });
        }
    }
}
```

## 8. Best Practices

### 8.1 Connection Management

```javascript
// Always clean up WebSocket connections
class GameComponent {
    onUnmount(): void {
        this.ws.disconnect();
        this.clearTimeouts();
    }
    
    onBeforeUnload(): void {
        // Graceful disconnect
        if (this.ws.isConnected()) {
            this.ws.send({ type: 'disconnect', reason: 'page_refresh' });
        }
    }
}
```

### 8.2 State Synchronization

```javascript
// Keep UI in sync with authoritative backend state
handleWebSocketMessage(message: any): void {
    switch (message.type) {
        case 'session_state':
            // Always trust backend state over local state
            this.gameState = message.data;
            this.reconcileUIWithBackendState();
            break;
            
        case 'shot_fired':
            // Apply incremental updates
            this.applyShot(message);
            break;
    }
}
```

### 8.3 Optimistic Updates

```javascript
// Show immediate feedback, but accept backend authority
async makeShot(x: number, y: number): Promise<void> {
    // 1. Optimistic update (immediate UI feedback)
    this.showPendingShot(x, y);
    
    try {
        // 2. Send to backend
        await this.sendShot(x, y);
        
        // 3. WebSocket will confirm with authoritative result
    } catch (error) {
        // 4. Rollback optimistic update
        this.removePendingShot(x, y);
        this.showError(error.message);
    }
}
```

## 9. Performance Optimizations

### 9.1 Message Batching

```javascript
// Backend batches updates when multiple events occur rapidly
{
    "type": "batch_update",
    "updates": [
        {"type": "shot_fired", "player": "0x123...", ...},
        {"type": "ship_sunk", "ship": {...}, ...},
        {"type": "turn_change", "nextTurn": "0x456...", ...}
    ]
}
```

### 9.2 Selective Updates

```javascript
// Only send data that changed
{
    "type": "game_state_delta",
    "changes": {
        "currentTurn": "0x456...",
        "sunkShips": {"0x123...": 2},  // Only changed values
        "newShots": [
            {"player": "0x123...", "x": 5, "y": 3, "isHit": false}
        ]
    }
}
```

## 10. Player Statistics in Game Over Event

The enhanced game_over event now includes comprehensive player statistics:

### Player Stats Object
Each player's statistics include:
- **address**: Player's wallet address
- **shotsCount**: Total number of shots taken
- **hitsCount**: Number of successful hits
- **accuracy**: Hit percentage (0-100)
- **shipsSunk**: Number of opponent's ships sunk
- **avgTurnTime**: Average time taken per turn in milliseconds

### Example Usage

```javascript
function displayGameResults(gameOverData) {
    const { winner, reason, playerStats } = gameOverData;
    
    // Create a comparison view
    const statsComparison = Object.entries(playerStats).map(([address, stats]) => ({
        player: address,
        isWinner: address === winner,
        shots: stats.shotsCount,
        hits: stats.hitsCount,
        accuracy: `${stats.accuracy}%`,
        shipsSunk: stats.shipsSunk,
        avgTurnTime: formatTime(stats.avgTurnTime),
        efficiency: stats.hitsCount / stats.shotsCount
    }));
    
    // Sort by winner first
    statsComparison.sort((a, b) => b.isWinner - a.isWinner);
    
    // Display in UI
    statsComparison.forEach(playerStats => {
        this.ui.addPlayerStatsRow({
            ...playerStats,
            rank: playerStats.isWinner ? 1 : 2
        });
    });
}

function formatTime(milliseconds) {
    const seconds = milliseconds / 1000;
    return seconds < 60 
        ? `${seconds.toFixed(1)}s` 
        : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`;
}
```

## Summary

This WebSocket integration provides:

1. **Real-time Updates**: Instant game state changes without polling
2. **Backend Authority**: Server-side game logic ensures consistency
3. **Simple Frontend**: No complex contract interactions
4. **Better UX**: Immediate feedback for all game actions
5. **Robust Connectivity**: Automatic reconnection and error handling
6. **Performance**: Minimal data transfer, optimized updates
7. **Comprehensive Stats**: Detailed player performance metrics at game end

The combination of WebSocket for real-time updates and REST API for game actions creates a smooth, responsive gaming experience while maintaining the simplicity of backend-driven game logic.