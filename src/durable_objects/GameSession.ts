/**
 * GameSession Durable Object - Updated with Contract Integration
 *
 * Now includes:
 * - Smart contract interactions for game lifecycle
 * - Automatic reward distribution
 * - On-chain statistics reporting
 * - Contract event monitoring
 */
import { ForfeitRequest, JoinRequest, SessionData, StartRequest, SubmitBoardRequest, Shot, TimeoutId } from '../types';
import { ShipTracker, Ship, Board } from '../utils/shipTracker';
import { ErrorHandler, ErrorCode, GameValidator, PerformanceMonitor } from '../utils/errorMonitoring';
import { ContractGameService } from '../services/contractService';

export class GameSession {
	private state: DurableObjectState;
	private env: any;
	private contractService: ContractGameService;

	// Session data
	private sessionId: string = '';
	private status: 'CREATED' | 'WAITING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'SETUP' = 'CREATED';
	private players: string[] = [];
	private playerConnections: Map<string, WebSocket> = new Map();
	private gameContractAddress: string | null = null;
	private gameId: number | null = null;
	private createdAt: number = Date.now();
	private lastActivityAt: number = Date.now();
	private gameStartedAt: number | null = null;
	private currentTurn: string | null = null;
	private turnStartedAt: number | null = null;
	private turnTimeoutId: TimeoutId | null = null;
	private gameTimeoutId: TimeoutId | null = null;
	private playerBoards: Map<string, Board> = new Map();

	// Enhanced game tracking
	private shots: Shot[] = [];
	private totalShips: number = 5;

	// Constants
	private readonly TURN_TIMEOUT_MS = 15 * 1000; // 15 seconds
	private readonly GAME_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

	constructor(state: DurableObjectState, env: any) {
		this.state = state;
		this.env = env;
		this.contractService = new ContractGameService(env);

		// Load session data on startup
		this.state.blockConcurrencyWhile(async () => {
			await this.loadSessionData();
			this.resumeTimeouts();
		});
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// Handle WebSocket connections
		if (request.headers.get('Upgrade') === 'websocket') {
			return this.handleWebSocketConnection(request);
		}

		// Route API requests
		if (url.pathname.endsWith('/initialize')) {
			return this.handleInitializeRequest(request);
		}

		if (url.pathname.endsWith('/join')) {
			return this.handleJoinRequest(request);
		}

		if (url.pathname.endsWith('/register-contract')) {
			return this.handleRegisterContract(request);
		}

		if (url.pathname.endsWith('/submit-board')) {
			return this.handleSubmitBoardRequest(request);
		}

		if (url.pathname.endsWith('/make-shot')) {
			return this.handleMakeShotRequest(request);
		}

		if (url.pathname.endsWith('/status')) {
			return this.handleStatusRequest();
		}

		if (url.pathname.endsWith('/forfeit')) {
			return this.handleForfeitRequest(request);
		}

		return new Response('Not Found', { status: 404 });
	}

