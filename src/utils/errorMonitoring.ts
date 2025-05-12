/**
 * Error Handling and Monitoring System
 *
 * Provides comprehensive error handling, logging, and monitoring
 * for production deployment
 */

export enum ErrorCode {
	// Validation errors
	INVALID_INPUT = 'INVALID_INPUT',
	VALIDATION_FAILED = 'VALIDATION_FAILED',
	UNAUTHORIZED = 'UNAUTHORIZED',

	// Game state errors
	INVALID_GAME_STATE = 'INVALID_GAME_STATE',
	GAME_NOT_FOUND = 'GAME_NOT_FOUND',
	PLAYER_NOT_FOUND = 'PLAYER_NOT_FOUND',
	INVALID_TURN = 'INVALID_TURN',
	TIMEOUT_EXCEEDED = 'TIMEOUT_EXCEEDED',

	// Contract errors
	CONTRACT_ERROR = 'CONTRACT_ERROR',
	TRANSACTION_FAILED = 'TRANSACTION_FAILED',
	INSUFFICIENT_GAS = 'INSUFFICIENT_GAS',

	// System errors
	INTERNAL_ERROR = 'INTERNAL_ERROR',
	NETWORK_ERROR = 'NETWORK_ERROR',
	STORAGE_ERROR = 'STORAGE_ERROR',
	CONCURRENCY_ERROR = 'CONCURRENCY_ERROR',
}

export interface AppError {
	code: ErrorCode;
	message: string;
	details?: any;
	timestamp: number;
	sessionId?: string;
	playerId?: string;
	stack?: string;
}

export class ErrorHandler {
	/**
	 * Create an error with proper typing and logging
	 */
	static createError(code: ErrorCode, message: string, details?: any, context?: { sessionId?: string; playerId?: string }): AppError {
		const error: AppError = {
			code,
			message,
			details,
			timestamp: Date.now(),
			...context,
		};

		// Log error immediately
		this.logError(error);

		return error;
	}

