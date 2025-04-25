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
