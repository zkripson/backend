/**
 * GameSession Durable Object
 *
 * Manages the state of an active game session, including:
 * - Player connections
 * - Game state synchronization
 * - Turn management
 * - Timeout handling
 * - Contract event monitoring
 */
import { ForfeitRequest, JoinRequest, SessionData, StartRequest, SubmitBoardRequest } from '../types';
import { monitorGameEvents } from '../utils/megaeth';

export class GameSession {
	private state: DurableObjectState;
	private env: any;

	// Session data
	private sessionId: string = '';
	private status: 'CREATED' | 'WAITING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'SETUP' = 'CREATED';
	private players: string[] = []; // Wallet addresses
	private playerConnections: Map<string, WebSocket> = new Map();
	private gameContractAddress: string | null = null;
	private gameId: string | null = null;
	private createdAt: number = Date.now();
	private lastActivityAt: number = Date.now();
	private currentTurn: string | null = null;
	private turnStartedAt: number | null = null;
	private forfeitTimeout: number | null = null;
	private playerBoards: Map<string, string> = new Map(); // Address -> board commitment

	constructor(state: DurableObjectState, env: any) {
		this.state = state;
		this.env = env;

		// Handle WebSocket messages
		this.state.blockConcurrencyWhile(async () => {
			// Load stored session data on startup
			let sessionData = (await this.state.storage.get('sessionData')) as SessionData;
			if (sessionData) {
				this.sessionId = sessionData.sessionId;
				this.status = sessionData.status;
				this.players = sessionData.players;
				this.gameContractAddress = sessionData.gameContractAddress;
				this.gameId = sessionData.gameId;
				this.createdAt = sessionData.createdAt;
				this.lastActivityAt = sessionData.lastActivityAt;
				this.currentTurn = sessionData.currentTurn;
				this.turnStartedAt = sessionData.turnStartedAt;

				// Start monitoring game events for active games
				if (this.status === 'ACTIVE' && this.gameContractAddress) {
					this.startGameMonitoring();
				}

				// Check for auto-forfeit if game is active
				if (this.status === 'ACTIVE' && this.turnStartedAt) {
					this.scheduleForfeitCheck();
				}
			}
		});
	}

	// Handle HTTP requests
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// Handle WebSocket connections
		if (request.headers.get('Upgrade') === 'websocket') {
			return this.handleWebSocketConnection(request);
		}

		// Handle contract registration
		if (url.pathname.endsWith('/register-contract')) {
			return this.handleRegisterContract(request);
		}

		// Route API requests
		if (url.pathname.endsWith('/join')) {
			return this.handleJoinRequest(request);
		}

		if (url.pathname.endsWith('/start')) {
			return this.handleStartRequest(request);
		}

		if (url.pathname.endsWith('/forfeit')) {
			return this.handleForfeitRequest(request);
		}

		if (url.pathname.endsWith('/status')) {
			return this.handleStatusRequest();
		}

		if (url.pathname.endsWith('/submit-board')) {
			return this.handleSubmitBoardRequest(request);
		}

