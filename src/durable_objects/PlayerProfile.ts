import { PlayerData, GameHistoryEntry, ProfileUpdate, GameUpdateRequest, PreferencesUpdate } from '../types';

export class PlayerProfile {
	private state: DurableObjectState;
	private env: any;
	private address: string = '';
	private playerData: PlayerData | null = null;

	constructor(state: DurableObjectState, env: any) {
		this.state = state;
		this.env = env;

		// Load player data on startup
		this.state.blockConcurrencyWhile(async () => {
			this.playerData = (await this.state.storage.get('playerData')) || null;
		});
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Handle player data endpoints
		if (path.endsWith('/profile')) {
			if (request.method === 'GET') {
				return this.handleGetProfile();
			} else if (request.method === 'PUT') {
				return this.handleUpdateProfile(request);
			}
		}

		if (path.endsWith('/game-history')) {
			return this.handleGetGameHistory();
		}

		if (path.endsWith('/add-game')) {
			return this.handleAddGame(request);
		}

		if (path.endsWith('/update-game')) {
			return this.handleUpdateGame(request);
		}

		if (path.endsWith('/preferences')) {
			if (request.method === 'GET') {
				return this.handleGetPreferences();
			} else if (request.method === 'PUT') {
				return this.handleUpdatePreferences(request);
			}
		}

		// Default not found response
		return new Response('Not Found', { status: 404 });
	}

	// Initialize a new player profile
	async initialize(address: string): Promise<void> {
		this.address = address;

		// Create default player data
		this.playerData = {
			address: address,
			username: null,
			avatar: null,
			createdAt: Date.now(),
			lastActive: Date.now(),
			totalGames: 0,
			wins: 0,
			losses: 0,
			gameHistory: [],
			preferences: {
				notifications: true,
				theme: 'system',
				boardLayout: null,
			},
		};

		await this.savePlayerData();
	}

