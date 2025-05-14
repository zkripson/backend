/**
 *Contracts API Endpoints
 *
 * Handles interactions with deployed Base Sepolia smart contracts using
 * the ContractGameService with proper error handling and type safety
 */
import { Env } from '../types';
import { ContractGameService } from '../services/contractService';
import { ErrorHandler, ErrorCode } from '../utils/errorMonitoring';

/**
 * Main handler for contract-related API requests
 */
export async function handleContractRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;

	// Player statistics
	if (path.endsWith('/api/contracts/player-stats')) {
		return handleGetPlayerStats(request, env);
	}

	// Global statistics
	if (path.endsWith('/api/contracts/global-stats')) {
		return handleGetGlobalStats(env);
	}

	// Reward status - check if a player can receive rewards
	if (path.endsWith('/api/contracts/reward-status')) {
		return handleGetRewardStatus(request, env);
	}

	// Reward parameters
	if (path.endsWith('/api/contracts/reward-params')) {
		return handleGetRewardParams(env);
	}

	// Default not found response
	return new Response(JSON.stringify({ error: 'Endpoint not found' }), {
		status: 404,
		headers: { 'Content-Type': 'application/json' },
	});
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
