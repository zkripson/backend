# ZK Battleship Backend

![Deploy to Cloudflare Workers](https://github.com/your-org/battleship-backend/actions/workflows/deploy.yml/badge.svg)

A production-grade Cloudflare Workers backend service for the ZK Battleship game, featuring backend-driven gameplay with Base blockchain integration for final results and rewards.

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
- **Automatic timeout handling** (15s turns, 3m games)
- **No ZK proofs required** for individual moves

### Smart Blockchain Integration
- **Game creation** on Base blockchain
- **Final results** stored on-chain
- **$SHIP token rewards** automatically distributed
- **Minimal gas costs** (only 2-3 transactions per game)
- **USDC betting** with escrow and automatic payouts

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
- **Blockchain**: Base (Ethereum L2)
- **Language**: TypeScript
- **Data Storage**: Cloudflare Durable Objects API

## 📋 Requirements

- Node.js 20+
- Cloudflare account with Workers and Durable Objects enabled
- Base Sepolia RPC access
- Wrangler CLI v4+

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
BASE_RPC_URL = "https://mainnet.base.org"
BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org"
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
// Frontend calls Base contract
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
| `/api/invites/create-betting` | POST | Create betting invitation |
| `/api/invites/accept-betting` | POST | Accept betting invitation |
| `/api/invites/cancel-betting` | POST | Cancel betting invitation |

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
    "reason": "COMPLETED",
    "finalState": { /* includes betting info if applicable */ }
}

// Betting resolved
{
    "type": "betting_resolved",
    "gameId": 123,
    "winner": "0x1234...",
    "timestamp": 1234567890
}

// Betting error
{
    "type": "betting_error",
    "message": "Failed to resolve betting",
    "gameId": 123,
    "timestamp": 1234567890
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

## 💰 Betting System

### How It Works
1. Players can create betting invitations with USDC stakes
2. When another player accepts, their stake is matched
3. Winner takes 95% of the pool (190% of their stake)
4. Platform receives 5% fee
5. Automatic USDC distribution on game completion

### Betting Flow
```javascript
// Create betting invite
POST /api/invites/create-betting
{
    "creator": "0x1234...",
    "stakeAmount": "10" // 10 USDC
}

// Accept betting invite
POST /api/invites/accept-betting
{
    "code": "ABC123",
    "player": "0x5678..."
}
```

## 🕐 Game Timing

- **Turn Timeout**: 15 seconds
  - Automatic turn switch when time expires
  - No game termination, just turn forfeit
- **Game Timeout**: 3 minutes maximum
  - Winner determined by most ships sunk
  - Automatic game completion and contract result submission

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

### CI/CD with GitHub Actions

The project is configured with GitHub Actions to automatically deploy to Cloudflare Workers whenever changes are pushed to the `master` branch.

1. **Setup GitHub Secrets**

   Add the following secrets to your GitHub repository:
   
   - `CF_API_TOKEN`: Cloudflare API token with Workers and DO permissions
   - `CF_ACCOUNT_ID`: Your Cloudflare account ID
   - `BASE_RPC_URL`: Base Mainnet RPC URL
   - `BASE_SEPOLIA_RPC_URL`: Base Sepolia RPC URL
   - `GAME_FACTORY_ADDRESS`: Address of the game factory contract
   - `BATTLESHIP_BETTING_ADDRESS`: Address of the betting contract
   - `USDC_TOKEN_ADDRESS`: Address of the USDC token contract
   - `ENABLE_BETTING`: Set to 'true' to enable betting features
   
   [Detailed setup instructions](./docs/github-actions-setup.md)

2. **How It Works**
   
   - Every push to the `master` branch triggers a deployment
   - The workflow installs dependencies and runs `npm run deploy`
   - View deployment status in the "Actions" tab of your GitHub repository
   - Manual deployments can be triggered via the GitHub UI

3. **Manual Deployment**

   If you prefer to deploy manually:
   
   ```bash
   # Set up your Cloudflare credentials
   wrangler login
   
   # Deploy to Cloudflare
   npm run deploy
   ```

### Production Checklist

1. **Environment Variables**
   ```bash
   # These should be set as GitHub secrets for CI/CD
   wrangler secret put BASE_SEPOLIA_RPC_URL
   wrangler secret put BASE_RPC_URL
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

- [Base Documentation](https://docs.base.org)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Durable Objects Guide](https://developers.cloudflare.com/workers/runtime-apis/durable-objects/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

## 💬 Support

- Create an issue for bug reports
- Join our Discord for discussions
- Check the documentation for common questions