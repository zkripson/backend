#  Battleship: WebSocket Integration Guide

This guide provides detailed instructions for frontend developers to integrate with the ZK Battleship backend using WebSockets for real-time game updates.

## 1. WebSocket Connection Overview

```
┌────────────┐                        ┌────────────┐
│            │  WebSocket Connection  │            │
│  Frontend  │◄───────────────────────►  Backend   │
│            │                        │            │
└─────┬──────┘                        └────────────┘
      │                                     ▲
      │                                     │
      │      ┌────────────────────┐         │
      │      │                    │         │
      └──────► Game UI Updates    │         │
             │                    │         │
             └────────────────────┘         │
                                            │
                                  ┌─────────┴──────────┐
                                  │  Contract Events   │
                                  │   (via MegaETH)    │
                                  └────────────────────┘
```

## 2. Establishing a WebSocket Connection

### Connection Parameters

```javascript
// Connection URL format
const wsUrl = `${backendUrl.replace('http', 'ws')}/api/game-updates?sessionId=${sessionId}&address=${playerAddress}`;

// Example:
// ws://battleship-api.example.com/api/game-updates?sessionId=123e4567-e89b-12d3-a456-426614174000&address=0x1234...
```

### Required Query Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| sessionId | The unique game session identifier | 123e4567-e89b-12d3-a456-426614174000 |
| address | Player's wallet address | 0x1234567890abcdef1234567890abcdef12345678 |

### Connection Code

```javascript
export class GameWebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectInterval = 2000; // 2 seconds
  private eventHandlers = new Map();
  
  constructor(
    private backendUrl: string,
    private sessionId: string,
    private playerAddress: string
  ) {}
  
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('WebSocket connection already exists');
      return;
    }
    
    const wsUrl = `${this.backendUrl.replace('http', 'ws')}/api/game-updates?sessionId=${this.sessionId}&address=${this.playerAddress}`;
    
    console.log(`Connecting to WebSocket: ${wsUrl}`);
    this.ws = new WebSocket(wsUrl);
    
    this.setupEventHandlers();
  }
  
  private setupEventHandlers(): void {
    if (!this.ws) return;
    
    this.ws.onopen = () => {
      console.log('WebSocket connection established');
      this.reconnectAttempts = 0;
      
      // Trigger any registered open handlers
      this.triggerEvent('open', {});
    };
    
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WebSocket message received:', data);
        
        // Trigger type-specific event handlers
        if (data.type) {
          this.triggerEvent(data.type, data);
        }
        
        // Also trigger general message handler
        this.triggerEvent('message', data);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.triggerEvent('error', error);
    };
    
    this.ws.onclose = (event) => {
      console.log(`WebSocket connection closed: ${event.code} ${event.reason}`);
      this.triggerEvent('close', event);
      
      // Attempt to reconnect if not closed intentionally
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        
        setTimeout(() => {
          this.connect();
        }, this.reconnectInterval * this.reconnectAttempts);
      } else {
        console.error('Maximum reconnect attempts reached');
      }
    };
  }
  
  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'Intentional disconnection');
      this.ws = null;
    }
  }
  
  // Event handling system
  on(event: string, handler: (data: any) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    
    this.eventHandlers.get(event).push(handler);
  }
  
  off(event: string, handler: (data: any) => void): void {
    if (!this.eventHandlers.has(event)) return;
    
    const handlers = this.eventHandlers.get(event);
    const index = handlers.indexOf(handler);
    
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }
  
  private triggerEvent(event: string, data: any): void {
    if (!this.eventHandlers.has(event)) return;
    
    for (const handler of this.eventHandlers.get(event)) {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in ${event} event handler:`, error);
      }
    }
  }
  
  // Send a message to the server
  send(message: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('Cannot send message: WebSocket is not connected');
      return;
    }
    
    this.ws.send(JSON.stringify(message));
  }
  
  // Check if the connection is currently open
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
```

## 3. WebSocket Message Format

All messages follow this JSON structure:

```typescript
interface WebSocketMessage {
  type: string;       // The message type
  [key: string]: any; // Additional properties depending on message type
}
```

## 4. Message Types from Backend to Frontend

### 4.1 Initial State Message

Sent immediately after connection is established.

```json
{
  "type": "session_state",
  "sessionId": "123e4567-e89b-12d3-a456-426614174000",
  "status": "WAITING",
  "players": ["0x1234...", "0x5678..."],
  "currentTurn": null,
  "gameId": "1",
  "gameContractAddress": "0xabcd..."
}
```

### 4.2 Player Joined

```json
{
  "type": "player_joined",
  "address": "0x5678...",
  "players": ["0x1234...", "0x5678..."],
  "status": "WAITING"
}
```

### 4.3 Board Submission

```json
{
  "type": "board_submitted",
  "player": "0x1234...",
  "allBoardsSubmitted": false,
  "gameStatus": "SETUP"
}
```

### 4.4 Game Started

```json
{
  "type": "game_started",
  "status": "ACTIVE",
  "currentTurn": "0x1234...",
  "gameContractAddress": "0xabcd...",
  "gameId": "1",
  "turnStartedAt": 1682541234567
}
```

### 4.5 Shot Fired

```json
{
  "type": "shot_fired",
  "player": "0x1234...",
  "x": 3,
  "y": 7,
  "nextTurn": "0x5678...",
  "turnStartedAt": 1682541239012
}
```

### 4.6 Shot Result

```json
{
  "type": "shot_result",
  "player": "0x5678...",
  "x": 3,
  "y": 7,
  "isHit": true
}
```

### 4.7 Game Over

```json
{
  "type": "game_over",
  "status": "COMPLETED",
  "winner": "0x1234...",
  "reason": "COMPLETED" // Or "FORFEIT" or "TIMEOUT"
}
```

### 4.8 Error

```json
{
  "type": "error",
  "error": "Invalid action",
  "details": "Cannot make a move when it's not your turn"
}
```

### 4.9 Pong (keepalive response)

```json
{
  "type": "pong",
  "timestamp": 1682541250123
}
```

## 5. Message Types from Frontend to Backend

### 5.1 Game Event

Use this to relay events that were detected client-side:

```json
{
  "type": "game_event",
  "event": {
    "name": "ShotFired",
    "player": "0x1234...",
    "x": 5,
    "y": 2,
    "gameId": "1"
  }
}
```

### 5.2 Ping (keepalive)

```json
{
  "type": "ping"
}
```

## 6. Integration Example

```typescript
// Game component using the WebSocket service
class GameComponent {
  private wsService: GameWebSocketService;
  private gameState: {
    status: string;
    currentTurn: string;
    myBoard: any[][];
    opponentBoard: any[][];
    lastShot: { x: number, y: number } | null;
  };
  