		return new Response('Not Found', { status: 404 });
	}

	// WebSocket connection handling
	private async handleWebSocketConnection(request: Request): Promise<Response> {
		const address = new URL(request.url).searchParams.get('address');

		if (!address) {
			return new Response('Missing player address', { status: 400 });
		}

		// Ensure player is part of this game
		if (!this.players.includes(address) && this.players.length >= 2) {
			return new Response('Not a player in this game session', { status: 403 });
		}

		// Accept the WebSocket connection
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		// Set up event handlers for the server side
		server.accept();

		// Store the connection
		this.playerConnections.set(address, server);

		// If this is the first player joining, add them to the game
		if (this.players.length === 0) {
			this.players.push(address);
			await this.saveSessionData();
		}

		// Set up message handlers
		server.addEventListener('message', async (event) => {
			try {
				if (typeof event.data === 'string') {
					const message = JSON.parse(event.data);
					await this.handleWebSocketMessage(address, message);
				} else if (event.data instanceof ArrayBuffer) {
					const textDecoder = new TextDecoder('utf-8');
					const jsonString = textDecoder.decode(event.data);
					const data = JSON.parse(jsonString);
					await this.handleWebSocketMessage(address, data);
				} else {
					console.error('Received unsupported message format:', typeof event.data);
				}
			} catch (error) {
				console.error('Error handling WebSocket message:', error);
				server.send(
					JSON.stringify({
						type: 'error',
						error: 'Invalid message format',
					})
				);
			}
		});

		// Handle disconnection
		server.addEventListener('close', () => {
			this.playerConnections.delete(address);
		});

		// Send initial state to the connected client
		server.send(
			JSON.stringify({
				type: 'session_state',
				sessionId: this.sessionId,
				status: this.status,
				players: this.players,
				currentTurn: this.currentTurn,
				gameId: this.gameId,
			})
		);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	// Handle WebSocket messages from clients
	private async handleWebSocketMessage(address: string, message: any): Promise<void> {
		this.lastActivityAt = Date.now();

		switch (message.type) {
			case 'chat':
				// Relay chat messages to all connected players
				this.broadcastToAll({
					type: 'chat',
					sender: address,
					text: message.text,
					timestamp: Date.now(),
				});
				break;

			case 'game_event':
				// Handle game events from client
				await this.processGameEvent(message.event, address);
				break;

			case 'ping':
				// Respond to keep-alive pings
				const socket = this.playerConnections.get(address);
				if (socket) {
					socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
				}
				break;
		}
	}

	// Initialize a new game session
	async initialize(sessionId: string, creator: string): Promise<void> {
		this.sessionId = sessionId;
		this.status = 'CREATED';
		this.players = [creator];
		this.createdAt = Date.now();
		this.lastActivityAt = Date.now();

		await this.saveSessionData();

		return;
	}

	// Handle a player joining the game
	private async handleJoinRequest(request: Request): Promise<Response> {
		if (this.status !== 'CREATED' && this.status !== 'WAITING') {
			return new Response(
				JSON.stringify({
					error: 'Game session is not accepting new players',
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		if (this.players.length >= 2) {
			return new Response(
				JSON.stringify({
					error: 'Game session is full',
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		const data = (await request.json()) as JoinRequest;
		const playerAddress = data.address;

		if (!playerAddress) {
			return new Response(
				JSON.stringify({
					error: 'Player address is required',
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// Add the player if not already in the game
		if (!this.players.includes(playerAddress)) {
			this.players.push(playerAddress);
			this.status = 'WAITING';
			await this.saveSessionData();
		}

		// Notify all connected clients about the new player
		this.broadcastToAll({
			type: 'player_joined',
			address: playerAddress,
			players: this.players,
			status: this.status,
		});

		return new Response(
			JSON.stringify({
				success: true,
				sessionId: this.sessionId,
				status: this.status,
				players: this.players,
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	private async handleRegisterContract(request: Request): Promise<Response> {
		try {
			const data = (await request.json()) as { gameId: string; gameContractAddress: string };

			// Validate required data
			if (!data.gameId || !data.gameContractAddress) {
				return new Response(
					JSON.stringify({
						error: 'Game ID and contract address are required',
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}

			// Update session with contract info without changing state
			this.gameContractAddress = data.gameContractAddress;
			this.gameId = data.gameId;

			// Save changes
			await this.saveSessionData();

			// Start monitoring game events if already active
			if (this.status === 'ACTIVE') {
				this.startGameMonitoring();
			}

			// Notify connected clients
			this.broadcastToAll({
				type: 'contract_registered',
				gameContractAddress: this.gameContractAddress,
				gameId: this.gameId,
			});

			return new Response(
				JSON.stringify({
					success: true,
					sessionId: this.sessionId,
					status: this.status,
					gameContractAddress: this.gameContractAddress,
					gameId: this.gameId,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} catch (error) {
			console.error('Error registering contract:', error);
			return new Response(
				JSON.stringify({
					error: 'Failed to register contract',
				}),
				{
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}
	}

	// Handle game start request
	private async handleStartRequest(request: Request): Promise<Response> {
		if (this.status !== 'WAITING') {
			return new Response(
				JSON.stringify({
					error: 'Game cannot be started in current state',
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		if (this.players.length !== 2) {
			return new Response(
				JSON.stringify({
					error: 'Need exactly 2 players to start',
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		const data = (await request.json()) as StartRequest;

		// Optional: data might include contract-related info if the client
		// has already created the game on-chain
		if (data.gameContractAddress) {
			this.gameContractAddress = data.gameContractAddress;
		}

		if (data.gameId) {
			this.gameId = data.gameId;
		}

		// Start the game
		this.status = 'ACTIVE';
		this.currentTurn = this.players[0]; // First player goes first
		this.turnStartedAt = Date.now();

		await this.saveSessionData();

		// Start monitoring game events
		if (this.gameContractAddress) {
			this.startGameMonitoring();
		}

		// Schedule auto-forfeit check
		this.scheduleForfeitCheck();

		// Notify all connected clients
		this.broadcastToAll({
			type: 'game_started',
			status: this.status,
			currentTurn: this.currentTurn,
			gameContractAddress: this.gameContractAddress,
			gameId: this.gameId,
			turnStartedAt: this.turnStartedAt,
		});

		return new Response(
			JSON.stringify({
				success: true,
				status: this.status,
				currentTurn: this.currentTurn,
				gameContractAddress: this.gameContractAddress,
				gameId: this.gameId,
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	// Handle forfeit request
	private async handleForfeitRequest(request: Request): Promise<Response> {
		if (this.status !== 'ACTIVE') {
			return new Response(
				JSON.stringify({
					error: 'Game is not active',
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		const data = (await request.json()) as ForfeitRequest;
		const playerAddress = data.address;

		if (!this.players.includes(playerAddress)) {
			return new Response(
				JSON.stringify({
					error: 'Not a player in this game',
				}),
				{
					status: 403,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// Determine the winner (other player)
		const winner = this.players.find((p) => p !== playerAddress);

		// End the game
		await this.endGame(winner || null, 'FORFEIT');

		return new Response(
			JSON.stringify({
				success: true,
				status: this.status,
				winner: winner,
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	// Handle status request
	private handleStatusRequest(): Response {
		return new Response(
			JSON.stringify({
				sessionId: this.sessionId,
				status: this.status,
				players: this.players,
				currentTurn: this.currentTurn,
				gameContractAddress: this.gameContractAddress,
				gameId: this.gameId,
				turnStartedAt: this.turnStartedAt,
				createdAt: this.createdAt,
				lastActivityAt: this.lastActivityAt,
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	// Handle board submission request
	private async handleSubmitBoardRequest(request: Request): Promise<Response> {
		// 1. Explicitly check valid states rather than checking if not 'ACTIVE'
		if (this.status !== 'WAITING' && this.status !== 'SETUP' && this.status !== 'ACTIVE') {
			return new Response(
				JSON.stringify({
					error: 'Game must be in WAITING, SETUP, or ACTIVE state to submit boards',
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		try {
			const data = (await request.json()) as {
				address: string;
				boardCommitment: string;
			};

			const playerAddress = data.address;
			const boardCommitment = data.boardCommitment;

			if (!this.players.includes(playerAddress)) {
				return new Response(
					JSON.stringify({
						error: 'Not a player in this game',
					}),
					{
						status: 403,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}

			if (!boardCommitment) {
				return new Response(
					JSON.stringify({
						error: 'Board commitment is required',
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}

			// Store the board commitment
			this.playerBoards.set(playerAddress, boardCommitment);

			// 2. Add the new SETUP state handling - use status as string literal for clarity
			if (this.status === 'WAITING') {
				this.status = 'SETUP';
			}

			// 3. Check if both players have submitted boards
			const allBoardsSubmitted = this.playerBoards.size === this.players.length;

			// 4. If both boards submitted and in SETUP state, start the game
			if (allBoardsSubmitted && this.status === 'SETUP') {
				this.status = 'ACTIVE';
				this.currentTurn = this.players[0]; // First player goes first
				this.turnStartedAt = Date.now();

				// Start monitoring and forfeit checks
				if (this.gameContractAddress) {
					this.startGameMonitoring();
				}
				this.scheduleForfeitCheck();

				// Notify about game start
				this.broadcastToAll({
					type: 'game_started',
					status: this.status,
					currentTurn: this.currentTurn,
					gameContractAddress: this.gameContractAddress,
					gameId: this.gameId,
					turnStartedAt: this.turnStartedAt,
				});
			}

			await this.saveSessionData();

			// Notify all connected clients
			this.broadcastToAll({
				type: 'board_submitted',
				player: playerAddress,
				allBoardsSubmitted: allBoardsSubmitted,
				gameStatus: this.status,
			});

			return new Response(
				JSON.stringify({
					success: true,
					player: playerAddress,
					allBoardsSubmitted: allBoardsSubmitted,
					gameStatus: this.status,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} catch (error) {
			console.error('Error submitting board:', error);
			return new Response(
				JSON.stringify({
					error: 'Failed to submit board',
				}),
				{
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}
	}

	// Process a game event (from contract or client)
	private async processGameEvent(event: any, source: string): Promise<void> {
		switch (event.name) {
			case 'ShotFired':
				// Update turn information
				this.lastActivityAt = Date.now();

				// Toggle current turn
				this.currentTurn = this.players.find((p) => p !== event.player) || null;
				this.turnStartedAt = Date.now();

				// Reschedule forfeit check
				this.scheduleForfeitCheck();

				// Save updated state
				await this.saveSessionData();

				// Broadcast to all players
				this.broadcastToAll({
					type: 'shot_fired',
					player: event.player,
					x: event.x,
					y: event.y,
					nextTurn: this.currentTurn,
					turnStartedAt: this.turnStartedAt,
				});
				break;

			case 'ShotResult':
				// Update last activity
				this.lastActivityAt = Date.now();

				// Broadcast to all players
				this.broadcastToAll({
					type: 'shot_result',
					player: event.player,
					x: event.x,
					y: event.y,
					isHit: event.isHit,
				});
				break;

			case 'GameCompleted':
				// End the game
				await this.endGame(event.winner, 'COMPLETED');
				break;
		}
	}

	// End the game and update state
	private async endGame(winner: string | null, reason: 'COMPLETED' | 'FORFEIT' | 'TIMEOUT'): Promise<void> {
		this.status = 'COMPLETED';

		// Clear any scheduled forfeit check
		if (this.forfeitTimeout !== null) {
			clearTimeout(this.forfeitTimeout);
			this.forfeitTimeout = null;
		}

		await this.saveSessionData();

		// Notify all connected clients
		this.broadcastToAll({
			type: 'game_over',
			status: this.status,
			winner: winner,
			reason: reason,
		});
	}

	// Save session data to durable storage
	private async saveSessionData(): Promise<void> {
		const sessionData = {
			sessionId: this.sessionId,
			status: this.status,
			players: this.players,
			gameContractAddress: this.gameContractAddress,
			gameId: this.gameId,
			createdAt: this.createdAt,
			lastActivityAt: this.lastActivityAt,
			currentTurn: this.currentTurn,
			turnStartedAt: this.turnStartedAt,
			playerBoards: Array.from(this.playerBoards.entries()),
		};

		await this.state.storage.put('sessionData', sessionData);
	}

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

	// Start monitoring game events from the contract
	private startGameMonitoring(): void {
		if (!this.gameContractAddress || !this.env.MEGAETH_RPC_URL) {
			return;
		}

		// Set up event monitoring
		monitorGameEvents(this.env.MEGAETH_RPC_URL, this.gameContractAddress, (event) => {
			// Process events from the contract
			this.processGameEvent(event, 'contract');
		});
	}

	// Schedule auto-forfeit check after 5 minutes of inactivity
	private scheduleForfeitCheck(): void {
		// Clear any existing timeout
		if (this.forfeitTimeout !== null) {
			clearTimeout(this.forfeitTimeout);
		}

		// Schedule new timeout (5 minutes = 300000 ms)
		this.forfeitTimeout = setTimeout(async () => {
			if (this.status === 'ACTIVE' && this.currentTurn && this.turnStartedAt) {
				const currentTime = Date.now();
				const turnDuration = currentTime - this.turnStartedAt;

				// If more than 5 minutes passed, forfeit the current player's turn
				if (turnDuration > 300000) {
					const winner = this.players.find((p) => p !== this.currentTurn);
					await this.endGame(winner || null, 'TIMEOUT');
				}
			}
		}, 300000);
	}
}
