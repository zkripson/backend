/**
 *Contracts API Endpoints with Improved Integration
 *
 * Handles interactions with deployed Base Sepolia smart contracts using
 * the enhanced ContractGameService with proper error handling and type safety
 */
import { Env } from '../types';
import { ContractGameService, getContractAddresses } from '../services/contractService';
import { ErrorHandler, ErrorCode } from '../utils/errorMonitoring';

/**
 * Main handler for contract-related API requests
 */
export async function handleContractRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;

	// Contract configuration
	if (path.endsWith('/api/contracts/config')) {
		return handleGetContractConfig(env);
	}

	// Player statistics
	if (path.endsWith('/api/contracts/player-stats')) {
		return handleGetPlayerStats(request, env);
	}

	// Global statistics
	if (path.endsWith('/api/contracts/global-stats')) {
		return handleGetGlobalStats(env);
	}

	// Leaderboard (placeholder for now)
	if (path.endsWith('/api/contracts/leaderboard')) {
		return handleGetLeaderboard(request, env);
	}

	// Reward status
	if (path.endsWith('/api/contracts/reward-status')) {
		return handleGetRewardStatus(request, env);
	}

	// Reward parameters
	if (path.endsWith('/api/contracts/reward-params')) {
		return handleGetRewardParams(env);
	}

	// Game contract address lookup
	if (path.endsWith('/api/contracts/game-contract')) {
		return handleGetGameContract(request, env);
	}

	// Health check for contract connectivity
	if (path.endsWith('/api/contracts/health')) {
		return handleContractHealth(env);
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
	try {
		const contractService = new ContractGameService(env);
		const config = contractService.getContractConfig();
		const contractAddresses = getContractAddresses(env);

		const fullConfig = {
			network: env.NETWORK === 'base' ? 'Base Mainnet' : 'Base Sepolia',
			chainId: env.NETWORK === 'base' ? 8453 : 84532,
			contracts: contractAddresses,
			...config,
			features: {
				gameFactory: true,
				statistics: true,
				rewards: true,
				nft: false, // Not implemented yet
				zkProofs: false, // Simplified version without ZK
			},
		};

		return new Response(JSON.stringify(fullConfig), {
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
			},
		});
	} catch (error: unknown) {
		console.error('Error getting contract config:', error);
		return ErrorHandler.handleError(error);
	}
}

/**
 * Handle GET /api/contracts/player-stats?address=... - Get player statistics from contract
 */
async function handleGetPlayerStats(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const address = url.searchParams.get('address');

	if (!address) {
		return ErrorHandler.handleError(ErrorHandler.createError(ErrorCode.VALIDATION_FAILED, 'Player address is required'));
	}

	// Validate address format
	if (!address.match(/^0x[a-fA-F0-9]{40}$/)) {
		return ErrorHandler.handleError(ErrorHandler.createError(ErrorCode.VALIDATION_FAILED, 'Invalid address format'));
	}

	try {
		const contractService = new ContractGameService(env);
		const stats = await contractService.getPlayerStats(address as `0x${string}`);

		return new Response(
			JSON.stringify({
				success: true,
				address,
				stats,
				timestamp: Date.now(),
			}),
			{
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				},
			}
		);
	} catch (error: unknown) {
		console.error('Error fetching player stats:', error);
		return ErrorHandler.handleError(error);
	}
}

/**
 * Handle GET /api/contracts/global-stats - Get global game statistics
 */
async function handleGetGlobalStats(env: Env): Promise<Response> {
	try {
		const contractService = new ContractGameService(env);
		const stats = await contractService.getGlobalStats();

		return new Response(
			JSON.stringify({
				success: true,
				stats,
				timestamp: Date.now(),
			}),
			{
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				},
			}
		);
	} catch (error: unknown) {
		console.error('Error fetching global stats:', error);
		return ErrorHandler.handleError(error);
	}
}

/**
 * Handle GET /api/contracts/leaderboard?type=wins&limit=10 - Get leaderboard
 * Note: This is a placeholder implementation - the actual leaderboard
 * would need to be implemented in the Statistics contract
 */
async function handleGetLeaderboard(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const type = url.searchParams.get('type') || 'wins';
	const limit = parseInt(url.searchParams.get('limit') || '10');

	// Validate leaderboard type
	const validTypes = ['wins', 'winRate', 'streak', 'weekly', 'monthly'];
	if (!validTypes.includes(type)) {
		return ErrorHandler.handleError(ErrorHandler.createError(ErrorCode.VALIDATION_FAILED, 'Invalid leaderboard type', { validTypes }));
	}

	// Validate limit
	if (limit < 1 || limit > 100) {
		return ErrorHandler.handleError(ErrorHandler.createError(ErrorCode.VALIDATION_FAILED, 'Limit must be between 1 and 100'));
	}

	try {
		// TODO: Implement actual leaderboard functionality in contracts
		// For now, return a placeholder response
		const mockLeaderboard = Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
			rank: i + 1,
			player: `0x${'1'.repeat(40)}` as `0x${string}`,
			score: 100 - i * 10,
			type,
		}));

		return new Response(
			JSON.stringify({
				success: true,
				leaderboard: mockLeaderboard,
				type,
				limit,
				timestamp: Date.now(),
				note: 'Leaderboard functionality requires contract implementation',
			}),
			{
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				},
			}
		);
	} catch (error: unknown) {
		console.error('Error fetching leaderboard:', error);
		return ErrorHandler.handleError(error);
	}
}

