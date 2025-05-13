export interface SessionData {
	sessionId: string;
	status: 'CREATED' | 'WAITING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'SETUP';
	players: string[];
	gameContractAddress: string | null;
	gameId: string | null;
	createdAt: number;
	lastActivityAt: number;
	currentTurn: string | null;
	turnStartedAt: number | null;
	playerBoardsArray?: [string, string][];
}

export interface GameData {
	gameStartedAt: number | null;
	shots: Shot[];
	shipCells: [string, ShipCell[]][];
	sunkShips: [string, number][];
}

export interface Shot {
	player: string;
	x: number;
	y: number;
	isHit: boolean;
	timestamp: number;
}

export interface ShipCell {
	x: number;
	y: number;
}

export interface JoinRequest {
	address: string;
}

export interface StartRequest {
	gameContractAddress: string;
	gameId: string;
}

export interface ForfeitRequest {
	address: string;
}

export interface SubmitBoardRequest {
	address: string;
	boardCommitment: string;
	shipPositions?: ShipCell[];
}

// Contract-related types
export interface ContractConfig {
	network: string;
	chainId: number;
	contracts: {
		SHIPToken: string;
		BattleshipGameImplementation: string;
		BattleshipStatistics: string;
		GameFactory: string;
		Backend: string;
	};
	megaEthConfig: {
		rpcUrl: string;
		wsUrl: string;
		gameFactoryAddress: string;
		gameFactoryABI: string[];
		gameABI: string[];
		zkVerifierAddress: string;
		zkVerifierABI: string[];
	};
	features: {
		gameFactory: boolean;
		statistics: boolean;
		rewards: boolean;
		nft: boolean;
		zkProofs: boolean;
	};
}

export interface PlayerStats {
	totalGames: number;
	wins: number;
	losses: number;
	draws: number;
	winRate: number;
	currentWinStreak: number;
	bestWinStreak: number;
	averageGameDuration: number;
	totalRewardsEarned: number;
	gamesThisWeek: number;
	weeklyWinRate: number;
}

export interface GlobalStats {
	totalGames: number;
	totalPlayers: number;
	averageDuration: number;
	totalPlayTime: number;
	longestGame: number;
	shortestGame: number;
	totalRewardsDistributed: number;
}

export interface RewardParams {
	participationReward: number;
	victoryBonus: number;
	participationRewardFormatted?: string;
	victoryBonusFormatted?: string;
}

export interface RewardStatus {
	canReceive: boolean;
	reason: string;
}

export interface LeaderboardEntry {
	rank: number;
	player: string;
	score: number;
	type: string;
}

export interface ContractHealthCheck {
	status: 'healthy' | 'degraded' | 'unhealthy';
	contracts: {
		SHIPToken: string;
		BattleshipGameImplementation: string;
		BattleshipStatistics: string;
		GameFactory: string;
		Backend: string;
	};
	network: string;
	chainId: number;
	checks: {
		connectivity: boolean;
		statistics: boolean;
		rewards: boolean;
		gameFactory: boolean;
	};
	rpcUrl: string;
	timestamp: number;
}

// Game constants
export const GAME_CONSTANTS = {
	TURN_TIMEOUT_MS: 15 * 1000, // 15 seconds
	GAME_TIMEOUT_MS: 3 * 60 * 1000, // 3 minutes
	BOARD_SIZE: 10,
	SHIP_LENGTHS: [5, 4, 3, 3, 2], // Carrier, Battleship, Cruiser, Submarine, Destroyer
	TOTAL_SHIPS: 5,
};

// Player profile types
export interface PlayerData {
	address: string;
	username: string | null;
	avatar: string | null;
	createdAt: number;
	lastActive: number;
	totalGames: number;
	wins: number;
	losses: number;
	gameHistory: GameHistoryEntry[];
	preferences: PlayerPreferences;
	// Game statistics
	averageGameDuration?: number;
	averageTurnTime?: number;
	totalShipsDestroyed?: number;
	bestWinStreak?: number;
}

export interface GameHistoryEntry {
	gameId: string;
	sessionId: string;
	opponent: string;
	startTime: number;
	endTime: number | null;
	outcome: 'win' | 'loss' | 'forfeit' | 'timeout' | 'time_limit' | 'ongoing' | 'canceled';
	gameDuration?: number;
	shipsDestroyed?: number;
	shotsFired?: number;
	accuracy?: number; // percentage of hits
}

export interface PlayerPreferences {
	notifications: boolean;
	theme: 'light' | 'dark' | 'system';
	boardLayout: string | null;
	soundEnabled: boolean;
	animationsEnabled: boolean;
	autoSubmitOnHit: boolean; // Automatically submit shot result when hit
}

export interface GameUpdateRequest {
	gameId: string;
	outcome: 'win' | 'loss' | 'forfeit' | 'timeout' | 'time_limit' | 'ongoing' | 'canceled';
	endTime?: number;
	gameDuration?: number;
	shipsDestroyed?: number;
	shotsFired?: number;
	accuracy?: number;
}

export interface PreferencesUpdate {
	notifications?: boolean;
	theme?: 'light' | 'dark' | 'system';
	boardLayout?: string | null;
	soundEnabled?: boolean;
	animationsEnabled?: boolean;
	autoSubmitOnHit?: boolean;
}

export interface ProfileUpdate {
	username?: string;
	avatar?: string;
	address?: string;
}

