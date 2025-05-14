/**
 * Contract Integration Service
 *
 * Handles interactions with the deployed Base Sepolia smart contracts
 */
import { createPublicClient, createWalletClient, http, getContract, parseEventLogs } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { ErrorHandler, ErrorCode } from '../utils/errorMonitoring';

// Define zero address for winner = null scenario
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`;

// Define event types for game events
export interface GameCreatedEvent {
	eventName: string;
	args: {
		gameId: bigint;
		player1: `0x${string}`;
		player2: `0x${string}`;
		gameContract: `0x${string}`;
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

// Contract ABIs aligned with those used in API
export const GAME_FACTORY_ABI = [
	// Core functions
	'function createGame(address player1, address player2) external returns (uint256 gameId)',
	'function createGame(address opponent) external returns (uint256 gameId)',
	'function games(uint256 gameId) external view returns (address)',
	'function playerGames(address player) external view returns (uint256[])',
	'function reportGameCompletion(uint256 gameId, address winner, uint256 duration, uint256 totalShots, string calldata endReason) external',

	// Events
	'event GameCreated(uint256 indexed gameId, address indexed player1, address indexed player2, address gameContract)',
];

export const BATTLESHIP_GAME_ABI = [
	// Initialization and state management
	'function initialize(uint256 _gameId, address _player1, address _player2, address _factory) external',
	'function initialize(uint256 _gameId, address _player1, address _player2, address _factory) public',
	'function startGame() external',
	'function submitGameResult(address winner, uint256 totalShots, string calldata endReason) external',
	'function state() external view returns (uint8)',
	'function createdAt() external view returns (uint256)',

	// Game mechanics
	'function submitBoard(bytes32 boardCommitment, bytes calldata zkProof) external',
	'function makeShot(uint8 x, uint8 y) external',
	'function submitShotResult(uint8 x, uint8 y, bool isHit, bytes calldata zkProof) external',
	'function verifyGameEnd(bytes calldata zkProof) external',
	'function forfeit() external',

	// Events
	'event GameStarted(uint256 indexed gameId, uint256 startTime)',
	'event GameCompleted(uint256 indexed gameId, address indexed winner, uint256 endTime, string endReason)',
	'event ShotFired(address indexed player, uint8 x, uint8 y, uint256 indexed gameId)',
	'event ShotResult(address indexed player, uint8 x, uint8 y, bool isHit, uint256 indexed gameId)',
];

export const SHIP_TOKEN_ABI = [
	'function mintBatchRewards((address player, bool isWinner, uint256 gameId)[]) external',
	'function canReceiveReward(address player) external view returns (bool, string)',
	'function getRewardParams() external view returns (uint256 participationReward, uint256 victoryBonus)',
	'event RewardMinted(address indexed player, uint256 amount, bool isWinner, uint256 indexed gameId)',
];

export const STATISTICS_ABI = [
	'function getPlayerStats(address player) external view returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256)',
	'function getGlobalStats() external view returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256)',
	'function getLeaderboard(bytes32 leaderboardType, uint256 limit) external view returns ((address player, uint256 score, uint256 rank)[])',
];

export const VERIFIER_ABI = [
	'function verifyBoardPlacement(bytes32 boardCommitment, bytes calldata proof) external view returns (bool)',
	'function verifyShotResult(bytes32 boardCommitment, uint8 x, uint8 y, bool claimed_hit, bytes calldata proof) external view returns (bool)',
	'function verifyGameEnd(bytes32 boardCommitment, bytes32 shotHistoryHash, bytes calldata proof) external view returns (bool)',
];

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
		abi: GAME_FACTORY_ABI,
		client: { public: publicClient, wallet: walletClient },
	});

	const shipToken = getContract({
		address: contractAddresses.SHIPToken,
		abi: SHIP_TOKEN_ABI,
		client: { public: publicClient, wallet: walletClient },
	});

	const statistics = getContract({
		address: contractAddresses.BattleshipStatistics,
		abi: STATISTICS_ABI,
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
				gameFactoryABI: GAME_FACTORY_ABI,
				gameABI: BATTLESHIP_GAME_ABI,
				zkVerifierAddress: this.env.VERIFIER_ADDRESS || '',
				zkVerifierABI: VERIFIER_ABI,
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
			let hash;

			// Determine which function to call based on the number of arguments
			if (player2OrNull) {
				// Call createGame(player1, player2)
				hash = await this.clients.gameFactory.write.createGame([player1OrSender, player2OrNull]);
			} else {
				// Call createGame(opponent) where sender is player1
				hash = await this.clients.gameFactory.write.createGame([player1OrSender]);
			}

			// Wait for transaction receipt
			const receipt = await this.clients.publicClient.waitForTransactionReceipt({ hash });

			// Parse events to get the game ID and contract address
			const logs = parseEventLogs({
				abi: GAME_FACTORY_ABI,
				logs: receipt.logs,
			}) as any[];

			// Find the GameCreated event
			const gameCreatedEvent = logs.find((log) => log.eventName === 'GameCreated') as GameCreatedEvent | undefined;
			if (!gameCreatedEvent || !gameCreatedEvent.args) {
				throw new Error('GameCreated event not found in transaction receipt');
			}

			const gameId = Number(gameCreatedEvent.args.gameId);
			const gameContractAddress = gameCreatedEvent.args.gameContract;

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
			// Get the game contract address
			const gameContractAddress = await this.clients.gameFactory.read.games([BigInt(gameId)]);

			// Create game contract instance - ensuring address is correctly typed
			const gameContract = getContract({
				address: gameContractAddress as `0x${string}`,
				abi: BATTLESHIP_GAME_ABI,
				client: { public: this.clients.publicClient, wallet: this.clients.walletClient },
			});

			// Start the game
			const hash = await gameContract.write.startGame();
			await this.clients.publicClient.waitForTransactionReceipt({ hash });

			console.log(`Game ${gameId} started at contract ${gameContractAddress}`);

			return {
				transactionHash: hash,
				gameContractAddress: gameContractAddress as `0x${string}`,
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
			// Get game contract address
			const gameContractAddress = await this.clients.gameFactory.read.games([BigInt(gameId)]);

			// Create game contract instance - ensuring address is correctly typed
			const gameContract = getContract({
				address: gameContractAddress as `0x${string}`,
				abi: BATTLESHIP_GAME_ABI,
				client: { public: this.clients.publicClient, wallet: this.clients.walletClient },
			});

			// Submit result to game contract
			// Use zero address if winner is null
			const winnerAddress = winner || ZERO_ADDRESS;
			const gameHash = await gameContract.write.submitGameResult([winnerAddress, BigInt(totalShots), endReason]);

			await this.clients.publicClient.waitForTransactionReceipt({ hash: gameHash });

			// Calculate game duration
			const createdAt = await gameContract.read.createdAt();
			const gameDuration = Math.floor(Date.now() / 1000) - Number(createdAt);

			// Report to factory for statistics
			const factoryHash = await this.clients.gameFactory.write.reportGameCompletion([
				BigInt(gameId),
				winnerAddress,
				BigInt(gameDuration),
				BigInt(totalShots),
				endReason,
			]);

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
			// Cast the stats to proper type - it's an array of bigints
			const stats = (await this.clients.statistics.read.getPlayerStats([playerAddress])) as bigint[];

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
			// Cast the stats to proper type - it's an array of bigints
			const stats = (await this.clients.statistics.read.getGlobalStats()) as bigint[];

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
			// Cast the params to proper type - it's a tuple of [bigint, bigint]
			const params = (await this.clients.shipToken.read.getRewardParams()) as [bigint, bigint];
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
			// Cast the result to proper type - it's a tuple of [boolean, string]
			const result = (await this.clients.shipToken.read.canReceiveReward([playerAddress])) as [boolean, string];
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
			const address = await this.clients.gameFactory.read.games([BigInt(gameId)]);
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