	// Handle GET /profile - Return player profile data
	private handleGetProfile(): Response {
		if (!this.playerData) {
			return new Response(JSON.stringify({ error: 'Player profile not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Update last active timestamp
		this.playerData.lastActive = Date.now();
		this.savePlayerData(); // Don't await, let it update in the background

		return new Response(
			JSON.stringify({
				address: this.playerData.address,
				username: this.playerData.username,
				avatar: this.playerData.avatar,
				createdAt: this.playerData.createdAt,
				totalGames: this.playerData.totalGames,
				wins: this.playerData.wins,
				losses: this.playerData.losses,
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	// Handle PUT /profile - Update player profile
	private async handleUpdateProfile(request: Request): Promise<Response> {
		if (!this.playerData) {
			return new Response(JSON.stringify({ error: 'Player profile not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		try {
			const updates = (await request.json()) as ProfileUpdate;

			// Update the allowed fields
			if (updates.username !== undefined) {
				this.playerData.username = updates.username;
			}

			if (updates.avatar !== undefined) {
				this.playerData.avatar = updates.avatar;
			}

			// Update last active timestamp
			this.playerData.lastActive = Date.now();

			// Save the updated data
			await this.savePlayerData();

			return new Response(
				JSON.stringify({
					success: true,
					profile: {
						address: this.playerData.address,
						username: this.playerData.username,
						avatar: this.playerData.avatar,
					},
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} catch (error) {
			return new Response(JSON.stringify({ error: 'Invalid request data' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	}

	// Handle GET /game-history - Return player's game history
	private handleGetGameHistory(): Response {
		if (!this.playerData) {
			return new Response(JSON.stringify({ error: 'Player profile not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Update last active timestamp
		this.playerData.lastActive = Date.now();
		this.savePlayerData(); // Don't await, let it update in the background

		return new Response(
			JSON.stringify({
				gameHistory: this.playerData.gameHistory,
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	// Handle POST /add-game - Add a new game to history
	private async handleAddGame(request: Request): Promise<Response> {
		if (!this.playerData) {
			return new Response(JSON.stringify({ error: 'Player profile not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		try {
			const gameData = (await request.json()) as GameHistoryEntry;

			// Validate required fields
			if (!gameData.gameId || !gameData.sessionId || !gameData.opponent) {
				return new Response(JSON.stringify({ error: 'Missing required game data' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// Create a new game history entry
			const newGame: GameHistoryEntry = {
				gameId: gameData.gameId,
				sessionId: gameData.sessionId,
				opponent: gameData.opponent,
				startTime: gameData.startTime || Date.now(),
				endTime: null,
				outcome: 'ongoing',
			};

			// Add to game history
			this.playerData.gameHistory.unshift(newGame); // Add to the beginning
			this.playerData.totalGames++;

			// Update last active timestamp
			this.playerData.lastActive = Date.now();

			// Save the updated data
			await this.savePlayerData();

			return new Response(
				JSON.stringify({
					success: true,
					gameId: gameData.gameId,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} catch (error) {
			return new Response(JSON.stringify({ error: 'Invalid request data' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	}

	// Handle PUT /update-game - Update an existing game's outcome
	private async handleUpdateGame(request: Request): Promise<Response> {
		if (!this.playerData) {
			return new Response(JSON.stringify({ error: 'Player profile not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		try {
			const updateData = (await request.json()) as GameUpdateRequest;

			// Validate required fields
			if (!updateData.gameId || !updateData.outcome) {
				return new Response(JSON.stringify({ error: 'Missing required update data' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// Find the game in history
			const gameIndex = this.playerData.gameHistory.findIndex((game) => game.gameId === updateData.gameId);

			if (gameIndex === -1) {
				return new Response(JSON.stringify({ error: 'Game not found in history' }), {
					status: 404,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// Update the game
			this.playerData.gameHistory[gameIndex].outcome = updateData.outcome;
			this.playerData.gameHistory[gameIndex].endTime = updateData.endTime || Date.now();

			// Update win/loss counters
			if (updateData.outcome === 'win') {
				this.playerData.wins++;
			} else if (updateData.outcome === 'loss') {
				this.playerData.losses++;
			}

			// Update last active timestamp
			this.playerData.lastActive = Date.now();

			// Save the updated data
			await this.savePlayerData();

			return new Response(
				JSON.stringify({
					success: true,
					gameId: updateData.gameId,
					outcome: updateData.outcome,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} catch (error) {
			return new Response(JSON.stringify({ error: 'Invalid request data' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	}

	// Handle GET /preferences - Return player preferences
	private handleGetPreferences(): Response {
		if (!this.playerData) {
			return new Response(JSON.stringify({ error: 'Player profile not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		return new Response(
			JSON.stringify({
				preferences: this.playerData.preferences,
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	// Handle PUT /preferences - Update player preferences
	private async handleUpdatePreferences(request: Request): Promise<Response> {
		if (!this.playerData) {
			return new Response(JSON.stringify({ error: 'Player profile not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		try {
			const updates = (await request.json()) as PreferencesUpdate;

			// Update the preference fields
			if (updates.notifications !== undefined) {
				this.playerData.preferences.notifications = !!updates.notifications;
			}

			if (updates.theme !== undefined) {
				this.playerData.preferences.theme = updates.theme;
			}

			if (updates.boardLayout !== undefined) {
				this.playerData.preferences.boardLayout = updates.boardLayout;
			}

			// Update last active timestamp
			this.playerData.lastActive = Date.now();

			// Save the updated data
			await this.savePlayerData();

			return new Response(
				JSON.stringify({
					success: true,
					preferences: this.playerData.preferences,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} catch (error) {
			return new Response(JSON.stringify({ error: 'Invalid request data' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	}

	// Save player data to durable storage
	private async savePlayerData(): Promise<void> {
		if (this.playerData) {
			await this.state.storage.put('playerData', this.playerData);
		}
	}
}
