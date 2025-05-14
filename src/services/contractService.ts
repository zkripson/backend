/**
 * Contract Integration Service
 *
 * Handles interactions with the deployed Base Sepolia smart contracts
 */
import { createPublicClient, createWalletClient, http, getContract, parseEventLogs } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { ErrorHandler, ErrorCode } from '../utils/errorMonitoring';

// Import ABIs from JSON files
// Note: Make sure tsconfig.json has "resolveJsonModule": true to allow importing JSON files
import GameFactoryABI from '../abis/GameFactoryWithStats.json';
import BattleshipGameABI from '../abis/BattleshipGameImplementation.json';
import SHIPTokenABI from '../abis/SHIPToken.json';
import StatisticsABI from '../abis/BattleshipStatistics.json';

// Define zero address for winner = null scenario
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`;

// Define event types for game events
export interface GameCreatedEvent {
	eventName: string;
	args: {
		gameId: bigint;
		player1: `0x${string}`;
		player2: `0x${string}`;
		gameAddress: `0x${string}`;
	};
}

// Helper function to ensure addresses are properly formatted
function ensureHexAddress(address: string | undefined, fallback: string): `0x${string}` {
	const addressToUse = address || fallback;
	// Ensure the address starts with 0x
	if (!addressToUse.startsWith('0x')) {
		return `0x${addressToUse}` as `0x${string}`;
	}
	return addressToUse as `0x${string}`;
}

// Get contract addresses from environment or use defaults for development
export function getContractAddresses(env: any) {
	return {
		SHIPToken: ensureHexAddress(env.SHIP_TOKEN_ADDRESS, '0xECD81000150F2A039Dd45cdc8Fa3832518C51Bf2'),
		BattleshipGameImplementation: ensureHexAddress(env.BATTLESHIP_GAME_IMPL_ADDRESS, '0xaBBc7a8f32819B15573e95C6EbC0A6ABfD205200'),
		BattleshipStatistics: ensureHexAddress(env.BATTLESHIP_STATS_ADDRESS, '0xdDC03eD3BFd6d4f39D685E93313601d68B832930'),
		GameFactory: ensureHexAddress(env.GAME_FACTORY_ADDRESS, '0x4D649D9EeF8f902CA0585F0822182363A5C0B19D'),
		Backend: ensureHexAddress(env.BACKEND_ADDRESS, '0x459D7FB72ac3dFB0666227B30F25A424A5583E9c'),
	};
}

// Contract ABIs imported from JSON files
export const GAME_FACTORY_ABI = GameFactoryABI;
export const BATTLESHIP_GAME_ABI = BattleshipGameABI;
export const SHIP_TOKEN_ABI = SHIPTokenABI;
export const STATISTICS_ABI = StatisticsABI;

// Initialize clients
export function createContractClients(env: any) {
	// Check for required private key
	if (!env.BACKEND_PRIVATE_KEY) {
		console.error('BACKEND_PRIVATE_KEY is not set in environment variables');
		throw new Error('Missing BACKEND_PRIVATE_KEY');
	}

	// Create account from private key
	const account = privateKeyToAccount(env.BACKEND_PRIVATE_KEY as `0x${string}`);

	// Determine network from environment
	const chain = env.NETWORK === 'base' ? base : baseSepolia;

	// Get contract addresses
	const contractAddresses = getContractAddresses(env);

	// Create public client for reading
	const publicClient = createPublicClient({
		chain,
		transport: http(env.BASE_RPC_URL || 'https://sepolia.base.org'),
	});

	// Create wallet client for writing
	const walletClient = createWalletClient({
		account,
		chain,
		transport: http(env.BASE_RPC_URL || 'https://sepolia.base.org'),
	});

	// Create contract instances
	const gameFactory = getContract({
		address: contractAddresses.GameFactory,
		abi: GAME_FACTORY_ABI.abi,
		client: { public: publicClient, wallet: walletClient },
	});

	const shipToken = getContract({
		address: contractAddresses.SHIPToken,
		abi: SHIP_TOKEN_ABI.abi,
		client: { public: publicClient, wallet: walletClient },
	});

	const statistics = getContract({
		address: contractAddresses.BattleshipStatistics,
		abi: STATISTICS_ABI.abi,
		client: { public: publicClient },
	});

	return {
		publicClient,
		walletClient,
		gameFactory,
		shipToken,
		statistics,
		account,
		contractAddresses,
	};
}

export class ContractGameService {
	private clients: ReturnType<typeof createContractClients>;
	private env: any;

	constructor(env: any) {
		this.env = env;
		try {
			console.log('Creating contract clients with RPC URL:', env.BASE_RPC_URL);
			this.clients = createContractClients(env);
		} catch (error) {
			console.error('Failed to create contract clients:', error);
			throw error;
		}
	}

	/**
	 * Get contract configuration for clients
	 */
	getContractConfig() {
		const contractAddresses = getContractAddresses(this.env);

		return {
			baseSepolia: {
				rpcUrl: this.env.BASE_RPC_URL || 'https://sepolia.base.org',
				wsUrl: (this.env.BASE_RPC_URL || 'https://sepolia.base.org').replace('https://', 'wss://'),
				gameFactoryAddress: contractAddresses.GameFactory,
				gameFactoryABI: GAME_FACTORY_ABI.abi,
				gameABI: BATTLESHIP_GAME_ABI.abi,
			},
		};
	}

	/**
	 * Create a new game on-chain
	 * Supports two versions of the createGame function:
	 * 1. createGame(player1, player2) - Create a game between two players
	 * 2. createGame(opponent) - Create a game where the sender is player1 and opponent is player2
	 */
	async createGame(
		player1OrSender: `0x${string}`,
		player2OrNull?: `0x${string}`
	): Promise<{
		gameId: number;
		gameContractAddress: `0x${string}`;
		transactionHash: `0x${string}`;
	}> {
		try {
			// Prepare args based on function version to call
			const args = player2OrNull ? [player1OrSender, player2OrNull] : [player1OrSender];

			// Use the modern writeContract pattern
			const hash = await this.clients.walletClient.writeContract({
				address: this.clients.contractAddresses.GameFactory,
				abi: GAME_FACTORY_ABI.abi,
				functionName: 'createGame',
				args,
				account: this.clients.account,
			});

			// Wait for transaction receipt
			const receipt = await this.clients.publicClient.waitForTransactionReceipt({
				hash,
			});

			// Parse events to get the game ID and contract address
			const logs = parseEventLogs({
				abi: GAME_FACTORY_ABI.abi,
				logs: receipt.logs,
			}) as any[];

			// Find the GameCreated event
			const gameCreatedEvent = logs.find((log) => log.eventName === 'GameCreated') as GameCreatedEvent | undefined;
			if (!gameCreatedEvent || !gameCreatedEvent.args) {
				throw new Error('GameCreated event not found in transaction receipt');
			}

			const gameId = Number(gameCreatedEvent.args.gameId);
			const gameContractAddress = gameCreatedEvent.args.gameAddress;

			if (player2OrNull) {
				console.log(`Game created: ID=${gameId}, Contract=${gameContractAddress}, Players=${player1OrSender},${player2OrNull}`);
			} else {
				console.log(`Game created: ID=${gameId}, Contract=${gameContractAddress}, Player vs ${player1OrSender}`);
			}

			return {
				gameId,
				gameContractAddress,
				transactionHash: hash,
			};
		} catch (error) {
			console.error('Error creating game:', error);
			throw ErrorHandler.createError(
				ErrorCode.CONTRACT_ERROR,
				`Failed to create game: ${error instanceof Error ? error.message : String(error)}`,
				{ player1: player1OrSender, player2: player2OrNull }
			);
		}
	}

	/**
	 * Start a game (transition from Created to Active)
	 */
	async startGame(gameId: number): Promise<{
		transactionHash: `0x${string}`;
		gameContractAddress: `0x${string}`;
	}> {
		try {
			// Get the game contract address using readContract
			const gameContractAddress = (await this.clients.publicClient.readContract({
				address: this.clients.contractAddresses.GameFactory,
				abi: GAME_FACTORY_ABI.abi,
				functionName: 'games',
				args: [BigInt(gameId)],
			})) as `0x${string}`;

			// Start the game using writeContract
			const hash = await this.clients.walletClient.writeContract({
				address: gameContractAddress,
				abi: BATTLESHIP_GAME_ABI.abi,
				functionName: 'startGame',
				account: this.clients.account,
			});

			await this.clients.publicClient.waitForTransactionReceipt({ hash });

			console.log(`Game ${gameId} started at contract ${gameContractAddress}`);

			return {
				transactionHash: hash,
				gameContractAddress: gameContractAddress,
			};
		} catch (error) {
			console.error('Error starting game:', error);
			throw ErrorHandler.createError(
				ErrorCode.CONTRACT_ERROR,
				`Failed to start game: ${error instanceof Error ? error.message : String(error)}`,
				{ gameId }
			);
		}
	}

	/**
	 * Submit game result when game ends
	 */
	async completeGame(
		gameId: number,
		winner: `0x${string}` | null,
		totalShots: number,
		endReason: string
	): Promise<{
		gameTransactionHash: `0x${string}`;
		factoryTransactionHash: `0x${string}`;
	}> {
		try {
			// Get game contract address using readContract
			const gameContractAddress = (await this.clients.publicClient.readContract({
				address: this.clients.contractAddresses.GameFactory,
				abi: GAME_FACTORY_ABI.abi,
				functionName: 'games',
				args: [BigInt(gameId)],
			})) as `0x${string}`;

			// Use zero address if winner is null
			const winnerAddress = winner || ZERO_ADDRESS;

			// Submit result to game contract using writeContract
			const gameHash = await this.clients.walletClient.writeContract({
				address: gameContractAddress,
				abi: BATTLESHIP_GAME_ABI.abi,
				functionName: 'submitGameResult',
				args: [winnerAddress, BigInt(totalShots), endReason],
				account: this.clients.account,
			});

			await this.clients.publicClient.waitForTransactionReceipt({ hash: gameHash });

			// Calculate game duration using readContract
			const createdAt = (await this.clients.publicClient.readContract({
				address: gameContractAddress,
				abi: BATTLESHIP_GAME_ABI.abi,
				functionName: 'createdAt',
			})) as bigint;

			const gameDuration = Math.floor(Date.now() / 1000) - Number(createdAt);

			// Report to factory for statistics using writeContract
			const factoryHash = await this.clients.walletClient.writeContract({
				address: this.clients.contractAddresses.GameFactory,
				abi: GAME_FACTORY_ABI.abi,
				functionName: 'reportGameCompletion',
				args: [BigInt(gameId), winnerAddress, BigInt(gameDuration), BigInt(totalShots), endReason],
				account: this.clients.account,
			});

			await this.clients.publicClient.waitForTransactionReceipt({ hash: factoryHash });

			console.log(`Game ${gameId} completed. Winner: ${winner || 'Draw'}, Reason: ${endReason}`);

			return {
				gameTransactionHash: gameHash,
				factoryTransactionHash: factoryHash,
			};
		} catch (error) {
			console.error('Error completing game:', error);
			throw ErrorHandler.createError(
				ErrorCode.CONTRACT_ERROR,
				`Failed to complete game: ${error instanceof Error ? error.message : String(error)}`,
				{ gameId, winner, endReason }
			);
		}
	}

	/**
	 * Get player statistics
	 */
	async getPlayerStats(playerAddress: `0x${string}`) {
		try {
			// Use readContract pattern for cleaner contract reading
			const stats = (await this.clients.publicClient.readContract({
				address: this.clients.contractAddresses.BattleshipStatistics,
				abi: STATISTICS_ABI.abi,
				functionName: 'getPlayerStats',
				args: [playerAddress],
			})) as bigint[];

			return {
				totalGames: Number(stats[0]),
				wins: Number(stats[1]),
				losses: Number(stats[2]),
				draws: Number(stats[3]),
				winRate: Number(stats[4]),
				currentWinStreak: Number(stats[5]),
				bestWinStreak: Number(stats[6]),
				averageGameDuration: Number(stats[7]),
				totalRewardsEarned: Number(stats[8]),
				gamesThisWeek: Number(stats[9]),
				weeklyWinRate: Number(stats[10]),
			};
		} catch (error) {
			console.error('Error getting player stats:', error);
			throw ErrorHandler.createError(
				ErrorCode.CONTRACT_ERROR,
				`Failed to get player stats: ${error instanceof Error ? error.message : String(error)}`,
				{ playerAddress }
			);
		}
	}

	/**
	 * Get global game statistics
	 */
	async getGlobalStats() {
		try {
			// Use readContract pattern for cleaner contract reading
			const stats = (await this.clients.publicClient.readContract({
				address: this.clients.contractAddresses.BattleshipStatistics,
				abi: STATISTICS_ABI.abi,
				functionName: 'getGlobalStats',
			})) as bigint[];

			console.log('Global stats:', stats);

			return {
				totalGames: Number(stats[0]),
				totalPlayers: Number(stats[1]),
				averageDuration: Number(stats[2]),
				totalPlayTime: Number(stats[3]),
				longestGame: Number(stats[4]),
				shortestGame: Number(stats[5]),
				totalRewardsDistributed: Number(stats[6]),
			};
		} catch (error) {
			console.error('Error getting global stats:', error);
			throw ErrorHandler.createError(
				ErrorCode.CONTRACT_ERROR,
				`Failed to get global stats: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Get current reward parameters
	 */
	async getRewardParams() {
		try {
			// Use readContract pattern for cleaner contract reading
			const params = (await this.clients.publicClient.readContract({
				address: this.clients.contractAddresses.SHIPToken,
				abi: SHIP_TOKEN_ABI.abi,
				functionName: 'getRewardParams',
			})) as [bigint, bigint];

			return {
				participationReward: Number(params[0]),
				victoryBonus: Number(params[1]),
			};
		} catch (error) {
			console.error('Error getting reward params:', error);
			throw ErrorHandler.createError(
				ErrorCode.CONTRACT_ERROR,
				`Failed to get reward params: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Check if player can receive rewards
	 */
	async canReceiveReward(playerAddress: `0x${string}`) {
		try {
			// Use readContract pattern for cleaner contract reading
			const result = (await this.clients.publicClient.readContract({
				address: this.clients.contractAddresses.SHIPToken,
				abi: SHIP_TOKEN_ABI.abi,
				functionName: 'canReceiveReward',
				args: [playerAddress],
			})) as [boolean, string];

			return {
				canReceive: result[0],
				reason: result[1],
			};
		} catch (error) {
			console.error('Error checking reward eligibility:', error);
			throw ErrorHandler.createError(
				ErrorCode.CONTRACT_ERROR,
				`Failed to check reward eligibility: ${error instanceof Error ? error.message : String(error)}`,
				{ playerAddress }
			);
		}
	}

	/**
	 * Get game contract address by game ID
	 */
	async getGameContract(gameId: number): Promise<`0x${string}`> {
		try {
			// Use readContract pattern for cleaner contract reading
			const address = await this.clients.publicClient.readContract({
				address: this.clients.contractAddresses.GameFactory,
				abi: GAME_FACTORY_ABI.abi,
				functionName: 'games',
				args: [BigInt(gameId)],
			});

			return address as `0x${string}`;
		} catch (error) {
			console.error('Error getting game contract:', error);
			throw ErrorHandler.createError(
				ErrorCode.CONTRACT_ERROR,
				`Failed to get game contract: ${error instanceof Error ? error.message : String(error)}`,
				{ gameId }
			);
		}
	}

	/**
	 * Monitor game events (simplified version - in production use event subscriptions)
	 */
	async watchGameEvents(callback: (event: any) => void) {
		// This is a simplified version - in production you'd use proper event subscriptions
		// with filters and efficient polling
		console.log('Event monitoring not implemented in this simplified version');
	}
}
