/**
 * Game Sessions API Endpoints
 *
 * Handles routing for session-related requests:
 * - Creating new game sessions
 * - Getting session information
 * - Managing ongoing games
 * - Player actions
 */
import { Env } from '../types';
import { SessionCreateRequest } from '../types';

/**
 * Main handler for session-related API requests
 */
export async function handleSessionRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;

	// Handle different session endpoints
	if (path.endsWith('/api/sessions/create')) {
		return handleCreateSession(request, env);
	}

	if (path.endsWith('/api/sessions/list')) {
		return handleListSessions(request, env);
	}

	// GET session by ID
	const sessionIdMatch = path.match(/\/api\/sessions\/([a-zA-Z0-9-]+)$/);
	if (sessionIdMatch) {
		return handleGetSession(sessionIdMatch[1], env);
	}

	// Session action endpoints
	const actionMatch = path.match(/\/api\/sessions\/([a-zA-Z0-9-]+)\/([a-z-]+)$/);
	if (actionMatch) {
		const sessionId = actionMatch[1];
		const action = actionMatch[2];
		return handleSessionAction(sessionId, action, request, env);
	}

	// Default not found response
	return new Response(JSON.stringify({ error: 'Endpoint not found' }), {
		status: 404,
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * Handle POST /api/sessions/create - Create a new game session
 */
async function handleCreateSession(request: Request, env: Env): Promise<Response> {
	// Ensure the request is a POST
	if (request.method !== 'POST') {
		return new Response(JSON.stringify({ error: 'Method not allowed' }), {
			status: 405,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const data = (await request.json()) as SessionCreateRequest;

		// Validate the creator address
		if (!data.creator) {
			return new Response(JSON.stringify({ error: 'Creator address is required' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Generate a unique session ID
		const sessionId = crypto.randomUUID();

		// Create a new Durable Object for the session
		const sessionDO = env.GAME_SESSIONS.get(env.GAME_SESSIONS.idFromName(sessionId));

		// Initialize the session
		await sessionDO.fetch(
			new Request('https://dummy-url/initialize', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					sessionId,
					creator: data.creator,
				}),
			})
		);

		// Update the player's profile to record the new game
		try {
			// Get or create player profile
			const playerIdFromAddress = env.PLAYER_PROFILES.idFromName(data.creator);
			const playerProfile = env.PLAYER_PROFILES.get(playerIdFromAddress);

			// Check if profile exists, if not initialize it
			const profileCheckResponse = await playerProfile.fetch(
				new Request('https://dummy-url/profile', {
					method: 'GET',
				})
			);

			if (profileCheckResponse.status === 404) {
				// Initialize the player profile
				await playerProfile.fetch(
					new Request('https://dummy-url/initialize', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							address: data.creator,
						}),
					})
				);
			}
		} catch (error) {
			// Log but don't fail if player profile update fails
			console.error('Error updating player profile:', error);
		}

		return new Response(
			JSON.stringify({
				sessionId,
				creator: data.creator,
				status: 'CREATED',
				createdAt: Date.now(),
			}),
			{
				status: 201,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	} catch (error) {
		console.error('Error creating session:', error);
		return new Response(JSON.stringify({ error: 'Failed to create session' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Handle GET /api/sessions/list - List user's active sessions
 * Note: This requires maintaining a separate index of sessions by player,
 * which isn't implemented in this example for simplicity.
 */
async function handleListSessions(request: Request, env: Env): Promise<Response> {
	// In a real implementation, you'd query a database or index to find
	// all sessions for a particular player address
	return new Response(
		JSON.stringify({
			error: 'Session listing not implemented in this version',
		}),
		{
			status: 501,
			headers: { 'Content-Type': 'application/json' },
		}
	);
}

/**
 * Handle GET /api/sessions/:id - Get session information
 */
async function handleGetSession(sessionId: string, env: Env): Promise<Response> {
	try {
		// Get the Durable Object for the session
		const sessionDO = env.GAME_SESSIONS.get(env.GAME_SESSIONS.idFromName(sessionId));

		// Forward the request to the Durable Object
		const response = await sessionDO.fetch(
			new Request('https://dummy-url/status', {
				method: 'GET',
			})
		);

		return response;
	} catch (error) {
		console.error('Error getting session:', error);
		return new Response(JSON.stringify({ error: 'Failed to get session' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Handle session action endpoints like:
 * - POST /api/sessions/:id/join
 * - POST /api/sessions/:id/start
 * - POST /api/sessions/:id/forfeit
 * - POST /api/sessions/:id/submit-board
 */
async function handleSessionAction(sessionId: string, action: string, request: Request, env: Env): Promise<Response> {
	// Ensure the request is a POST for actions
	if (request.method !== 'POST') {
		return new Response(JSON.stringify({ error: 'Method not allowed' }), {
			status: 405,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		// Get the Durable Object for the session
		const sessionDO = env.GAME_SESSIONS.get(env.GAME_SESSIONS.idFromName(sessionId));

		// Clone the request to ensure body can be read
		const requestClone = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: await request.clone().text(), // Clone and read as text
			redirect: request.redirect,
		});

		// Forward the request to the appropriate endpoint on the Durable Object
		return await sessionDO.fetch(
			new Request(`https://dummy-url/${action}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: requestClone.body,
			})
		);
	} catch (error: any) {
		console.error(`Error handling session action ${action}:`, error as Error);
		return new Response(JSON.stringify({ error: `Failed to process ${action} action: ${error.message}` }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}
