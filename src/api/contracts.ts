/**
 * Contracts API Endpoints
 *
 * Handles interactions with MegaETH smart contracts:
 * - Getting contract addresses and ABIs
 * - Recording on-chain game creations
 * - Syncing session state with contract state
 */
import { Env } from '../index';

/**
 * Main handler for contract-related API requests
 */
export async function handleContractRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;

	// Handle contract endpoints
	if (path.endsWith('/api/contracts/config')) {
		return handleGetContractConfig(env);
	}

	if (path.endsWith('/api/contracts/register-game')) {
		return handleRegisterGame(request, env);
	}

	if (path.endsWith('/api/contracts/sync-session')) {
		return handleSyncSession(request, env);
	}

	// Default not found response
	return new Response(JSON.stringify({ error: 'Endpoint not found' }), {
		status: 404,
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * Handle GET /api/contracts/config - Get contract configuration
 */
function handleGetContractConfig(env: Env): Response {
	// Return contract addresses and ABIs that clients need
	return new Response(
		JSON.stringify({
			megaEthConfig: {
				rpcUrl: env.MEGAETH_RPC_URL,
				wsUrl: env.MEGAETH_RPC_URL.replace('https://', 'wss://'),
				gameFactoryAddress: env.GAME_FACTORY_ADDRESS,
				gameFactoryABI: [
					'function createGame(address opponent) external returns (uint256 gameId)',
					'function games(uint256 gameId) external view returns (address)',
					'function playerGames(address player) external view returns (uint256[])',
				],
				gameABI: [
					'function initialize(uint256 _gameId, address _player1, address _player2, address _factory) public',
					'function submitBoard(bytes32 boardCommitment, bytes calldata zkProof) external',
					'function makeShot(uint8 x, uint8 y) external',
					'function submitShotResult(uint8 x, uint8 y, bool isHit, bytes calldata zkProof) external',
					'function verifyGameEnd(bytes calldata zkProof) external',
					'function forfeit() external',
					'event ShotFired(address indexed player, uint8 x, uint8 y, uint256 indexed gameId)',
					'event ShotResult(address indexed player, uint8 x, uint8 y, bool isHit, uint256 indexed gameId)',
					'event GameCompleted(address indexed winner, uint256 indexed gameId, uint256 endTime)',
				],
				zkVerifierAddress: '', // Would be populated from environment in production
				zkVerifierABI: [
					'function verifyBoardPlacement(bytes32 boardCommitment, bytes calldata proof) external view returns (bool)',
					'function verifyShotResult(bytes32 boardCommitment, uint8 x, uint8 y, bool claimed_hit, bytes calldata proof) external view returns (bool)',
					'function verifyGameEnd(bytes32 boardCommitment, bytes32 shotHistoryHash, bytes calldata proof) external view returns (bool)',
				],
			},
		}),
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
}

/**
 * Handle POST /api/contracts/register-game - Register an on-chain game with a session
 */
async function handleRegisterGame(request: Request, env: Env): Promise<Response> {
	// Ensure the request is a POST
	if (request.method !== 'POST') {
		return new Response(JSON.stringify({ error: 'Method not allowed' }), {
			status: 405,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const data = (await request.json()) as { sessionId: string; gameId: number; gameContractAddress: string };

		// Validate required fields
		if (!data.sessionId || !data.gameId || !data.gameContractAddress) {
			return new Response(
				JSON.stringify({
					error: 'Session ID, game ID, and contract address are required',
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// Get the Game Session Durable Object
		const sessionDO = env.GAME_SESSIONS.get(env.GAME_SESSIONS.idFromName(data.sessionId));

		// Forward the request to update session with contract info
		const response = await sessionDO.fetch(
			new Request('https://dummy-url/register-contract', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					gameId: data.gameId,
					gameContractAddress: data.gameContractAddress,
				}),
			})
		);

		return response;
	} catch (error) {
		console.error('Error registering game:', error);
		return new Response(JSON.stringify({ error: 'Failed to register game' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Handle POST /api/contracts/sync-session - Sync session state with contract state
 */
async function handleSyncSession(request: Request, env: Env): Promise<Response> {
	// Ensure the request is a POST
	if (request.method !== 'POST') {
		return new Response(JSON.stringify({ error: 'Method not allowed' }), {
			status: 405,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const data = (await request.json()) as { sessionId: string; event: any };

		// Validate required fields
		if (!data.sessionId || !data.event) {
			return new Response(
				JSON.stringify({
					error: 'Session ID and event data are required',
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// Get the Game Session Durable Object
		const sessionDO = env.GAME_SESSIONS.get(env.GAME_SESSIONS.idFromName(data.sessionId));

		// Forward the event to the session
		await sessionDO.fetch(
			new Request('https://dummy-url/event', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					type: 'game_event',
					event: data.event,
				}),
			})
		);

		return new Response(JSON.stringify({ success: true }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('Error syncing session:', error);
		return new Response(JSON.stringify({ error: 'Failed to sync session' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}
