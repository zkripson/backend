/**
 * ZK Battleship Backend Service
 *
 * Main entry point for the Cloudflare Worker that routes requests
 * to the appropriate handler and manages Durable Object interactions.
 */
import { handleSessionRequest } from './api/sessions';
import { handlePlayerRequest } from './api/players';
import { handleInviteRequest } from './api/invites';
import { handleContractRequest } from './api/contracts';

// Import and re-export the Durable Object classes
import { GameSession } from './durable_objects/GameSession';
import { PlayerProfile } from './durable_objects/PlayerProfile';
import { InviteManager } from './durable_objects/InviteManager';

// Export the Durable Object classes so Cloudflare can find them
export { GameSession, PlayerProfile, InviteManager };

// CORS headers to allow cross-origin requests
const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
	'Access-Control-Max-Age': '86400', // 24 hours
};

export interface Env {
	// Durable Object bindings
	GAME_SESSIONS: DurableObjectNamespace;
	PLAYER_PROFILES: DurableObjectNamespace;
	INVITE_MANAGER: DurableObjectNamespace;

	// Environment variables
	MEGAETH_RPC_URL: string;
	GAME_FACTORY_ADDRESS: string;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return handleOptions(request);
		}

		try {
			// Handle the request and apply CORS headers to the response
			const response = await handleRequest(request, env, ctx);
			return addCorsHeaders(response);
		} catch (e) {
			// Handle any uncaught errors
			console.error('Unhandled error:', e);
			const errorResponse = new Response(JSON.stringify({ error: 'Internal Server Error' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			});
			return addCorsHeaders(errorResponse);
		}
	},
};

/**
 * Main request handler - routes requests to the appropriate handler
 */
async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;

	// Handle WebSocket connections (for real-time game updates)
	if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
		return handleWebSocketConnection(request, env, url);
	}

	// Route to appropriate API handlers
	if (path.startsWith('/api/sessions')) {
		return handleSessionRequest(request, env, ctx);
	}

	if (path.startsWith('/api/players')) {
		return handlePlayerRequest(request, env, ctx);
	}

	if (path.startsWith('/api/invites')) {
		return handleInviteRequest(request, env, ctx);
	}

	if (path.startsWith('/api/contracts')) {
		return handleContractRequest(request, env, ctx);
	}

	// Handle root path - provide basic info
	if (path === '/' || path === '') {
		return new Response(
			JSON.stringify({
				name: 'ZK Battleship API',
				version: '1.0.0',
				status: 'online',
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	// Default response for unmatched routes
	return new Response(JSON.stringify({ error: 'Not Found', path }), {
		status: 404,
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * Handles WebSocket connection requests by routing to the appropriate
 * Durable Object based on the connection type
 */
async function handleWebSocketConnection(request: Request, env: Env, url: URL): Promise<Response> {
	const sessionId = url.searchParams.get('sessionId');

	if (!sessionId) {
		return new Response(JSON.stringify({ error: 'Missing sessionId parameter' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		// Create or get the GameSession Durable Object
		const id = env.GAME_SESSIONS.idFromName(sessionId);
		const gameSession = env.GAME_SESSIONS.get(id);

		// Forward the WebSocket connection to the Durable Object
		return await gameSession.fetch(request);
	} catch (error) {
		console.error('WebSocket connection error:', error);
		return new Response(JSON.stringify({ error: 'Failed to establish WebSocket connection' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Handles CORS preflight requests
 */
function handleOptions(request: Request): Response {
	// Make sure the necessary headers are present
	// for this to be a valid pre-flight request
	const headers = request.headers;
	if (
		headers.get('Origin') !== null &&
		headers.get('Access-Control-Request-Method') !== null &&
		headers.get('Access-Control-Request-Headers') !== null
	) {
		// Handle CORS preflight request.
		// If you want to check the requested headers/methods, you can do that here.
		return new Response(null, {
			headers: corsHeaders,
			status: 204,
		});
	} else {
		// Handle standard OPTIONS request.
		return new Response(null, {
			headers: {
				Allow: 'GET, POST, PUT, DELETE, OPTIONS',
			},
			status: 204,
		});
	}
}

/**
 * Adds CORS headers to a response
 */
function addCorsHeaders(response: Response): Response {
	// Create a new response with the original's body, status and status text
	const newResponse = new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});

	// Add CORS headers
	Object.entries(corsHeaders).forEach(([key, value]) => {
		newResponse.headers.set(key, value);
	});

	return newResponse;
}