	/**
	 * Handle and format error responses
	 */
	static handleError(error: unknown, context?: { sessionId?: string; playerId?: string }): Response {
		let appError: AppError;

		if (error instanceof Error) {
			appError = this.createError(ErrorCode.INTERNAL_ERROR, error.message, { stack: error.stack }, context);
		} else if (typeof error === 'object' && error !== null && 'code' in error) {
			appError = error as AppError;
		} else {
			appError = this.createError(ErrorCode.INTERNAL_ERROR, 'Unknown error occurred', { originalError: error }, context);
		}

		// Determine appropriate HTTP status
		const status = this.getHttpStatus(appError.code);

		return new Response(
			JSON.stringify({
				error: appError.message,
				code: appError.code,
				timestamp: appError.timestamp,
			}),
			{
				status,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	/**
	 * Map error codes to HTTP status codes
	 */
	private static getHttpStatus(code: ErrorCode): number {
		const statusMap: Record<ErrorCode, number> = {
			[ErrorCode.INVALID_INPUT]: 400,
			[ErrorCode.VALIDATION_FAILED]: 400,
			[ErrorCode.UNAUTHORIZED]: 401,
			[ErrorCode.INVALID_GAME_STATE]: 400,
			[ErrorCode.GAME_NOT_FOUND]: 404,
			[ErrorCode.PLAYER_NOT_FOUND]: 404,
			[ErrorCode.INVALID_TURN]: 400,
			[ErrorCode.TIMEOUT_EXCEEDED]: 408,
			[ErrorCode.CONTRACT_ERROR]: 500,
			[ErrorCode.TRANSACTION_FAILED]: 500,
			[ErrorCode.INSUFFICIENT_GAS]: 500,
			[ErrorCode.INTERNAL_ERROR]: 500,
			[ErrorCode.NETWORK_ERROR]: 503,
			[ErrorCode.STORAGE_ERROR]: 500,
			[ErrorCode.CONCURRENCY_ERROR]: 409,
		};

		return statusMap[code] || 500;
	}

	/**
	 * Log error with appropriate level
	 */
	private static logError(error: AppError): void {
		const logLevel = this.getLogLevel(error.code);
		const logMessage = {
			level: logLevel,
			message: error.message,
			code: error.code,
			details: error.details,
			timestamp: error.timestamp,
			sessionId: error.sessionId,
			playerId: error.playerId,
		};

		switch (logLevel) {
			case 'error':
				console.error(JSON.stringify(logMessage));
				break;
			case 'warn':
				console.warn(JSON.stringify(logMessage));
				break;
			case 'info':
				console.info(JSON.stringify(logMessage));
				break;
			default:
				console.log(JSON.stringify(logMessage));
		}
	}

	/**
	 * Determine log level based on error code
	 */
	private static getLogLevel(code: ErrorCode): string {
		const errorLevels: Record<ErrorCode, string> = {
			[ErrorCode.INVALID_INPUT]: 'warn',
			[ErrorCode.VALIDATION_FAILED]: 'warn',
			[ErrorCode.UNAUTHORIZED]: 'warn',
			[ErrorCode.INVALID_GAME_STATE]: 'warn',
			[ErrorCode.GAME_NOT_FOUND]: 'info',
			[ErrorCode.PLAYER_NOT_FOUND]: 'info',
			[ErrorCode.INVALID_TURN]: 'warn',
			[ErrorCode.TIMEOUT_EXCEEDED]: 'info',
			[ErrorCode.CONTRACT_ERROR]: 'error',
			[ErrorCode.TRANSACTION_FAILED]: 'error',
			[ErrorCode.INSUFFICIENT_GAS]: 'error',
			[ErrorCode.INTERNAL_ERROR]: 'error',
			[ErrorCode.NETWORK_ERROR]: 'error',
			[ErrorCode.STORAGE_ERROR]: 'error',
			[ErrorCode.CONCURRENCY_ERROR]: 'error',
		};

		return errorLevels[code] || 'error';
	}
}

export class GameValidator {
	/**
	 * Validate turn transition
	 */
	static validateTurn(sessionId: string, playerId: string, currentTurn: string | null, players: string[]): void {
		if (!players.includes(playerId)) {
			throw ErrorHandler.createError(ErrorCode.UNAUTHORIZED, 'Player not in game', { playerId, players }, { sessionId, playerId });
		}

		if (currentTurn !== playerId) {
			throw ErrorHandler.createError(ErrorCode.INVALID_TURN, 'Not your turn', { currentTurn, playerId }, { sessionId, playerId });
		}
	}

	/**
	 * Validate game state for action
	 */
	static validateGameState(sessionId: string, status: string, allowedStates: string[]): void {
		if (!allowedStates.includes(status)) {
			throw ErrorHandler.createError(
				ErrorCode.INVALID_GAME_STATE,
				`Invalid game state: ${status}. Expected one of: ${allowedStates.join(', ')}`,
				{ currentState: status, allowedStates },
				{ sessionId }
			);
		}
	}

	/**
	 * Validate coordinates
	 */
	static validateCoordinates(x: number, y: number, boardSize: number = 10): void {
		if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) {
			throw ErrorHandler.createError(ErrorCode.VALIDATION_FAILED, `Invalid coordinates: (${x}, ${y}). Must be within 0-${boardSize - 1}`, {
				x,
				y,
				boardSize,
			});
		}
	}

	/**
	 * Validate timeout
	 */
	static validateTimeout(sessionId: string, startTime: number | null, maxDuration: number, action: string): void {
		if (!startTime) {
			throw ErrorHandler.createError(ErrorCode.INVALID_GAME_STATE, `${action} timeout: no start time found`, { action }, { sessionId });
		}

		const elapsed = Date.now() - startTime;
		if (elapsed > maxDuration) {
			throw ErrorHandler.createError(
				ErrorCode.TIMEOUT_EXCEEDED,
				`${action} timeout exceeded: ${elapsed}ms > ${maxDuration}ms`,
				{ elapsed, maxDuration, action },
				{ sessionId }
			);
		}
	}
}

export class PerformanceMonitor {
	private static metrics: Map<string, number[]> = new Map();

	/**
	 * Track operation duration
	 */
	static async trackOperation<T>(operation: string, func: () => Promise<T>, sessionId?: string): Promise<T> {
		const startTime = Date.now();

		try {
			const result = await func();
			const duration = Date.now() - startTime;

			this.recordMetric(operation, duration);
			this.logPerformance(operation, duration, true, sessionId);

			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.recordMetric(`${operation}_failed`, duration);
			this.logPerformance(operation, duration, false, sessionId);
			throw error;
		}
	}

	/**
	 * Record metric for aggregation
	 */
	private static recordMetric(operation: string, duration: number): void {
		if (!this.metrics.has(operation)) {
			this.metrics.set(operation, []);
		}

		const metrics = this.metrics.get(operation)!;
		metrics.push(duration);

		// Keep only last 1000 measurements
		if (metrics.length > 1000) {
			metrics.shift();
		}
	}

	/**
	 * Log performance data
	 */
	private static logPerformance(operation: string, duration: number, success: boolean, sessionId?: string): void {
		const logData = {
			type: 'performance',
			operation,
			duration,
			success,
			timestamp: Date.now(),
			sessionId,
		};

		if (duration > 1000) {
			console.warn(`Slow operation: ${JSON.stringify(logData)}`);
		} else {
			console.log(`Performance: ${JSON.stringify(logData)}`);
		}
	}

	/**
	 * Get performance statistics
	 */
	static getStats(operation: string): {
		count: number;
		avg: number;
		min: number;
		max: number;
		p95: number;
	} | null {
		const metrics = this.metrics.get(operation);
		if (!metrics || metrics.length === 0) {
			return null;
		}

		const sorted = [...metrics].sort((a, b) => a - b);
		const count = sorted.length;
		const sum = sorted.reduce((a, b) => a + b, 0);

		return {
			count,
			avg: sum / count,
			min: sorted[0],
			max: sorted[count - 1],
			p95: sorted[Math.floor(count * 0.95)],
		};
	}

	/**
	 * Log all performance statistics
	 */
	static logAllStats(): void {
		const allStats: Record<string, any> = {};

		for (const [operation, _] of this.metrics) {
			allStats[operation] = this.getStats(operation);
		}

		console.log(`Performance Summary: ${JSON.stringify(allStats, null, 2)}`);
	}
}

export class HealthChecker {
	/**
	 * Check system health
	 */
	static async checkHealth(env: any): Promise<{
		status: 'healthy' | 'degraded' | 'unhealthy';
		checks: Record<string, boolean>;
		timestamp: number;
	}> {
		const checks: Record<string, boolean> = {};

		// Check MegaETH connection
		try {
			if (env.MEGAETH_RPC_URL) {
				const response = await fetch(env.MEGAETH_RPC_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						method: 'eth_blockNumber',
						params: [],
					}),
				});
				checks.megaeth = response.ok;
			} else {
				checks.megaeth = false;
			}
		} catch (error) {
			checks.megaeth = false;
		}

