/**
 * Invites API Endpoints
 *
 * Handles routing for invitation-related requests:
 * - Creating invite links
 * - Accepting invitations
 * - Checking invitation status
 */
import { Env } from '../types';
import { InvitationUpdate } from '../types';

/**
 * Main handler for invitation-related API requests
 */
export async function handleInviteRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;

	// Handle various invite endpoints
	if (path.endsWith('/api/invites/create')) {
		return handleCreateInvite(request, env);
	}

	if (path.endsWith('/api/invites/accept')) {
		return handleAcceptInvite(request, env);
	}

	if (path.endsWith('/api/invites/cancel')) {
		return handleCancelInvite(request, env);
	}

	// Get invite by ID
	const idMatch = path.match(/\/api\/invites\/([a-zA-Z0-9-]+)$/);
	if (idMatch) {
		return handleGetInviteById(idMatch[1], env);
	}

	// Get invite by code
	const codeMatch = path.match(/\/api\/invites\/code\/([a-zA-Z0-9]+)$/);
	if (codeMatch) {
		return handleGetInviteByCode(codeMatch[1], env);
	}

	// Default not found response
	return new Response(JSON.stringify({ error: 'Endpoint not found' }), {
		status: 404,
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * Handle POST /api/invites/create - Create a new invitation
 */
async function handleCreateInvite(request: Request, env: Env): Promise<Response> {
	// Ensure the request is a POST
	if (request.method !== 'POST') {
		return new Response(JSON.stringify({ error: 'Method not allowed' }), {
			status: 405,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		// Clone the request to ensure body can be read
		const requestClone = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: await request.clone().text(),
			redirect: request.redirect,
		});

		// Get the Invite Manager Durable Object
		const inviteManager = env.INVITE_MANAGER.get(env.INVITE_MANAGER.idFromName('global'));

		// Forward the request to create a new invitation
		const response = await inviteManager.fetch(
			new Request('https://dummy-url/create', {
				method: 'POST',
				headers: requestClone.headers,
				body: requestClone.body,
			})
		);

		return response;
	} catch (error) {
		console.error('Error creating invitation:', error);
		return new Response(JSON.stringify({ error: 'Failed to create invitation' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Handle POST /api/invites/accept - Accept an invitation
 */
/**
 * Handle POST /api/invites/accept - Accept an invitation
 */
async function handleAcceptInvite(request: Request, env: Env): Promise<Response> {
	// Ensure the request is a POST
	if (request.method !== 'POST') {
		return new Response(JSON.stringify({ error: 'Method not allowed' }), {
			status: 405,
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			},
		});
	}

	try {
		// Read request body just once and clone it
		const bodyText = await request.text();

		// Log the invite acceptance attempt to help with debugging
		console.log('Invite acceptance request:', bodyText);

		// Get the Invite Manager Durable Object
		const inviteManager = env.INVITE_MANAGER.get(env.INVITE_MANAGER.idFromName('global'));

		// Forward the request to accept the invitation
		const response = await inviteManager.fetch(
			new Request('https://dummy-url/accept', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: bodyText,
			})
		);

		// Add CORS headers to the response
		const responseData = await response.json();
		return new Response(JSON.stringify(responseData), {
			status: response.status,
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			},
		});
	} catch (error) {
		console.error('Error accepting invitation:', error);
		return new Response(
			JSON.stringify({
				error: 'Failed to accept invitation',
				details: error instanceof Error ? error.message : String(error),
			}),
			{
				status: 500,
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type',
				},
			}
		);
	}
}

/**
 * Handle POST /api/invites/cancel - Cancel an invitation
 */
async function handleCancelInvite(request: Request, env: Env): Promise<Response> {
	// Ensure the request is a POST
	if (request.method !== 'POST') {
		return new Response(JSON.stringify({ error: 'Method not allowed' }), {
			status: 405,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		// Get the Invite Manager Durable Object
		const inviteManager = env.INVITE_MANAGER.get(env.INVITE_MANAGER.idFromName('global'));

		// Forward the request to cancel the invitation
		const response = await inviteManager.fetch(
			new Request('https://dummy-url/cancel', {
				method: 'POST',
				headers: request.headers,
				body: request.body,
			})
		);

		return response;
	} catch (error) {
		console.error('Error canceling invitation:', error);
		return new Response(JSON.stringify({ error: 'Failed to cancel invitation' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Handle GET /api/invites/:id - Get invitation by ID
 */
async function handleGetInviteById(inviteId: string, env: Env): Promise<Response> {
	try {
		// Get the Invite Manager Durable Object
		const inviteManager = env.INVITE_MANAGER.get(env.INVITE_MANAGER.idFromName('global'));

		// Forward the request to get invitation details
		const response = await inviteManager.fetch(
			new Request(`https://dummy-url/status/${inviteId}`, {
				method: 'GET',
			})
		);

		return response;
	} catch (error) {
		console.error('Error getting invitation:', error);
		return new Response(JSON.stringify({ error: 'Failed to get invitation' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Handle GET /api/invites/code/:code - Get invitation by code
 */
async function handleGetInviteByCode(code: string, env: Env): Promise<Response> {
	try {
		// Get the Invite Manager Durable Object
		const inviteManager = env.INVITE_MANAGER.get(env.INVITE_MANAGER.idFromName('global'));

		// Forward the request to get invitation details by code
		const response = await inviteManager.fetch(
			new Request(`https://dummy-url/by-code/${code}`, {
				method: 'GET',
			})
		);

		return response;
	} catch (error) {
		console.error('Error getting invitation by code:', error);
		return new Response(JSON.stringify({ error: 'Failed to get invitation' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Helper function to update a player's game history when an invite is accepted
 */
async function updatePlayerGameHistory(playerAddress: string, gameData: any, env: Env): Promise<void> {
	// Get the player's profile Durable Object
	const playerIdFromAddress = env.PLAYER_PROFILES.idFromName(playerAddress);
	const playerProfile = env.PLAYER_PROFILES.get(playerIdFromAddress);

	// Check if profile exists
	const profileResponse = await playerProfile.fetch(
		new Request('https://dummy-url/profile', {
			method: 'GET',
		})
	);

	// Create profile if it doesn't exist
	if (profileResponse.status === 404) {
		await playerProfile.fetch(
			new Request('https://dummy-url/initialize', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					address: playerAddress,
				}),
			})
		);
	}

	// Add the game to the player's history
	const opponent = playerAddress === gameData.creator ? gameData.acceptedBy : gameData.creator;

	await playerProfile.fetch(
		new Request('https://dummy-url/add-game', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				gameId: gameData.gameId || crypto.randomUUID(),
				sessionId: gameData.sessionId,
				opponent: opponent,
				startTime: Date.now(),
			}),
		})
	);
}
