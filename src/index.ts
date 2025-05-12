/**
 * ZK Battleship Backend Service - Production Grade
 *
 * Main entry point for the Cloudflare Worker that routes requests
 * to the appropriate handler and manages Durable Object interactions.
 *
 * Features:
 * - 60-second turn timeouts
 * - 10-minute game maximum duration
 * - Comprehensive error handling
 * - Performance monitoring
 * - Admin dashboard
 * - Health checks
 */
import { handleSessionRequest } from './api/sessions';
import { handlePlayerRequest } from './api/players';
import { handleInviteRequest } from './api/invites';
import { handleContractRequest } from './api/contracts';
import { handleAdminRequest, createMonitoringDashboard } from './api/admin';
import { ErrorHandler, ErrorCode } from './utils/errorMonitoring';

// Import and re-export the Durable Object classes
import { GameSession } from './durable_objects/GameSession';
import { PlayerProfile } from './durable_objects/PlayerProfile';
import { InviteManager } from './durable_objects/InviteManager';

// Export the Durable Object classes so Cloudflare can find them
export { GameSession, PlayerProfile, InviteManager };

// Add a global startTime for uptime tracking
declare global {
    var startTime: number;
}
globalThis.startTime = Date.now();

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
	ENVIRONMENT?: string; // 'development' | 'staging' | 'production'
	LOG_LEVEL?: string; // 'error' | 'warn' | 'info' | 'debug'
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// Add request ID for tracing
		const requestId = crypto.randomUUID();
		const startTime = Date.now();

		try {
			// Special handling for WebSocket upgrades at the very beginning
			if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
				const url = new URL(request.url);
				return handleWebSocketConnection(request, env, url);
			}

			// Handle CORS preflight requests
			if (request.method === 'OPTIONS') {
				return handleOptions(request);
			}

			// Log request
			logRequest(request, requestId, env);

			// Handle the request and apply CORS headers to the response
			const response = await handleRequest(request, env, ctx, requestId);

			// Log response
			logResponse(request, response, startTime, requestId, env);

			return addCorsHeaders(response);
		} catch (error) {
			// Handle any uncaught errors
			console.error(`Unhandled error in request ${requestId}:`, error);

			const errorResponse = ErrorHandler.handleError(error, {
				sessionId: getSessionIdFromRequest(request),
			});

			return addCorsHeaders(errorResponse);
		}
	},
};

/**
 * Main request handler - routes requests to the appropriate handler
 */
async function handleRequest(request: Request, env: Env, ctx: ExecutionContext, requestId: string): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;

	// Admin endpoints (secure these in production)
	if (path.startsWith('/admin/')) {
		return handleAdminRequest(request, env, ctx);
	}

	// Monitoring dashboard
	if (path === '/admin' || path === '/dashboard') {
		return new Response(createMonitoringDashboard(), {
			headers: { 'Content-Type': 'text/html' },
		});
	}

	// API routes
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

	// Health check endpoint
	if (path === '/health') {
		return handleHealthCheck(env);
	}

	// Handle root path - provide basic info
	if (path === '/' || path === '') {
		return new Response(
			JSON.stringify({
				name: 'ZK Battleship API',
				version: '1.0.0',
				status: 'online',
				environment: env.ENVIRONMENT || 'development',
				features: {
					turnTimeoutMs: 60 * 1000,
					gameTimeoutMs: 10 * 60 * 1000,
					shipTracking: true,
					errorMonitoring: true,
					performanceMetrics: true,
				},
				timestamp: Date.now(),
				requestId,
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	// Default response for unmatched routes
	return new Response(
		JSON.stringify({
			error: 'Not Found',
			path,
			requestId,
		}),
		{
			status: 404,
			headers: { 'Content-Type': 'application/json' },
		}
	);
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
		// Validate sessionId format
		if (!isValidSessionId(sessionId)) {
			throw ErrorHandler.createError(ErrorCode.VALIDATION_FAILED, 'Invalid session ID format', { sessionId });
		}

		// Create or get the GameSession Durable Object
		const id = env.GAME_SESSIONS.idFromName(sessionId);
		const gameSession = env.GAME_SESSIONS.get(id);

		// Forward the WebSocket connection to the Durable Object
		return await gameSession.fetch(request);
	} catch (error) {
		console.error('WebSocket connection error:', error);
		return ErrorHandler.handleError(error, { sessionId });
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
 * Simple health check endpoint
 */
async function handleHealthCheck(env: Env): Promise<Response> {
	const health = {
		status: 'ok',
		timestamp: Date.now(),
		version: '1.0.0',
		checks: {
			durableObjects: true,
			megaeth: !!env.MEGAETH_RPC_URL,
		},
	};

	return new Response(JSON.stringify(health), {
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * Adds CORS headers to a response
 */
function addCorsHeaders(response: Response): Response {
	// For WebSocket responses (status 101), don't modify them
	if (response.status === 101) {
		return response;
	}

	// Check if the status code is valid (200-599)
	const status = response.status >= 200 && response.status <= 599 ? response.status : 500;

	// Create a new response with the original's body, status and status text
	const newResponse = new Response(response.body, {
		status,
		statusText: response.statusText,
		headers: response.headers,
	});

	// Add CORS headers
	Object.entries(corsHeaders).forEach(([key, value]) => {
		newResponse.headers.set(key, value);
	});

	return newResponse;
}

/**
 * Validate session ID format
 */
function isValidSessionId(sessionId: string): boolean {
	// UUID v4 format
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	return uuidRegex.test(sessionId);
}

/**
 * Extract session ID from request (if available)
 */
function getSessionIdFromRequest(request: Request): string | undefined {
	try {
		const url = new URL(request.url);

		// Check URL parameters
		const sessionId = url.searchParams.get('sessionId');
		if (sessionId) return sessionId;

		// Check path
		const pathMatch = url.pathname.match(/\/sessions\/([a-zA-Z0-9-]+)/);
		if (pathMatch) return pathMatch[1];

		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * Log incoming requests
 */
function logRequest(request: Request, requestId: string, env: Env): void {
	if (shouldLog('info', env)) {
		const logData = {
			type: 'request',
			requestId,
			method: request.method,
			url: request.url,
			userAgent: request.headers.get('User-Agent'),
			timestamp: Date.now(),
		};
		console.log(JSON.stringify(logData));
	}
}

/**
 * Log outgoing responses
 */
function logResponse(request: Request, response: Response, startTime: number, requestId: string, env: Env): void {
	const duration = Date.now() - startTime;

	if (shouldLog('info', env)) {
		const logData = {
			type: 'response',
			requestId,
			method: request.method,
			url: request.url,
			status: response.status,
			duration,
			timestamp: Date.now(),
		};
		console.log(JSON.stringify(logData));
	}

	// Log slow requests as warnings
	if (duration > 1000 && shouldLog('warn', env)) {
		console.warn(`Slow request: ${requestId} took ${duration}ms`);
	}
}

/**
 * Check if we should log at a specific level
 */
function shouldLog(level: string, env: Env): boolean {
	const logLevel = env.LOG_LEVEL || 'info';
	const levels = ['error', 'warn', 'info', 'debug'];
	const currentLevelIndex = levels.indexOf(logLevel);
	const requestedLevelIndex = levels.indexOf(level);

	return requestedLevelIndex <= currentLevelIndex;
}