/**
 * Handle GET /api/contracts/reward-status?address=... - Check reward eligibility
 */
async function handleGetRewardStatus(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const address = url.searchParams.get('address');

	if (!address) {
		return ErrorHandler.handleError(ErrorHandler.createError(ErrorCode.VALIDATION_FAILED, 'Player address is required'));
	}

	// Validate address format
	if (!address.match(/^0x[a-fA-F0-9]{40}$/)) {
		return ErrorHandler.handleError(ErrorHandler.createError(ErrorCode.VALIDATION_FAILED, 'Invalid address format'));
	}

	try {
		const contractService = new ContractGameService(env);
		const canReceive = await contractService.canReceiveReward(address as `0x${string}`);

		return new Response(
			JSON.stringify({
				success: true,
				address,
				canReceiveReward: canReceive.canReceive,
				reason: canReceive.reason,
				timestamp: Date.now(),
			}),
			{
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				},
			}
		);
	} catch (error: unknown) {
		console.error('Error checking reward status:', error);
		return ErrorHandler.handleError(error);
	}
}

/**
 * Handle GET /api/contracts/reward-params - Get current reward parameters
 */
async function handleGetRewardParams(env: Env): Promise<Response> {
	try {
		const contractService = new ContractGameService(env);
		const rewardParams = await contractService.getRewardParams();

		return new Response(
			JSON.stringify({
				success: true,
				rewardParams: {
					participationReward: rewardParams.participationReward,
					victoryBonus: rewardParams.victoryBonus,
					// Convert to human readable format (assuming 18 decimals for SHIP tokens)
					participationRewardFormatted: (rewardParams.participationReward / 1e18).toFixed(2) + ' SHIP',
					victoryBonusFormatted: (rewardParams.victoryBonus / 1e18).toFixed(2) + ' SHIP',
				},
				timestamp: Date.now(),
			}),
			{
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				},
			}
		);
	} catch (error: unknown) {
		console.error('Error getting reward parameters:', error);
		return ErrorHandler.handleError(error);
	}
}

/**
 * Handle GET /api/contracts/game-contract?gameId=... - Get game contract address
 */
async function handleGetGameContract(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const gameIdParam = url.searchParams.get('gameId');

	if (!gameIdParam) {
		return ErrorHandler.handleError(ErrorHandler.createError(ErrorCode.VALIDATION_FAILED, 'Game ID is required'));
	}

	const gameId = parseInt(gameIdParam);
	if (isNaN(gameId) || gameId < 0) {
		return ErrorHandler.handleError(ErrorHandler.createError(ErrorCode.VALIDATION_FAILED, 'Invalid game ID'));
	}

	try {
		const contractService = new ContractGameService(env);
		const gameContractAddress = await contractService.getGameContract(gameId);

		return new Response(
			JSON.stringify({
				success: true,
				gameId,
				gameContractAddress,
				timestamp: Date.now(),
			}),
			{
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				},
			}
		);
	} catch (error: unknown) {
		console.error('Error getting game contract address:', error);
		return ErrorHandler.handleError(error);
	}
}

/**
 * Handle GET /api/contracts/health - Check contract connectivity
 */
async function handleContractHealth(env: Env): Promise<Response> {
	const contractAddresses = getContractAddresses(env);
	const checks: Record<string, boolean> = {};

	try {
		const contractService = new ContractGameService(env);

		// Test basic connectivity by trying to get global stats
		try {
			const stats = await contractService.getGlobalStats();
			checks.statistics = true;
			checks.connectivity = true;
		} catch (error) {
			console.error('Statistics contract check failed:', error);
			checks.statistics = false;
			checks.connectivity = false;
		}

		// Test reward contract
		try {
			await contractService.getRewardParams();
			checks.rewards = true;
		} catch (error) {
			console.error('Rewards contract check failed:', error);
			checks.rewards = false;
		}

		// Test factory contract by checking if we can read games mapping
		try {
			// Try to get a non-existent game (should not throw for valid contract)
			await contractService.getGameContract(999999);
			checks.gameFactory = true;
		} catch (error: any) {
			// This is expected for non-existent game, but if contract is unreachable,
			// it would be a different error
			if (error?.message?.includes('contract')) {
				checks.gameFactory = false;
			} else {
				checks.gameFactory = true;
			}
		}

		// Determine overall health
		const healthyChecks = Object.values(checks).filter(Boolean).length;
		const totalChecks = Object.keys(checks).length;
		const status = healthyChecks === totalChecks ? 'healthy' : healthyChecks > totalChecks / 2 ? 'degraded' : 'unhealthy';

		return new Response(
			JSON.stringify({
				status,
				contracts: contractAddresses,
				network: env.NETWORK === 'base' ? 'Base Mainnet' : 'Base Sepolia',
				chainId: env.NETWORK === 'base' ? 8453 : 84532,
				checks,
				rpcUrl: env.BASE_RPC_URL || 'https://sepolia.base.org',
				timestamp: Date.now(),
			}),
			{
				status: status === 'healthy' ? 200 : status === 'degraded' ? 206 : 503,
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				},
			}
		);
	} catch (error) {
		console.error('Contract health check failed:', error);
		return new Response(
			JSON.stringify({
				status: 'unhealthy',
				error: 'Failed to connect to contracts',
				details: error instanceof Error ? error.message : String(error),
				contracts: contractAddresses,
				timestamp: Date.now(),
			}),
			{
				status: 503,
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				},
			}
		);
	}
}
