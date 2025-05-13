# ZK Battleship Backend

A production-grade Cloudflare Workers backend service for the ZK Battleship game, featuring backend-driven gameplay with MegaETH blockchain integration for final results and rewards.

## 🚀 Architecture Overview

```
┌─────────────┐     WebSocket     ┌─────────────┐     REST API     ┌─────────────┐
│  Frontend   │◄─────────────────►│   Backend   │◄─────────────────│  Frontend   │
│  (Player)   │   Real-time       │  (Session)  │   Game Actions   │  (Player)   │
└─────────────┘   Updates         └─────────────┘                  └─────────────┘
                                          │
                                          │ Game Logic
                                          ▼
                                  ┌─────────────┐
                                  │   Durable   │
                                  │   Objects   │
                                  └─────────────┘
                                          │
                                          │ Final Results
                                          ▼
                                  ┌─────────────┐
                                  │  MegaETH    │
                                  │ Blockchain  │
                                  └─────────────┘
```

## 🎮 Key Features

### Backend-Driven Gameplay
- **All game logic** runs in Cloudflare Workers
- **Real-time shot processing** (~10ms latency)
- **Server-side validation** of all moves
- **Automatic timeout handling** (60s turns, 10m games)
- **No ZK proofs required** for individual moves

### Smart Blockchain Integration
- **Game creation** on MegaETH
- **Final results** stored on-chain
- **$SHIP token rewards** automatically distributed
- **Minimal gas costs** (only 2 transactions per game)

### Production-Ready Infrastructure
- **Durable Objects** for reliable state management
- **WebSocket connections** for real-time updates
- **Comprehensive error handling** and monitoring
- **Performance metrics** and health checks
- **Automatic game cleanup** and data management

## 🛠 Tech Stack

- **Runtime**: Cloudflare Workers
- **State Management**: Durable Objects
- **Real-time Communication**: WebSockets
- **Blockchain**: MegaETH
- **Language**: TypeScript
- **Data Storage**: Cloudflare Durable Objects API

## 📋 Requirements

- Node.js 16+
- Cloudflare account with Workers and Durable Objects enabled
- MegaETH RPC access
- Wrangler CLI

## 🚀 Quick Start

### 1. Installation

```bash
git clone https://github.com/your-org/zk-battleship-backend.git
cd zk-battleship-backend
npm install
```

### 2. Configuration

Create a `wrangler.toml` file:

```toml
name = "zk-battleship"
compatibility_date = "2024-05-01"
workers_dev = true

[[durable_objects.bindings]]
name = "GAME_SESSIONS"
class_name = "GameSession"

[[durable_objects.bindings]]
name = "PLAYER_PROFILES"
class_name = "PlayerProfile"

[[durable_objects.bindings]]
name = "INVITE_MANAGER"
class_name = "InviteManager"

[vars]
MEGAETH_RPC_URL = "https://your-megaeth-node.com"
GAME_FACTORY_ADDRESS = "0x..."
ENVIRONMENT = "development"
LOG_LEVEL = "info"
```

### 3. Development

```bash
# Start local development server
npm run dev

# Deploy to Cloudflare
npm run deploy
```

## 🎯 Game Flow

### 1. Create a Game

```javascript
// Player 1 creates invitation
POST /api/invites/create
{
    "creator": "0x1234...",
    "expirationHours": 24
}

// Response includes session ID and invite code
```

### 2. Join Game

```javascript
// Player 2 accepts invitation
POST /api/invites/accept
{
    "code": "ABC-DEF-GH",
    "player": "0x5678..."
}

// Automatically joins the pre-created session
```

### 3. Register On-Chain Game

```javascript
// Frontend calls MegaETH contract
const tx = await gameFactory.createGame(opponentAddress);
const gameId = receipt.events[0].args.gameId;

// Register with backend
POST /api/contracts/register-game
{
    "sessionId": "123e4567...",
    "gameId": "1",
    "gameContractAddress": "0xabc..."
}
```

### 4. Gameplay

All game actions happen via REST API:

```javascript
// Submit board
POST /api/sessions/:id/submit-board
{
    "address": "0x1234...",
    "ships": [...]
}

// Make shots
POST /api/sessions/:id/make-shot
{
    "address": "0x1234...",
    "x": 5,
    "y": 7
}

// Real-time updates via WebSocket
ws://backend.url/api/game-updates?sessionId=123&address=0x1234
```

## 📡 API Reference