	// Initialize a new game session
	private async handleInitializeRequest(request: Request): Promise<Response> {
		try {
			const data = (await request.json()) as { sessionId: string; creator: string };

			if (!data.sessionId || !data.creator) {
				return new Response(JSON.stringify({ error: 'Session ID and creator address are required' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			this.sessionId = data.sessionId;
			this.status = 'CREATED';
			this.players = [data.creator];
			this.createdAt = Date.now();
			this.lastActivityAt = Date.now();

			await this.saveSessionData();

			return new Response(
				JSON.stringify({
					success: true,
					sessionId: this.sessionId,
					creator: data.creator,
					status: this.status,
					players: this.players,
				}),
				{ headers: { 'Content-Type': 'application/json' } }
			);
		} catch (error) {
			console.error('Error initializing session:', error);
			return ErrorHandler.handleError(error, { sessionId: this.sessionId });
		}
	}

	// Handle player joining the game
	private async handleJoinRequest(request: Request): Promise<Response> {
		return PerformanceMonitor.trackOperation(
			'handleJoinRequest',
			async () => {
				try {
					GameValidator.validateGameState(this.sessionId, this.status, ['CREATED', 'WAITING']);

					if (this.players.length >= 2) {
						throw ErrorHandler.createError(
							ErrorCode.INVALID_GAME_STATE,
							'Game session is full',
							{ currentPlayers: this.players.length },
							{ sessionId: this.sessionId }
						);
					}

					const data = (await request.json()) as JoinRequest;
					const playerAddress = data.address;

					if (!playerAddress) {
						throw ErrorHandler.createError(ErrorCode.VALIDATION_FAILED, 'Player address is required', {}, { sessionId: this.sessionId });
					}

					if (!this.players.includes(playerAddress)) {
						this.players.push(playerAddress);
						this.status = 'WAITING';

						// Create the on-chain game now that we have both players
						await this.createOnChainGame();

						await this.saveSessionData();

						this.broadcastToAll({
							type: 'player_joined',
							address: playerAddress,
							players: this.players,
							status: this.status,
							gameContractAddress: this.gameContractAddress,
							gameId: this.gameId,
						});
					}

					return new Response(
						JSON.stringify({
							success: true,
							sessionId: this.sessionId,
							status: this.status,
							players: this.players,
							gameContractAddress: this.gameContractAddress,
							gameId: this.gameId,
						}),
						{ headers: { 'Content-Type': 'application/json' } }
					);
				} catch (error) {
					return ErrorHandler.handleError(error, { sessionId: this.sessionId });
				}
			},
			this.sessionId
		);
	}

	// Create game on smart contract when both players join
	private async createOnChainGame(): Promise<void> {
		try {
			if (this.players.length !== 2) {
				throw new Error('Need exactly 2 players to create on-chain game');
			}

			console.log(`Creating on-chain game for session ${this.sessionId}`);

			const result = await this.contractService.createGame(this.players[0] as `0x${string}`, this.players[1] as `0x${string}`);

			this.gameId = result.gameId;
			this.gameContractAddress = result.gameContractAddress;

			console.log(`Created on-chain game: ID=${this.gameId}, Contract=${this.gameContractAddress}`);
		} catch (error) {
			console.error('Error creating on-chain game:', error);
			throw new Error(`Failed to create on-chain game: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	// Handle board submission with ship validation
	private async handleSubmitBoardRequest(request: Request): Promise<Response> {
		return PerformanceMonitor.trackOperation(
			'handleSubmitBoardRequest',
			async () => {
				try {
					GameValidator.validateGameState(this.sessionId, this.status, ['WAITING', 'SETUP', 'ACTIVE']);

					const data = (await request.json()) as SubmitBoardRequest & { ships: Ship[] };
					const { address: playerAddress, boardCommitment, ships } = data;

					if (!playerAddress || !boardCommitment || !ships) {
						throw ErrorHandler.createError(
							ErrorCode.VALIDATION_FAILED,
							'Player address, board commitment, and ships are required',
							{},
							{ sessionId: this.sessionId, playerId: playerAddress }
						);
					}

					if (!this.players.includes(playerAddress)) {
						throw ErrorHandler.createError(
							ErrorCode.UNAUTHORIZED,
							'Not a player in this game',
							{},
							{ sessionId: this.sessionId, playerId: playerAddress }
						);
					}

					// Validate ship placement
					if (!ShipTracker.validateShipPlacement(ships)) {
						throw ErrorHandler.createError(
							ErrorCode.VALIDATION_FAILED,
							'Invalid ship placement',
							{ ships },
							{ sessionId: this.sessionId, playerId: playerAddress }
						);
					}

					// Create board from ships
					const board = ShipTracker.createBoardFromShips(ships);
					this.playerBoards.set(playerAddress, board);

					if (this.status === 'WAITING') {
						this.status = 'SETUP';
					}

					// Check if both players have submitted boards
					const allBoardsSubmitted = this.playerBoards.size === this.players.length;

					if (allBoardsSubmitted && this.status === 'SETUP') {
						await this.startGame();
					}

					await this.saveSessionData();

					this.broadcastToAll({
						type: 'board_submitted',
						player: playerAddress,
						allBoardsSubmitted: allBoardsSubmitted,
						gameStatus: this.status,
					});

					return new Response(
						JSON.stringify({
							success: true,
							allBoardsSubmitted: allBoardsSubmitted,
							gameStatus: this.status,
						}),
						{ headers: { 'Content-Type': 'application/json' } }
					);
				} catch (error) {
					return ErrorHandler.handleError(error, { sessionId: this.sessionId });
				}
			},
			this.sessionId
		);
	}

	// Start the game (both locally and on-chain)
	private async startGame(): Promise<void> {
		try {
			// Start game on smart contract if we have the game ID
			if (this.gameId !== null) {
				console.log(`Starting game ${this.gameId} on-chain...`);
				await this.contractService.startGame(this.gameId);
			}

			this.status = 'ACTIVE';
			this.gameStartedAt = Date.now();
			this.currentTurn = this.players[0];
			this.turnStartedAt = Date.now();

			// Schedule timeouts
			this.scheduleTurnTimeout();
			this.scheduleGameTimeout();

			await this.saveSessionData();

			this.broadcastToAll({
				type: 'game_started',
				status: this.status,
				currentTurn: this.currentTurn,
				gameStartedAt: this.gameStartedAt,
				turnStartedAt: this.turnStartedAt,
				gameId: this.gameId,
				gameContractAddress: this.gameContractAddress,
			});
		} catch (error) {
			console.error('Error starting game:', error);
			throw error;
		}
	}

	// Handle shot making (backend gameplay)
	private async handleMakeShotRequest(request: Request): Promise<Response> {
		return PerformanceMonitor.trackOperation(
			'handleMakeShotRequest',
			async () => {
				try {
					GameValidator.validateGameState(this.sessionId, this.status, ['ACTIVE']);

					const data = (await request.json()) as { address: string; x: number; y: number };
					const { address: playerAddress, x, y } = data;

					if (!playerAddress || x === undefined || y === undefined) {
						throw ErrorHandler.createError(
							ErrorCode.VALIDATION_FAILED,
							'Player address and coordinates are required',
							{},
							{ sessionId: this.sessionId, playerId: playerAddress }
						);
					}

					GameValidator.validateTurn(this.sessionId, playerAddress, this.currentTurn, this.players);
					GameValidator.validateCoordinates(x, y);

					// Determine target player
					const targetPlayer = this.players.find((p) => p !== playerAddress);
					if (!targetPlayer) {
						throw ErrorHandler.createError(
							ErrorCode.INVALID_GAME_STATE,
							'No target player found',
							{},
							{ sessionId: this.sessionId, playerId: playerAddress }
						);
					}

					// Check if already shot at this location
					const alreadyShot = this.shots.some((shot) => shot.x === x && shot.y === y && shot.player === playerAddress);

					if (alreadyShot) {
						throw ErrorHandler.createError(
							ErrorCode.VALIDATION_FAILED,
							'Already shot at this location',
							{ x, y },
							{ sessionId: this.sessionId, playerId: playerAddress }
						);
					}

					// Get target board
					const targetBoard = this.playerBoards.get(targetPlayer);
					if (!targetBoard) {
						throw ErrorHandler.createError(
							ErrorCode.INVALID_GAME_STATE,
							'Target player board not found',
							{},
							{ sessionId: this.sessionId, playerId: playerAddress }
						);
					}

					// Process the shot
					const result = ShipTracker.processShot(targetBoard, x, y, playerAddress);

					// Record the shot
					this.shots.push({
						player: playerAddress,
						x,
						y,
						isHit: result.isHit,
						timestamp: Date.now(),
					});

					// Update game state
					if (result.isHit) {
						// Player gets another turn for hitting
						// Reset the turn start time to reset the 15-second timeout
						this.turnStartedAt = Date.now();
						this.scheduleTurnTimeout();
					} else {
						// Switch turns on miss
						this.currentTurn = targetPlayer;
						this.turnStartedAt = Date.now();
						this.scheduleTurnTimeout();
					}

					// Check for game end
					const allTargetShipsSunk = ShipTracker.areAllShipsSunk(targetBoard);
					if (allTargetShipsSunk) {
						await this.endGame(playerAddress, 'COMPLETED');
					}

					await this.saveSessionData();

					// Broadcast shot result
					this.broadcastToAll({
						type: 'shot_fired',
						player: playerAddress,
						x,
						y,
						isHit: result.isHit,
						nextTurn: this.currentTurn,
						turnStartedAt: this.turnStartedAt,
						sunkShips: this.getSunkShipsCount(),
					});

					if (result.shipSunk) {
						this.broadcastToAll({
							type: 'ship_sunk',
							player: playerAddress,
							targetPlayer: targetPlayer,
							ship: result.shipSunk,
							totalSunk: result.sunkShipsCount,
						});
					}

					return new Response(
						JSON.stringify({
							success: true,
							isHit: result.isHit,
							shipSunk: !!result.shipSunk,
							nextTurn: this.currentTurn,
							sunkShips: this.getSunkShipsCount(),
						}),
						{ headers: { 'Content-Type': 'application/json' } }
					);
				} catch (error) {
					return ErrorHandler.handleError(error, { sessionId: this.sessionId });
				}
			},
			this.sessionId
		);
	}

	// End the game and handle on-chain reporting
	private async endGame(winner: string | null, reason: 'COMPLETED' | 'FORFEIT' | 'TIMEOUT' | 'TIME_LIMIT'): Promise<void> {
		try {
			this.status = 'COMPLETED';

			// Clear all timeouts
			if (this.turnTimeoutId !== null) {
				clearTimeout(this.turnTimeoutId);
				this.turnTimeoutId = null;
			}
			if (this.gameTimeoutId !== null) {
				clearTimeout(this.gameTimeoutId);
				this.gameTimeoutId = null;
			}

			await this.saveSessionData();

			// Send final game state
			this.broadcastToAll({
				type: 'game_over',
				status: this.status,
				winner: winner,
				reason: reason,
				finalState: {
					shots: this.shots,
					sunkShips: this.getSunkShipsCount(),
					gameStartedAt: this.gameStartedAt,
					gameEndedAt: Date.now(),
				},
			});

			// Submit final result to contract
			if (this.gameId !== null && this.gameContractAddress) {
				await this.submitGameResultToContract(winner, reason);
			}
		} catch (error) {
			console.error('Error ending game:', error);
			throw error;
		}
	}

	// Submit game result to smart contract
	private async submitGameResultToContract(winner: string | null, reason: string): Promise<void> {
		try {
			if (this.gameId === null) {
				console.warn('No game ID available, skipping contract submission');
				return;
			}

			const endReasonMap: Record<string, string> = {
				COMPLETED: 'completed',
				FORFEIT: 'forfeit',
				TIMEOUT: 'timeout',
				TIME_LIMIT: 'time_limit',
			};

			const totalShots = this.shots.length;
			const endReason = endReasonMap[reason] || 'unknown';

			console.log(`Submitting game result to contract: gameId=${this.gameId}, winner=${winner}, reason=${endReason}`);

			await this.contractService.completeGame(this.gameId, winner as `0x${string}` | null, totalShots, endReason);

			console.log(`Successfully submitted game result for game ${this.gameId}`);
		} catch (error) {
			console.error('Failed to submit game result to contract:', error);
		}
	}

	// Handle forfeit request
	private async handleForfeitRequest(request: Request): Promise<Response> {
		try {
			GameValidator.validateGameState(this.sessionId, this.status, ['ACTIVE']);

			const data = (await request.json()) as ForfeitRequest;
			const playerAddress = data.address;

			if (!this.players.includes(playerAddress)) {
				throw ErrorHandler.createError(
					ErrorCode.UNAUTHORIZED,
					'Not a player in this game',
					{},
					{ sessionId: this.sessionId, playerId: playerAddress }
				);
			}

			const winner = this.players.find((p) => p !== playerAddress) || null;
			await this.endGame(winner, 'FORFEIT');

			return new Response(
				JSON.stringify({
					success: true,
					status: this.status,
					winner: winner,
				}),
				{ headers: { 'Content-Type': 'application/json' } }
			);
		} catch (error) {
			return ErrorHandler.handleError(error, { sessionId: this.sessionId });
		}
	}

	// Schedule turn timeout
	private scheduleTurnTimeout(): void {
		if (this.turnTimeoutId !== null) {
			clearTimeout(this.turnTimeoutId);
		}

		this.turnTimeoutId = setTimeout(async () => {
			if (this.status === 'ACTIVE' && this.currentTurn && this.turnStartedAt) {
				const currentTime = Date.now();
				const turnDuration = currentTime - this.turnStartedAt;

				if (turnDuration >= this.TURN_TIMEOUT_MS) {
					// Switch turn to opponent instead of ending game
					const nextPlayer = this.players.find((p) => p !== this.currentTurn);

					if (nextPlayer) {
						this.currentTurn = nextPlayer;
						this.turnStartedAt = Date.now();

						await this.saveSessionData();

						this.broadcastToAll({
							type: 'turn_timeout',
							previousPlayer: this.currentTurn === this.players[0] ? this.players[1] : this.players[0],
							nextTurn: this.currentTurn,
							turnStartedAt: this.turnStartedAt,
							message: 'Turn timed out, switching to opponent',
						});

						this.scheduleTurnTimeout();
					}
				}
			}
		}, this.TURN_TIMEOUT_MS);
	}

	// Schedule game timeout
	private scheduleGameTimeout(): void {
		if (this.gameTimeoutId !== null) {
			clearTimeout(this.gameTimeoutId);
		}

		this.gameTimeoutId = setTimeout(async () => {
			if (this.status === 'ACTIVE' && this.gameStartedAt) {
				GameValidator.validateTimeout(this.sessionId, this.gameStartedAt, this.GAME_TIMEOUT_MS, 'Game');
				await this.determineWinnerByShips();
			}
		}, this.GAME_TIMEOUT_MS);
	}

	// Determine winner based on sunk ships
	private async determineWinnerByShips(): Promise<void> {
		const sunkShipsCount = this.getSunkShipsCount();

		let winner: string | null = null;
		let maxSunkShips = 0;

		for (const [player, sunkCount] of Object.entries(sunkShipsCount)) {
			if (sunkCount > maxSunkShips) {
				maxSunkShips = sunkCount;
				winner = player;
			} else if (sunkCount === maxSunkShips) {
				winner = null; // Tie
			}
		}

		await this.endGame(winner, 'TIME_LIMIT');
	}

	// Get sunk ships count for all players
	private getSunkShipsCount(): Record<string, number> {
		const sunkShipsCount: Record<string, number> = {};

		for (const player of this.players) {
			const board = this.playerBoards.get(player);
			if (board) {
				sunkShipsCount[player] = board.ships.filter((ship) => ship.isSunk).length;
			} else {
				sunkShipsCount[player] = 0;
			}
		}

		return sunkShipsCount;
	}

	// Resume timeouts on restart
	private resumeTimeouts(): void {
		if (this.status === 'ACTIVE') {
			if (this.turnStartedAt) {
				const elapsed = Date.now() - this.turnStartedAt;
				const remaining = Math.max(0, this.TURN_TIMEOUT_MS - elapsed);
				if (remaining > 0) {
					this.scheduleTurnTimeout();
				}
			}

			if (this.gameStartedAt) {
				const elapsed = Date.now() - this.gameStartedAt;
				const remaining = Math.max(0, this.GAME_TIMEOUT_MS - elapsed);
				if (remaining > 0) {
					this.scheduleGameTimeout();
				} else {
					this.determineWinnerByShips();
				}
			}
		}
	}

	// Handle status request
	private handleStatusRequest(): Response {
		return new Response(JSON.stringify(this.getGameState()), { headers: { 'Content-Type': 'application/json' } });
	}

	// Get current game state
	private getGameState(): {
		sessionId: string;
		status: string;
		players: string[];
		currentTurn: string | null;
		gameContractAddress: string | null;
		gameId: number | null;
		gameStartedAt: number | null;
		turnStartedAt: number | null;
		createdAt: number;
		lastActivityAt: number;
		shots: Shot[];
		sunkShips: Record<string, number>;
		timeouts: {
			turnTimeoutMs: number;
			gameTimeoutMs: number;
		};
	} {
		return {
			sessionId: this.sessionId,
			status: this.status,
			players: this.players,
			currentTurn: this.currentTurn,
			gameContractAddress: this.gameContractAddress,
			gameId: this.gameId,
			gameStartedAt: this.gameStartedAt,
			turnStartedAt: this.turnStartedAt,
			createdAt: this.createdAt,
			lastActivityAt: this.lastActivityAt,
			shots: this.shots,
			sunkShips: this.getSunkShipsCount(),
			timeouts: {
				turnTimeoutMs: this.TURN_TIMEOUT_MS,
				gameTimeoutMs: this.GAME_TIMEOUT_MS,
			},
		};
	}

	// WebSocket connection handling
	private async handleWebSocketConnection(request: Request): Promise<Response> {
		const address = new URL(request.url).searchParams.get('address');

		if (!address) {
			return new Response('Missing player address', { status: 400 });
		}

		if (!this.players.includes(address) && this.players.length >= 2) {
			return new Response('Not a player in this game session', { status: 403 });
		}

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		server.accept();
		this.playerConnections.set(address, server);

		server.addEventListener('message', async (event) => {
			try {
				await this.handleWebSocketMessage(address, event);
			} catch (error) {
				console.error('Error handling WebSocket message:', error);
				this.sendToPlayer(address, {
					type: 'error',
					error: 'Invalid message format',
				});
			}
		});

		server.addEventListener('close', () => {
			this.playerConnections.delete(address);
		});

		// Send initial state
		this.sendToPlayer(address, {
			type: 'session_state',
			data: this.getGameState(),
		});

		// Send game history to reconnecting players
		if (this.status === 'ACTIVE' && this.shots.length > 0) {
			this.sendToPlayer(address, {
				type: 'game_history',
				shots: this.shots,
			});
		}

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	// Handle WebSocket messages from clients
	private async handleWebSocketMessage(address: string, event: MessageEvent): Promise<void> {
		let message: { type: string; text?: string };

		if (typeof event.data === 'string') {
			message = JSON.parse(event.data) as { type: string; text?: string };
		} else if (event.data instanceof ArrayBuffer) {
			const textDecoder = new TextDecoder('utf-8');
			const jsonString = textDecoder.decode(event.data);
			message = JSON.parse(jsonString) as { type: string; text?: string };
		} else {
			throw new Error('Unsupported message format');
		}

		this.lastActivityAt = Date.now();

		switch (message.type) {
			case 'chat':
				this.broadcastToAll({
					type: 'chat',
					sender: address,
					text: message.text,
					timestamp: Date.now(),
				});
				break;

			case 'ping':
				this.sendToPlayer(address, { type: 'pong', timestamp: Date.now() });
				break;

			case 'request_game_state':
				this.sendToPlayer(address, {
					type: 'session_state',
					data: this.getGameState(),
				});
				break;
		}
	}

	// Save session data to durable storage
	private async saveSessionData(): Promise<void> {
		const sessionData: SessionData = {
			sessionId: this.sessionId,
			status: this.status,
			players: this.players,
			gameContractAddress: this.gameContractAddress,
			gameId: this.gameId ? this.gameId.toString() : null,
			createdAt: this.createdAt,
			lastActivityAt: this.lastActivityAt,
			currentTurn: this.currentTurn,
			turnStartedAt: this.turnStartedAt,
			playerBoardsArray: Array.from(this.playerBoards.entries()).map(([player, board]) => [player, JSON.stringify(board)]),
		};

		await this.state.storage.put('sessionData', sessionData);
		await this.state.storage.put('gameData', {
			gameStartedAt: this.gameStartedAt,
			shots: this.shots,
		});
	}

	// Load session data from durable storage
	private async loadSessionData(): Promise<void> {
		const sessionData = (await this.state.storage.get('sessionData')) as SessionData | null;
		const gameData = (await this.state.storage.get('gameData')) as {
			gameStartedAt: number | null;
			shots: Shot[];
		} | null;

		if (sessionData) {
			this.sessionId = sessionData.sessionId;
			this.status = sessionData.status;
			this.players = sessionData.players;
			this.gameContractAddress = sessionData.gameContractAddress;
			this.gameId = sessionData.gameId ? parseInt(sessionData.gameId) : null;
			this.createdAt = sessionData.createdAt;
			this.lastActivityAt = sessionData.lastActivityAt;
			this.currentTurn = sessionData.currentTurn;
			this.turnStartedAt = sessionData.turnStartedAt;

			this.playerBoards = new Map();
			if (sessionData.playerBoardsArray && Array.isArray(sessionData.playerBoardsArray)) {
				for (const [player, boardJson] of sessionData.playerBoardsArray) {
					try {
						const board = JSON.parse(boardJson);
						this.playerBoards.set(player, board);
					} catch (error) {
						console.error(`Failed to parse board for player ${player}:`, error);
					}
				}
			}
		}

		if (gameData) {
			this.gameStartedAt = gameData.gameStartedAt;
			this.shots = gameData.shots || [];
		}
	}

	// Broadcast message to all connected players
	private broadcastToAll(message: Record<string, any>): void {
		const messageStr = JSON.stringify(message);
		for (const socket of this.playerConnections.values()) {
			try {
				socket.send(messageStr);
			} catch (error) {
				console.error('Error sending message to client:', error);
			}
		}
	}

	// Send message to specific player
	private sendToPlayer(address: string, message: Record<string, any>): void {
		const socket = this.playerConnections.get(address);
		if (socket) {
			try {
				socket.send(JSON.stringify(message));
			} catch (error) {
				console.error(`Error sending message to player ${address}:`, error);
			}
		}
	}

	// Register contract (for backward compatibility)
	private async handleRegisterContract(request: Request): Promise<Response> {
		try {
			const data = (await request.json()) as { gameId: string; gameContractAddress: string };

			// This is now handled automatically when players join
			// But we keep this endpoint for compatibility
			this.gameId = parseInt(data.gameId);
			this.gameContractAddress = data.gameContractAddress;

			await this.saveSessionData();

			return new Response(
				JSON.stringify({
					success: true,
					gameContractAddress: this.gameContractAddress,
					gameId: this.gameId,
				}),
				{ headers: { 'Content-Type': 'application/json' } }
			);
		} catch (error) {
			return ErrorHandler.handleError(error, { sessionId: this.sessionId });
		}
	}
}
