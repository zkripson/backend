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
	shipPositions?: ShipCell[]; // Optional ship positions for local tracking
}

// Game timing constants
export const GAME_CONSTANTS = {
	TURN_TIMEOUT_MS: 30 * 1000, // 30 seconds
	GAME_TIMEOUT_MS: 3 * 60 * 1000, // 3 minutes
	BOARD_SIZE: 10,
	SHIP_LENGTHS: [5, 4, 3, 3, 2], // Carrier, Battleship, Cruiser, Submarine, Destroyer
	TOTAL_SHIPS: 5,
};

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

// Contract interaction types
export interface ContractConfig {
	rpcUrl: string;
	wsUrl: string;
	gameFactoryAddress: string;
	gameFactoryABI: string[];
	gameABI: string[];
	zkVerifierAddress: string;
	zkVerifierABI: string[];
}

export interface GameEvent {
	name: 'ShotFired' | 'ShotResult' | 'GameCompleted';
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