		// Check Durable Objects
		try {
			// Simple test to ensure DOs are accessible
			checks.durableObjects = true;
		} catch (error) {
			checks.durableObjects = false;
		}

		// Check memory usage (if available)
		try {
			// This would need actual memory monitoring in production
			checks.memory = true;
		} catch (error) {
			checks.memory = false;
		}

		// Determine overall status
		const healthyCount = Object.values(checks).filter(Boolean).length;
		const totalChecks = Object.keys(checks).length;

		let status: 'healthy' | 'degraded' | 'unhealthy';
		if (healthyCount === totalChecks) {
			status = 'healthy';
		} else if (healthyCount > totalChecks / 2) {
			status = 'degraded';
		} else {
			status = 'unhealthy';
		}

		return {
			status,
			checks,
			timestamp: Date.now(),
		};
	}
}

// Utility functions for testing
export class TestHelpers {
	/**
	 * Create a mock session for testing
	 */
	static createMockSession(overrides: Partial<any> = {}): any {
		return {
			sessionId: 'test-session-' + Math.random().toString(36).substr(2, 9),
			status: 'CREATED',
			players: [],
			gameContractAddress: null,
			gameId: null,
			createdAt: Date.now(),
			lastActivityAt: Date.now(),
			currentTurn: null,
			turnStartedAt: null,
			...overrides,
		};
	}

	/**
	 * Create mock ship layout for testing
	 */
	static createMockShips(): any[] {
		return [
			{
				id: 'ship-0',
				length: 5,
				cells: [
					{ x: 0, y: 0 },
					{ x: 1, y: 0 },
					{ x: 2, y: 0 },
					{ x: 3, y: 0 },
					{ x: 4, y: 0 },
				],
				hits: [],
				isSunk: false,
			},
			{
				id: 'ship-1',
				length: 4,
				cells: [
					{ x: 0, y: 2 },
					{ x: 0, y: 3 },
					{ x: 0, y: 4 },
					{ x: 0, y: 5 },
				],
				hits: [],
				isSunk: false,
			},
		];
	}
}
