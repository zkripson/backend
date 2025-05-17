/**
 * GameSession Durable Object - Updated with Contract Integration
 *
 * Now includes:
 * - Smart contract interactions for game lifecycle
 * - Automatic reward distribution
 * - On-chain statistics reporting
 * - Contract event monitoring
 */
import {
	ForfeitRequest,
	JoinRequest,
	SessionData,
	StartRequest,
	SubmitBoardRequest,
	Shot,
	TimeoutId,
	GameBettingInfo,
	BettingResolvedMessage,
	BettingErrorMessage,
	GameOverMessage,
	PlayerGameStats,
} from '../types';
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

	// Betting game properties
	private bettingInviteId: string | null = null;
	private bettingInfo: GameBettingInfo | null = null;

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
			const data = (await request.json()) as {
				sessionId: string;
				creator: string;
				bettingInviteId?: string;
				onChainGameId?: number;
				bettingInfo?: GameBettingInfo;
			};

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

			// Handle betting game initialization
			if (data.bettingInviteId) {
				// Validate betting data
				if (!data.bettingInfo || !data.bettingInfo.inviteId || !data.bettingInfo.totalPool) {
					return new Response(JSON.stringify({ error: 'Invalid betting information' }), {
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				this.bettingInviteId = data.bettingInviteId;
				this.bettingInfo = data.bettingInfo;

				// If we have an on-chain game ID, use it
				if (data.onChainGameId) {
					this.gameId = data.onChainGameId;
					// We'll need to get the game contract address from the factory
					// This will be set when the second player joins and the game is fully created
				}
			}

			await this.saveSessionData();

			return new Response(
				JSON.stringify({
					success: true,
					sessionId: this.sessionId,
					creator: data.creator,
					status: this.status,
					players: this.players,
					isBettingGame: !!this.bettingInviteId,
					bettingInfo: this.bettingInfo,
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

	// ==================== Betting Integration Methods ====================

	/**
	 * Handle game completion for betting games
	 * This is called after the regular endGame method when the game has betting stakes
	 */
	private async handleBettingGameCompletion(winner: string | null): Promise<void> {
		// Only proceed if this is a betting game
		if (!this.bettingInviteId) {
			return;
		}

		try {
			console.log(`Handling betting game completion: SessionID=${this.sessionId}, Winner=${winner || 'Draw'}`);

			// Get the invite manager to resolve the betting
			const inviteManager = this.env.INVITE_MANAGER.get(this.env.INVITE_MANAGER.idFromName('global'));

			// Call the betting resolution method on the invite manager via HTTP request
			const response = await inviteManager.fetch(
				new Request('https://dummy-url/resolve-betting', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						gameId: this.gameId!.toString(),
						winner: winner,
					}),
				})
			);

			const result = (await response.json()) as { success: boolean; error?: string };
			const resolutionSuccess = result.success;

			if (resolutionSuccess) {
				console.log(`Betting game resolved successfully: GameID=${this.gameId}`);

				// Broadcast betting resolution to connected players
				const message: BettingResolvedMessage = {
					type: 'betting_resolved',
					gameId: this.gameId!,
					winner: winner,
					timestamp: Date.now(),
				};
				this.broadcastToAll(message);
			} else {
				console.error(`Failed to resolve betting for game: GameID=${this.gameId}`, result.error);

				// Broadcast betting error to players
				const errorMessage: BettingErrorMessage = {
					type: 'betting_error',
					message: 'Failed to resolve betting. Please contact support.',
					gameId: this.gameId!,
					timestamp: Date.now(),
				};
				this.broadcastToAll(errorMessage);
			}
		} catch (error) {
			console.error('Error handling betting game completion:', error);

			// Broadcast betting error to players
			const errorMessage: BettingErrorMessage = {
				type: 'betting_error',
				message: 'Error resolving betting. Please contact support.',
				gameId: this.gameId!,
				timestamp: Date.now(),
			};
			this.broadcastToAll(errorMessage);
		}
	}

	// End the game and handle on-chain reporting
	private async endGame(winner: string | null, reason: 'COMPLETED' | 'FORFEIT' | 'TIMEOUT' | 'TIME_LIMIT'): Promise<void> {
		// Prevent double-ending the game
		if (this.status === 'COMPLETED') {
			console.log(`Game already completed, not ending again`);
			return;
		}

		console.log(`Ending game. Winner: ${winner || 'Tie'}, Reason: ${reason}`);
		this.status = 'COMPLETED';

		try {
			// Clear all timeouts first to prevent any race conditions
			if (this.turnTimeoutId !== null) {
				clearTimeout(this.turnTimeoutId);
				this.turnTimeoutId = null;
			}
			if (this.gameTimeoutId !== null) {
				clearTimeout(this.gameTimeoutId);
				this.gameTimeoutId = null;
			}

			// Save the completed state immediately
			await this.saveSessionData();

			// Send final game state to all connected players
			const gameEndedAt = Date.now();
			const playerStats = this.calculatePlayerStats();

			// Send enhanced game over event with player stats
			const gameOverMessage: any = {
				type: 'game_over',
				status: this.status,
				winner: winner,
				reason: reason,
				finalState: {
					shots: this.shots,
					sunkShips: this.getSunkShipsCount(),
					gameStartedAt: this.gameStartedAt!,
					gameEndedAt: gameEndedAt,
					duration: this.gameStartedAt ? gameEndedAt - this.gameStartedAt : 0,
					isBettingGame: !!this.bettingInviteId,
					bettingInfo: this.bettingInfo || undefined,
				},
				playerStats: playerStats,
			};

			this.broadcastToAll(gameOverMessage);

			// Submit final result to contract - wrapped in try/catch to ensure it doesn't prevent game ending
			try {
				if (this.gameId !== null && this.gameContractAddress) {
					await this.submitGameResultToContract(winner, reason);
				} else {
					console.warn('No game ID or contract address available, skipping contract submission');
				}
			} catch (contractError) {
				console.error('Error submitting game result to contract:', contractError);
				// Don't throw here - we still want to complete the game even if contract submission fails

				// Notify players about the issue
				this.broadcastToAll({
					type: 'contract_error',
					message: 'Failed to submit game result to blockchain. Please contact support.',
					timestamp: Date.now(),
				});
			}
		} catch (error) {
			console.error('Error ending game:', error);
			// Still mark the game as completed even if there's an error
			this.status = 'COMPLETED';
			try {
				await this.saveSessionData();
			} catch (saveError) {
				console.error('Failed to save completed game state:', saveError);
			}
		}

		// Handle betting resolution if this is a betting game
		// This must come after the regular contract submission
		if (this.bettingInviteId) {
			await this.handleBettingGameCompletion(winner);
		}
	}

	// Submit game result to smart contract
	private async submitGameResultToContract(winner: string | null, reason: string): Promise<void> {
		// Use a configurable retry mechanism
		const MAX_RETRIES = 3;
		const RETRY_DELAY_MS = 2000;

		let retries = 0;
		let lastError = null;

		while (retries < MAX_RETRIES) {
			try {
				if (this.gameId === null) {
					console.warn('No game ID available, skipping contract submission');
					return;
				}

				const endReasonMap: Record<string, string> = {
					COMPLETED: 'completed', // Game completed normally with a winner
					FORFEIT: 'forfeit', // Player explicitly forfeited
					TIMEOUT: 'timeout', // Player turn timed out repeatedly
					TIME_LIMIT: 'time_limit', // Overall game time limit reached
				};

				const totalShots = this.shots.length;
				const endReason = endReasonMap[reason] || 'unknown';
				const winnerSunkShips = winner ? this.getSunkShipsCount()[winner] || 0 : 0;

				// Enhanced logging with game statistics
				console.log(
					`Submitting game result to contract: gameId=${this.gameId}, winner=${winner || 'Tie'}, ` +
						`reason=${endReason}, totalShots=${totalShots}, sunkShips=${JSON.stringify(this.getSunkShipsCount())}`
				);

				// Call the contract service to finalize the game
				await this.contractService.completeGame(this.gameId, winner as `0x${string}` | null, totalShots, endReason);

				console.log(`Successfully submitted game result for game ${this.gameId}`);
				return; // Success - exit the function
			} catch (error) {
				lastError = error;
				retries++;
				console.error(`Failed to submit game result to contract (attempt ${retries}/${MAX_RETRIES}):`, error);

				if (retries < MAX_RETRIES) {
					// Wait before retrying
					await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
					console.log(`Retrying contract submission (${retries}/${MAX_RETRIES})...`);
				}
			}
		}

		// If we got here, all retries failed
		console.error(`Failed to submit game result to contract after ${MAX_RETRIES} attempts. Last error:`, lastError);
		throw new Error(
			`Failed to submit game result after ${MAX_RETRIES} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
		);
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
				const currentTime = Date.now();
				const gameDuration = currentTime - this.gameStartedAt;

				if (gameDuration >= this.GAME_TIMEOUT_MS) {
					console.log(`Game session ${this.sessionId} reached time limit of ${this.GAME_TIMEOUT_MS}ms, ending game`);
					await this.determineWinnerByShips();
				}
			}
		}, this.GAME_TIMEOUT_MS);
	}

	// Determine winner based on sunk ships
	private async determineWinnerByShips(): Promise<void> {
		// Make sure we only end the game once
		if (this.status !== 'ACTIVE') {
			console.log(`Game already completed, not determining winner by ships`);
			return;
		}

		console.log(`Determining winner by sunk ships count due to timeout`);
		const sunkShipsCount = this.getSunkShipsCount();

		// The winner is the player who sunk more ships on their opponent's board
		// So we need to invert the logic - the player with fewer sunk ships on their own board
		// (meaning they defended better) is winning
		let winner: string | null = null;
		let minSunkShips = Infinity;
		let shipsSunkByPlayer: Record<string, number> = {};

		// Calculate how many ships each player sunk on their opponent's board
		for (const player of this.players) {
			const opponent = this.players.find((p) => p !== player);
			if (opponent) {
				shipsSunkByPlayer[player] = sunkShipsCount[opponent] || 0;
			}
		}

		// Find the player who sunk the most ships
		let maxShipsSunk = 0;
		for (const [player, sunkCount] of Object.entries(shipsSunkByPlayer)) {
			if (sunkCount > maxShipsSunk) {
				maxShipsSunk = sunkCount;
				winner = player;
			} else if (sunkCount === maxShipsSunk && maxShipsSunk > 0) {
				winner = null; // Tie only if both have sunk ships
			}
		}

		// Give advantage to player who went second in case of no ships sunk
		if (maxShipsSunk === 0 && this.players.length === 2) {
			winner = this.players[1]; // Second player wins in case of no activity
		}

		console.log(
			`Game ending due to time limit. Winner: ${winner || 'Tie'}, Ships sunk by each player: ${JSON.stringify(shipsSunkByPlayer)}`
		);
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

	// Calculate comprehensive player statistics
	private calculatePlayerStats(): Record<string, PlayerGameStats> {
		const stats: Record<string, PlayerGameStats> = {};

		// Initialize stats for each player
		for (const player of this.players) {
			stats[player] = {
				address: player,
				shotsCount: 0,
				hitsCount: 0,
				accuracy: 0,
				shipsSunk: 0,
				avgTurnTime: 0,
			};
		}

		// Calculate shot statistics
		for (const shot of this.shots) {
			const playerStats = stats[shot.player];
			if (playerStats) {
				playerStats.shotsCount++;
				if (shot.isHit) {
					playerStats.hitsCount++;
				}
			}
		}

		// Calculate accuracy
		for (const player of this.players) {
			const playerStats = stats[player];
			if (playerStats.shotsCount > 0) {
				playerStats.accuracy = Math.round((playerStats.hitsCount / playerStats.shotsCount) * 100);
			}
		}

		// Add ships sunk data
		const sunkShipsCount = this.getSunkShipsCount();
		for (const player of this.players) {
			// Ships sunk by this player means ships sunk on the opponent's board
			const opponent = this.players.find((p) => p !== player);
			if (opponent && sunkShipsCount[opponent] !== undefined) {
				stats[player].shipsSunk = sunkShipsCount[opponent];
			}
		}

		// Calculate average turn time
		const turnTimes: Record<string, number[]> = {};
		for (const player of this.players) {
			turnTimes[player] = [];
		}

		// Group shots by player to calculate turn times
		let lastTurnTime = this.gameStartedAt || Date.now();
		for (const shot of this.shots) {
			const turnDuration = shot.timestamp - lastTurnTime;
			if (turnTimes[shot.player]) {
				turnTimes[shot.player].push(turnDuration);
			}
			lastTurnTime = shot.timestamp;
		}

		// Calculate average turn times
		for (const player of this.players) {
			const playerTurnTimes = turnTimes[player];
			if (playerTurnTimes.length > 0) {
				const avgTime = playerTurnTimes.reduce((sum, time) => sum + time, 0) / playerTurnTimes.length;
				stats[player].avgTurnTime = Math.round(avgTime);
			}
		}

		return stats;
	}

	// Resume timeouts on restart
	private resumeTimeouts(): void {
		if (this.status === 'ACTIVE') {
			const currentTime = Date.now();

			// Handle turn timeout resume
			if (this.turnStartedAt) {
				const turnElapsed = currentTime - this.turnStartedAt;
				if (turnElapsed >= this.TURN_TIMEOUT_MS) {
					// Turn has already timed out, switch to the next player
					const nextPlayer = this.players.find((p) => p !== this.currentTurn);
					if (nextPlayer) {
						this.currentTurn = nextPlayer;
						this.turnStartedAt = currentTime;
						this.scheduleTurnTimeout();
						console.log(`Resumed with turn timeout exceeded, switching to player ${nextPlayer}`);
					}
				} else {
					// Schedule remaining time for turn timeout
					const turnRemaining = Math.max(0, this.TURN_TIMEOUT_MS - turnElapsed);
					setTimeout(() => this.scheduleTurnTimeout(), turnRemaining);
					console.log(`Resumed turn timeout with ${turnRemaining}ms remaining`);
				}
			}

			// Handle game timeout resume
			if (this.gameStartedAt) {
				const gameElapsed = currentTime - this.gameStartedAt;
				if (gameElapsed >= this.GAME_TIMEOUT_MS) {
					// Game has already exceeded time limit
					console.log(`Resumed with game timeout exceeded, ending game`);
					this.determineWinnerByShips();
				} else {
					// Schedule remaining time for game timeout
					const gameRemaining = Math.max(0, this.GAME_TIMEOUT_MS - gameElapsed);
					setTimeout(() => this.scheduleGameTimeout(), gameRemaining);
					console.log(`Resumed game timeout with ${gameRemaining}ms remaining`);
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
		// Add betting fields
		isBettingGame: boolean;
		bettingInviteId?: string;
		bettingInfo?: GameBettingInfo;
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
			// Add betting information
			isBettingGame: !!this.bettingInviteId,
			bettingInviteId: this.bettingInviteId || undefined,
			bettingInfo: this.bettingInfo || undefined,
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

			// Load betting data
			this.bettingInviteId = sessionData.bettingInviteId || null;
			this.bettingInfo = sessionData.bettingInfo || null;

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