  constructor(sessionId: string, playerAddress: string) {
    // Initialize the WebSocket service
    this.wsService = new GameWebSocketService(
      'https://battleship-api.example.com',
      sessionId,
      playerAddress
    );
    
    // Initialize game state
    this.gameState = {
      status: 'CONNECTING',
      currentTurn: '',
      myBoard: this.createEmptyBoard(),
      opponentBoard: this.createEmptyBoard(),
      lastShot: null
    };
    
    // Set up event handlers
    this.setupEventHandlers();
    
    // Connect to WebSocket
    this.wsService.connect();
  }
  
  private setupEventHandlers(): void {
    // Handle session state updates
    this.wsService.on('session_state', (data) => {
      this.gameState.status = data.status;
      this.gameState.currentTurn = data.currentTurn;
      this.updateUI();
    });
    
    // Handle game started event
    this.wsService.on('game_started', (data) => {
      this.gameState.status = 'ACTIVE';
      this.gameState.currentTurn = data.currentTurn;
      console.log(`Game started! Current turn: ${data.currentTurn}`);
      this.updateUI();
    });
    
    // Handle shot fired events
    this.wsService.on('shot_fired', (data) => {
      // If opponent fired the shot, update my board view
      if (data.player !== playerAddress) {
        this.gameState.lastShot = { x: data.x, y: data.y };
        // Mark this cell as being targeted (visual indicator only)
        this.highlightTargetedCell(data.x, data.y);
      }
      
      // Update turn information
      this.gameState.currentTurn = data.nextTurn;
      this.updateUI();
    });
    
    // Handle shot result events
    this.wsService.on('shot_result', (data) => {
      if (data.player === playerAddress) {
        // This is result of opponent's board - update opponent board view
        this.updateOpponentCell(data.x, data.y, data.isHit ? 'hit' : 'miss');
      } else {
        // This is result of my board - update my board view
        this.updateMyCell(data.x, data.y, data.isHit ? 'hit' : 'miss');
      }
      this.updateUI();
    });
    
    // Handle game over events
    this.wsService.on('game_over', (data) => {
      this.gameState.status = 'COMPLETED';
      const isWinner = data.winner === playerAddress;
      
      // Show game over screen
      this.showGameOverScreen(isWinner, data.reason);
    });
    
    // Handle connection errors
    this.wsService.on('error', (error) => {
      this.showErrorMessage('Connection error, please try again later.');
    });
    
    // Handle disconnections
    this.wsService.on('close', (event) => {
      if (this.gameState.status === 'ACTIVE') {
        this.showWarningMessage('Connection lost. Attempting to reconnect...');
      }
    });
  }
  
