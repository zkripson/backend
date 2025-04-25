export interface SessionData {
	sessionId: string;
	status: 'CREATED' | 'WAITING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
	players: string[];
	gameContractAddress: string | null;
	gameId: string | null;
	createdAt: number;
	lastActivityAt: number;
	currentTurn: string | null;
	turnStartedAt: number | null;
	playerBoards?: [string, string][]; // Optional if used
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
}
/**
 * PlayerProfile Durable Object
 *
 * Stores persistent player data including:
 * - Game history
 * - Win/loss records
 * - Profile information
 * - Preferences
 */

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
}

export interface GameHistoryEntry {
	gameId: string;
	sessionId: string;
	opponent: string;
	startTime: number;
	endTime: number | null;
	outcome: 'win' | 'loss' | 'forfeit' | 'timeout' | 'ongoing' | 'canceled';
}

export interface PlayerPreferences {
	notifications: boolean;
	theme: 'light' | 'dark' | 'system';
	boardLayout: string | null;
}
export interface GameUpdateRequest {
	gameId: string;
	outcome: 'win' | 'loss' | 'forfeit' | 'timeout' | 'ongoing' | 'canceled';
	endTime?: number;
}

export interface PreferencesUpdate {
	notifications?: boolean;
	theme?: 'light' | 'dark' | 'system';
	boardLayout?: string | null;
}

export interface ProfileUpdate {
	username?: string;
	avatar?: string;
	address?: string;
}
