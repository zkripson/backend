# Backend Service

A Cloudflare Workers backend service for the ZK Battleship game built on MegaETH. This service handles game sessions, player invitations, and integration with MegaETH smart contracts.

## Architecture

This backend service uses:

- **Cloudflare Workers**: Stateless API handlers
- **Durable Objects**: Stateful game session management and player data
- **MegaETH Realtime API**: Low-latency game event monitoring
- **WebSockets**: Real-time client notifications

## Key Components

- **Game Sessions**: Manage active gameplay, turns, and timeouts
- **Player Profiles**: Store player data, game history, and preferences
- **Invite System**: Create and manage game invitations with unique links
- **MegaETH Integration**: Connect with onchain game logic on MegaETH

## Setup & Development

### Prerequisites

- Node.js 16+
- Cloudflare account
- Wrangler CLI
- MegaETH RPC Access

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/your-org/zk-battleship-backend.git
   cd zk-battleship-backend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Configure environment:
   - Set up your `wrangler.toml` with your account id
   - Update environment variables with your MegaETH RPC URL and contract addresses

### Running Locally

```
npm run dev
```

### Deployment

```
npm run deploy
```

## API Endpoints

### Game Sessions

- `POST /api/sessions/create`: Create a new game session
- `GET /api/sessions/:id`: Get session information
- `POST /api/sessions/:id/join`: Join an existing session
- `POST /api/sessions/:id/start`: Start a game
- `POST /api/sessions/:id/forfeit`: Forfeit a game
- `POST /api/sessions/:id/submit-board`: Submit a player's board

### Players

- `GET /api/players/:address`: Get player profile
- `PUT /api/players/:address/profile`: Update player profile
- `GET /api/players/:address/game-history`: Get player's game history
- `GET/PUT /api/players/:address/preferences`: Get/update player preferences

### Invites

- `POST /api/invites/create`: Create a new invitation link
- `POST /api/invites/accept`: Accept an invitation
- `POST /api/invites/cancel`: Cancel an invitation
- `GET /api/invites/:id`: Get invitation status by ID
- `GET /api/invites/code/:code`: Get invitation by code

### Contracts

- `GET /api/contracts/config`: Get contract addresses and ABIs
- `POST /api/contracts/register-game`: Register an on-chain game with session
- `POST /api/contracts/sync-session`: Sync session state with contract state

## WebSocket API

Connect to `/api/game-updates?sessionId=<SESSION_ID>&address=<PLAYER_ADDRESS>` for real-time game updates.

### Message Types

- `session_state`: Current session state
- `player_joined`: Notification of new player
- `game_started`: Game has started
- `shot_fired`: Player has taken a shot
- `shot_result`: Result of a shot (hit/miss)
- `board_submitted`: Player has submitted their board
- `game_over`: Game has completed with result
- `chat`: Chat message from another player

## Auto-Forfeit System

The backend automatically handles forfeits after 5 minutes of inactivity during a player's turn.

## Data Storage

All game and player data is stored in Durable Objects, providing:

- Consistency: Each game has a single source of truth
- Durability: Data persists across worker instances
- Performance: Low-latency access to game state