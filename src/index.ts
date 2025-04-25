/**
 * ZK Battleship Backend Service
 *
 * Main entry point for the Cloudflare Worker that routes requests
 * to the appropriate handler and manages Durable Object interactions.
 */
// import { handleSessionRequest } from './api/sessions';
// import { handlePlayerRequest } from './api/players';
// import { handleInviteRequest } from './api/invites';
// import { handleContractRequest } from './api/contracts';

export interface Env {
	// Durable Object bindings
	GAME_SESSIONS: DurableObjectNamespace;
	PLAYER_PROFILES: DurableObjectNamespace;
	INVITE_MANAGER: DurableObjectNamespace;

	// Environment variables
	MEGAETH_RPC_URL: string;
	BASE_RPC_URL: string;
	TOKEN_CONTRACT_ADDRESS: string;
	DISTRIBUTOR_PRIVATE_KEY: string;
	GAME_FACTORY_ADDRESS: string;
}

export default {
	// async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	// 	const url = new URL(request.url);
	// 	const path = url.pathname;
	// 	// Handle WebSocket connections
	// 	if (request.headers.get('Upgrade') === 'websocket') {
	// 		return handleWebSocketConnection(request, env, url);
	// 	}
	// 	// API routes
	// 	if (path.startsWith('/api/sessions')) {
	// 		return handleSessionRequest(request, env, ctx);
	// 	}
	// 	if (path.startsWith('/api/players')) {
	// 		return handlePlayerRequest(request, env, ctx);
	// 	}
	// 	if (path.startsWith('/api/invites')) {
	// 		return handleInviteRequest(request, env, ctx);
	// 	}
	// 	if (path.startsWith('/api/contracts')) {
	// 		return handleContractRequest(request, env, ctx);
	// 	}
	// 	// Default response for unmatched routes
	// 	return new Response('Not Found', { status: 404 });
	// },
};

/**
 * Handles WebSocket connection requests by routing to the appropriate
 * Durable Object based on the connection type
 */
async function handleWebSocketConnection(request: Request, env: Env, url: URL): Promise<Response> {
	const sessionId = url.searchParams.get('sessionId');

	if (!sessionId) {
		return new Response('Missing sessionId parameter', { status: 400 });
	}

	// Create or get the GameSession Durable Object
	const id = env.GAME_SESSIONS.idFromString(sessionId);
	const gameSession = env.GAME_SESSIONS.get(id);

	// Forward the WebSocket connection to the Durable Object
	return gameSession.fetch(request);
}