  // Game actions
  
  // Fire a shot at the opponent's board
  fireShot(x: number, y: number): void {
    // Check if it's our turn
    if (this.gameState.currentTurn !== playerAddress) {
      this.showErrorMessage("It's not your turn!");
      return;
    }
    
    // Call contract method directly (this will be captured by event monitoring)
    // This is just an example - the actual implementation would use ethers.js
    // to call the contract method
    gameContract.makeShot(x, y)
      .then((tx) => {
        console.log('Shot fired transaction:', tx);
        // UI will update when we receive the shot_fired event
      })
      .catch((error) => {
        console.error('Error firing shot:', error);
        this.showErrorMessage('Failed to fire shot. Please try again.');
      });
  }
  
  // Submit board placement
  submitBoard(boardData: any): void {
    // Call the backend API to submit the board
    fetch(`https://battleship-api.example.com/api/sessions/${sessionId}/submit-board`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        address: playerAddress,
        boardCommitment: boardData.commitment
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        console.log('Board submitted successfully');
        // UI will update when we receive the board_submitted event
      } else {
        this.showErrorMessage(data.error || 'Failed to submit board');
      }
    })
    .catch(error => {
      console.error('Error submitting board:', error);
      this.showErrorMessage('Failed to submit board. Please try again.');
    });
  }
  
  // Clean up on component unmount
  onDestroy(): void {
    this.wsService.disconnect();
  }
  
  // Helper methods for UI updates would go here...
  private createEmptyBoard(): any[][] { /* ... */ }
  private updateUI(): void { /* ... */ }
  private highlightTargetedCell(x: number, y: number): void { /* ... */ }
  private updateOpponentCell(x: number, y: number, state: string): void { /* ... */ }
  private updateMyCell(x: number, y: number, state: string): void { /* ... */ }
  private showGameOverScreen(isWinner: boolean, reason: string): void { /* ... */ }
  private showErrorMessage(message: string): void { /* ... */ }
  private showWarningMessage(message: string): void { /* ... */ }
}
```

## 7. Keepalive Strategy

To maintain an active WebSocket connection:

1. Send regular ping messages:

```javascript
// Set up a ping interval (every 30 seconds)
const pingInterval = setInterval(() => {
  if (wsService.isConnected()) {
    wsService.send({ type: 'ping' });
  }
}, 30000);

// Clear the interval when component is destroyed
function cleanup() {
  clearInterval(pingInterval);
  wsService.disconnect();
}
```

2. The server will respond with a `pong` message to confirm the connection is alive.

## 8. Reconnection Strategy

The `GameWebSocketService` includes built-in reconnection logic:

1. Tracks reconnection attempts with increasing backoff
2. Automatically reconnects on unexpected disconnections
3. Respects a maximum number of reconnection attempts

You can customize the behavior:

```javascript
wsService.maxReconnectAttempts = 10; // Increase retry attempts
wsService.reconnectInterval = 1000;  // Faster initial retry (1 second)
```

## 9. Error Handling Best Practices

1. **Connection Errors**: Show a user-friendly message with retry option
2. **Game Logic Errors**: Display specific error messages from the backend
3. **Recovery Strategy**: On reconnection, fetch current game state via REST API
4. **Fallback Option**: If WebSocket fails completely, implement polling via REST

## 10. Security Considerations

1. **Authentication**: The WebSocket connection includes the player's address as identification
2. **Validation**: All messages should be validated on both client and server
3. **Rate Limiting**: Implement client-side throttling for messages
4. **Error Handling**: Never expose sensitive information in error messages

## 11. WebSocket vs. REST

Use WebSockets for:
- Real-time game updates
- Turn notifications
- State synchronization

Use REST API for:
- Game creation and setup
- Board submission
- Fallback when WebSockets fail
- Historical data retrieval

By following this integration guide, you'll create a responsive, real-time experience for ZK Battleship players with reliable connections and graceful error handling.