### Game Sessions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions/create` | POST | Create new game session |
| `/api/sessions/:id` | GET | Get session information |
| `/api/sessions/:id/join` | POST | Join existing session |
| `/api/sessions/:id/submit-board` | POST | Submit ship placement |
| `/api/sessions/:id/make-shot` | POST | Fire a shot |
| `/api/sessions/:id/forfeit` | POST | Forfeit the game |

### Players

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/players/:address` | GET | Get player profile |
| `/api/players/:address/profile` | PUT | Update player profile |
| `/api/players/:address/game-history` | GET | Get game history |
| `/api/players/:address/preferences` | GET/PUT | Manage preferences |

### Invitations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/invites/create` | POST | Create invitation |
| `/api/invites/accept` | POST | Accept invitation |
| `/api/invites/cancel` | POST | Cancel invitation |
| `/api/invites/:id` | GET | Get invitation status |
| `/api/invites/code/:code` | GET | Get invitation by code |

### Admin & Monitoring

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/health` | GET | Health check |
| `/admin/metrics` | GET | Performance metrics |
| `/admin/sessions` | GET | List active sessions |
| `/admin/dashboard` | GET | Monitoring dashboard |

## 🔌 WebSocket Events

### Outbound (Backend → Frontend)

```javascript
// Game state
{
    "type": "session_state",
    "data": { /* current game state */ }
}

// Shot fired
{
    "type": "shot_fired",
    "player": "0x1234...",
    "x": 5,
    "y": 7,
    "isHit": true,
    "nextTurn": "0x5678..."
}

// Game over
{
    "type": "game_over",
    "winner": "0x1234...",
    "reason": "COMPLETED"
}
```

### Inbound (Frontend → Backend)

```javascript
// Ping/pong for keepalive
{
    "type": "ping"
}

// Chat messages
{
    "type": "chat",
    "text": "Good game!"
}
```

## 🕐 Game Timing

- **Turn Timeout**: 60 seconds
  - Automatic turn switch when time expires
  - No game termination, just turn forfeit
- **Game Timeout**: 10 minutes maximum
  - Winner determined by most ships sunk
  - Automatic game completion

## 🧪 Testing

```bash
# Run tests
npm test

# Run integration tests
npm run test:integration

# Load testing
npm run test:load
```

## 📊 Monitoring

The backend includes comprehensive monitoring:

### Health Checks

```bash
curl https://your-backend.workers.dev/health
```

### Performance Metrics

```bash
curl https://your-backend.workers.dev/admin/metrics \
  -H "Authorization: Bearer admin-token"
```

### Dashboard

Visit `https://your-backend.workers.dev/admin/dashboard` for a real-time monitoring dashboard.

## 🔒 Security

### Authentication
- Wallet address verification
- Session-based access control
- Admin token for sensitive endpoints

### Data Protection
- Server-side validation of all moves
- No sensitive game data exposed to clients
- Audit trail of all game actions

### Error Handling
- Comprehensive error codes
- Graceful degradation
- No sensitive information in error messages

## 🚀 Deployment

### Production Checklist

1. **Environment Variables**
   ```bash
   wrangler secret put MEGAETH_RPC_URL
   wrangler secret put GAME_FACTORY_ADDRESS
   ```

2. **Security**
   - [ ] Replace admin tokens
   - [ ] Configure CORS properly
   - [ ] Enable rate limiting
   - [ ] Set up monitoring alerts

3. **Performance**
   - [ ] Configure Durable Objects regions
   - [ ] Optimize WebSocket connections
   - [ ] Set up logging aggregation

### Scaling Considerations

- **Durable Objects**: Automatically scale with usage
- **WebSocket Connections**: Limited per-worker, but multiple workers scale horizontally
- **Rate Limiting**: Implement per-IP and per-session limits

## 📈 Performance

### Latency
- **Shot Processing**: ~10ms typical
- **Turn Switching**: ~20ms typical
- **WebSocket Updates**: ~5ms typical

### Throughput
- **Concurrent Games**: Thousands per worker
- **Messages/Second**: 10,000+ per worker
- **API Requests**: 1,000+ requests/second per worker

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [MegaETH Documentation](https://docs.megaeth.systems)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Durable Objects Guide](https://developers.cloudflare.com/workers/runtime-apis/durable-objects/)

## 💬 Support

- Create an issue for bug reports
- Join our Discord for discussions
- Check the documentation for common questions