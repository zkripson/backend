/**
 * Players API Endpoints
 *
 * Handles routing for player-related requests:
 * - Player profiles
 * - Game history
 * - Stats and preferences
 */
import { Env } from '../index';

/**
 * Main handler for player-related API requests
 */
export async function handlePlayerRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;

	// Get player by address
	const addressMatch = path.match(/\/api\/players\/([0-9a-fA-Fx]+)$/);
	if (addressMatch) {
		const playerAddress = addressMatch[1];
		return handleGetPlayer(playerAddress, env);
	}

	// Player action endpoints
	const actionMatch = path.match(/\/api\/players\/([0-9a-fA-Fx]+)\/([a-z-]+)$/);
	if (actionMatch) {
		const playerAddress = actionMatch[1];
		const action = actionMatch[2];
		return handlePlayerAction(playerAddress, action, request, env);
	}

	// Default not found response
	return new Response(JSON.stringify({ error: 'Endpoint not found' }), {
		status: 404,
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * Handle GET /api/players/:address - Get player profile
 */
async function handleGetPlayer(address: string, env: Env): Promise<Response> {
	try {
		// Get the Durable Object for the player profile
		const playerIdFromAddress = env.PLAYER_PROFILES.idFromName(address);
		const playerProfile = env.PLAYER_PROFILES.get(playerIdFromAddress);

		// Forward the request to the Durable Object
		const response = await playerProfile.fetch(
			new Request('https://dummy-url/profile', {
				method: 'GET',
			})
		);

		// If profile doesn't exist, initialize it
		if (response.status === 404) {
			// Create the player profile
			await playerProfile.fetch(
				new Request('https://dummy-url/initialize', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						address: address,
					}),
				})
			);

			// Now get the newly created profile
			const newProfileResponse = await playerProfile.fetch(
				new Request('https://dummy-url/profile', {
					method: 'GET',
				})
			);

			return newProfileResponse;
		}

		return response;
	} catch (error) {
		console.error('Error getting player profile:', error);
		return new Response(JSON.stringify({ error: 'Failed to get player profile' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Handle player action endpoints like:
 * - GET/PUT /api/players/:address/profile
 * - GET /api/players/:address/game-history
 * - POST /api/players/:address/add-game
 * - PUT /api/players/:address/update-game
 * - GET/PUT /api/players/:address/preferences
 */
async function handlePlayerAction(address: string, action: string, request: Request, env: Env): Promise<Response> {
	try {
		// Get the Durable Object for the player profile
		const playerIdFromAddress = env.PLAYER_PROFILES.idFromName(address);
		const playerProfile = env.PLAYER_PROFILES.get(playerIdFromAddress);

		// Check if the profile exists for write operations
		if (request.method !== 'GET') {
			const checkResponse = await playerProfile.fetch(
				new Request('https://dummy-url/profile', {
					method: 'GET',
				})
			);

			if (checkResponse.status === 404) {
				// Create the player profile first
				await playerProfile.fetch(
					new Request('https://dummy-url/initialize', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							address: address,
						}),
					})
				);
			}
		}

		// Forward the request to the appropriate endpoint on the Durable Object
		const response = await playerProfile.fetch(
			new Request(`https://dummy-url/${action}`, {
				method: request.method,
				headers: request.headers,
				body: request.body,
			})
		);

		return response;
	} catch (error) {
		console.error(`Error handling player action ${action}:`, error);
		return new Response(JSON.stringify({ error: `Failed to process ${action} action` }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}