// Invitation types
export interface Invitation {
	id: string;
	code: string;
	creator: string;
	createdAt: number;
	expiresAt: number;
	sessionId: string | null;
	status: 'pending' | 'accepted' | 'expired' | 'canceled';
	acceptedBy: string | null;
	acceptedAt: number | null;
}

export interface InvitationUpdate {
	id: string;
	status: 'pending' | 'accepted' | 'expired' | 'canceled';
	code: string | null;
	player: string | null;
	creator: string | null;
	acceptedBy: string | null;
	acceptedAt: number | null;
}

export interface InvitationCreateRequest {
	code: string;
	creator: string;
	expirationHours: number;
	sessionId: string | null;
}

export interface SessionCreateRequest {
	creator: string;
}

// WebSocket message types
export interface WebSocketMessage {
	type: 'chat' | 'game_event' | 'ping' | 'request_game_state';
	data?: any;
}

export interface GameStateMessage {
	type: 'session_state';
	data: {
		sessionId: string;
		status: string;
		players: string[];
		currentTurn: string | null;
		gameStartedAt: number | null;
		turnStartedAt: number | null;
		shots: Shot[];
		sunkShips: Record<string, number>;
		timeouts: {
			turnTimeoutMs: number;
			gameTimeoutMs: number;
		};
		gameId?: number | null;
		gameContractAddress?: string | null;
	};
}

export interface GameHistoryMessage {
	type: 'game_history';
	shots: Shot[];
}

export interface ShotFiredMessage {
	type: 'shot_fired';
	player: string;
	x: number;
	y: number;
	nextTurn: string | null;
	turnStartedAt: number;
}

export interface ShotResultMessage {
	type: 'shot_result';
	player: string;
	x: number;
	y: number;
	isHit: boolean;
	sunkShips: Record<string, number>;
}

export interface ShipSunkMessage {
	type: 'ship_sunk';
	player: string;
	targetPlayer: string;
	shipCells: ShipCell[];
	totalSunk: number;
}

export interface GameOverMessage {
	type: 'game_over';
	status: string;
	winner: string | null;
	reason: 'COMPLETED' | 'FORFEIT' | 'TIMEOUT' | 'TIME_LIMIT';
	finalState: {
		shots: Shot[];
		sunkShips: Record<string, number>;
		gameStartedAt: number;
		gameEndedAt: number;
	};
}

export interface RewardsDistributedMessage {
	type: 'rewards_distributed';
	gameId: number;
	rewards: Array<{
		player: string;
		isWinner: boolean;
	}>;
}

// Error handling types
export interface ErrorResponse {
	error: string;
	code?: string;
	details?: any;
}

export interface ValidationError {
	field: string;
	message: string;
}

// Contract event types
export interface GameEvent {
	name: 'ShotFired' | 'ShotResult' | 'GameCompleted' | 'GameCreated' | 'GameStarted' | 'RewardMinted';
	player?: string;
	x?: number;
	y?: number;
	isHit?: boolean;
	winner?: string;
	gameId: string;
	blockNumber: string;
	transactionHash: string;
	timestamp: number;
}

// Contract interaction types
export interface BatchReward {
	player: `0x${string}`;
	isWinner: boolean;
	gameId: number;
}

export interface GameCreationResult {
	gameId: number;
	gameContractAddress: `0x${string}`;
	transactionHash: `0x${string}`;
}

export interface GameCompletionResult {
	gameTransactionHash: `0x${string}`;
	factoryTransactionHash: `0x${string}`;
}

// Ship and board types (extended from shipTracker)
export interface Ship {
	id: string;
	length: number;
	cells: Array<{ x: number; y: number }>;
	hits: Array<{ x: number; y: number }>;
	isSunk: boolean;
}

export interface Board {
	size: number;
	ships: Ship[];
	cells: number[][]; // 0 = water, 1-5 = ship parts
}

// Environment types
export interface Env {
	// Durable Object bindings
	GAME_SESSIONS: DurableObjectNamespace;
	PLAYER_PROFILES: DurableObjectNamespace;
	INVITE_MANAGER: DurableObjectNamespace;

	// Contract addresses
	GAME_FACTORY_ADDRESS: string;
	BATTLESHIP_STATS_ADDRESS: string;
	SHIP_TOKEN_ADDRESS: string;
	BATTLESHIP_GAME_IMPL_ADDRESS: string;
	BACKEND_ADDRESS: string;
	VERIFIER_ADDRESS?: string;

	// Network configuration
	NETWORK: 'base' | 'base-sepolia';
	BASE_RPC_URL: string;
	BASE_CHAIN_ID: string;
	BASE_SEPOLIA_CHAIN_ID: string;
	BASE_SEPOLIA_RPC_URL: string;

	// Backend configuration
	BACKEND_PRIVATE_KEY: string;

	// Environment settings
	ENVIRONMENT?: 'development' | 'staging' | 'production';
	LOG_LEVEL?: 'error' | 'warn' | 'info' | 'debug';

	// Feature flags
	AUTO_DISTRIBUTE_REWARDS?: string; // 'true' | 'false'
	ENABLE_DEBUG_LOGS?: string; // 'true' | 'false'
	MOCK_CONTRACT_INTERACTIONS?: string; // 'true' | 'false'

	// Rate limiting
	RATE_LIMIT_PER_MINUTE?: string;

	// Optional configurations
	CORS_ORIGINS?: string;
	ADMIN_ACCESS_TOKEN?: string;
	TURN_TIMEOUT_MS?: string;
	GAME_TIMEOUT_MS?: string;
	REWARD_DISTRIBUTION_DELAY_MS?: string;
}
