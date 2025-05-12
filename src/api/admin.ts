/**
 * Admin and Monitoring API Endpoints
 *
 * Provides administrative functions and monitoring capabilities
 * for production deployment
 */
import { Env } from '../index';
import { PerformanceMonitor, HealthChecker } from '../utils/errorMonitoring';

/**
 * Main handler for admin-related API requests
 */
export async function handleAdminRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;

	// Verify admin access (in production, implement proper authentication)
	if (!isAdminRequest(request)) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Health check endpoint
	if (path.endsWith('/admin/health')) {
		return handleHealthCheck(env);
	}

	// Performance metrics
	if (path.endsWith('/admin/metrics')) {
		return handleMetrics();
	}

	// Active sessions
	if (path.endsWith('/admin/sessions')) {
		return handleListSessions(env);
	}

	// Session details
	const sessionMatch = path.match(/\/admin\/sessions\/([a-zA-Z0-9-]+)$/);
	if (sessionMatch) {
		return handleSessionDetails(sessionMatch[1], env);
	}

	// Player statistics
	if (path.endsWith('/admin/players')) {
		return handlePlayerStats(env);
	}

	// Game statistics
	if (path.endsWith('/admin/games')) {
		return handleGameStats(env);
	}

	// System configuration
	if (path.endsWith('/admin/config')) {
		return handleSystemConfig(env);
	}

	// Force cleanup operations
	if (path.endsWith('/admin/cleanup')) {
		return handleForceCleanup(request, env);
	}

	return new Response(JSON.stringify({ error: 'Endpoint not found' }), {
		status: 404,
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * Check if request has admin privileges
 */
function isAdminRequest(request: Request): boolean {
	// In production, implement proper authentication
	// For now, check for a simple admin token
	const authHeader = request.headers.get('Authorization');
	const adminToken = authHeader?.replace('Bearer ', '');

	// This would be a secure token in production
	return adminToken === 'admin-secret-token';
}

/**
 * Handle health check request
 */
async function handleHealthCheck(env: Env): Promise<Response> {
	const health = await HealthChecker.checkHealth(env);

	return new Response(JSON.stringify(health), {
		status: health.status === 'healthy' ? 200 : 503,
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * Handle performance metrics request
 */
function handleMetrics(): Response {
	// Log all stats before returning
	PerformanceMonitor.logAllStats();

	const metrics = {
		operations: {} as Record<string, any>,
		summary: {
			timestamp: Date.now(),
			// Use Date.now() as a simple uptime indicator instead of process.hrtime
			startTimestamp: globalThis.startTime || Date.now(),
		},
	};

	// Get stats for common operations
	const commonOperations = [
		'handleJoinRequest',
		'handleSubmitBoardRequest',
		'processGameEvent',
		'handleWebSocketConnection',
		'saveSessionData',
		'pollGameEvents',
	];

	for (const operation of commonOperations) {
		const stats = PerformanceMonitor.getStats(operation);
		if (stats) {
			metrics.operations[operation] = stats;
		}
	}

	return new Response(JSON.stringify(metrics), {
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * Handle list sessions request
 */
async function handleListSessions(env: Env): Promise<Response> {
	try {
		// In a real implementation, you would query a database or index
		// For now, this is a placeholder
		const sessions = {
			total: 0,
			active: 0,
			created: 0,
			waiting: 0,
			completed: 0,
			message: 'Session listing requires additional indexing implementation',
		};

		return new Response(JSON.stringify(sessions), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: 'Failed to list sessions' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Handle session details request
 */
async function handleSessionDetails(sessionId: string, env: Env): Promise<Response> {
	try {
		// Get the Game Session Durable Object
		const sessionDO = env.GAME_SESSIONS.get(env.GAME_SESSIONS.idFromName(sessionId));

		// Get current status
		const response = await sessionDO.fetch(
			new Request('https://dummy-url/status', {
				method: 'GET',
			})
		);

		if (response.status === 200) {
			const sessionData = await response.json() as Record<string, any>;

			// Add admin-specific information
			const adminSessionData = {
				...sessionData,
				adminInfo: {
					durableObjectId: sessionId,
					lastChecked: Date.now(),
				},
			};

			return new Response(JSON.stringify(adminSessionData), {
				headers: { 'Content-Type': 'application/json' },
			});
		} else {
			return new Response(JSON.stringify({ error: 'Session not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	} catch (error) {
		return new Response(JSON.stringify({ error: 'Failed to get session details' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Handle player statistics request
 */
async function handlePlayerStats(env: Env): Promise<Response> {
	try {
		// This would require implementing proper indexing in production
		const stats = {
			totalPlayers: 0,
			activeToday: 0,
			averageGamesPerPlayer: 0,
			topPlayers: [],
			message: 'Player statistics require additional indexing implementation',
		};

		return new Response(JSON.stringify(stats), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: 'Failed to get player stats' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Handle game statistics request
 */
async function handleGameStats(env: Env): Promise<Response> {
	try {
		const now = Date.now();
		const oneDayAgo = now - 24 * 60 * 60 * 1000;
		const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

		// This would require proper data aggregation in production
		const stats = {
			gamesLast24Hours: 0,
			gamesLastWeek: 0,
			averageGameDuration: 0,
			averageTurnDuration: 0,
			gameOutcomes: {
				completed: 0,
				forfeited: 0,
				timeout: 0,
				timeLimit: 0,
			},
			message: 'Game statistics require additional data aggregation implementation',
		};

		return new Response(JSON.stringify(stats), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: 'Failed to get game stats' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Handle system configuration request
 */
function handleSystemConfig(env: Env): Response {
	const config = {
		environment: 'production', // Would be determined by env vars
		megaeth: {
			rpcUrl: env.MEGAETH_RPC_URL ? '***configured***' : 'not configured',
			gameFactory: env.GAME_FACTORY_ADDRESS ? '***configured***' : 'not configured',
		},
		gameSettings: {
			turnTimeoutMs: 60 * 1000,
			gameTimeoutMs: 10 * 60 * 1000,
			boardSize: 10,
			shipLengths: [5, 4, 3, 3, 2],
		},
		features: {
			durableObjects: true,
			realTimeEvents: true,
			zeroKnowledgeProofs: true,
		},
	};

	return new Response(JSON.stringify(config), {
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * Handle forced cleanup request
 */
async function handleForceCleanup(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'POST') {
		return new Response(JSON.stringify({ error: 'Method not allowed' }), {
			status: 405,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const data = await request.json() as { type: 'expired_invites' | 'old_sessions' };
		const cleanupType = data.type;

		switch (cleanupType) {
			case 'expired_invites':
				// Trigger invite cleanup
				const inviteManager = env.INVITE_MANAGER.get(env.INVITE_MANAGER.idFromName('global'));
				await inviteManager.fetch(new Request('https://dummy-url/alarm', { method: 'POST' }));

				return new Response(
					JSON.stringify({
						success: true,
						message: 'Expired invites cleanup triggered',
					}),
					{
						headers: { 'Content-Type': 'application/json' },
					}
				);

			case 'old_sessions':
				// This would require implementing session cleanup logic
				return new Response(
					JSON.stringify({
						success: false,
						message: 'Session cleanup not yet implemented',
					}),
					{
						headers: { 'Content-Type': 'application/json' },
					}
				);

			default:
				return new Response(
					JSON.stringify({
						error: 'Unknown cleanup type',
						validTypes: ['expired_invites', 'old_sessions'],
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				);
		}
	} catch (error) {
		return new Response(JSON.stringify({ error: 'Failed to process cleanup request' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

/**
 * Create a monitoring dashboard HTML page
 */
export function createMonitoringDashboard(): string {
	return `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>ZK Battleship Admin Dashboard</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; }
		.section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
		.status-healthy { color: green; }
		.status-degraded { color: orange; }
		.status-unhealthy { color: red; }
		button { padding: 10px 15px; margin: 5px; cursor: pointer; }
		pre { background: #f5f5f5; padding: 10px; border-radius: 3px; overflow-x: auto; }
		.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
		.metric-card { padding: 15px; background: #f9f9f9; border-radius: 5px; }
	</style>
</head>
<body>
	<h1>ZK Battleship Admin Dashboard</h1>
	
	<div class="section">
		<h2>System Health</h2>
		<div id="health-status">Loading...</div>
		<button onclick="refreshHealth()">Refresh Health</button>
	</div>
	
	<div class="section">
		<h2>Performance Metrics</h2>
		<div id="metrics" class="metrics">Loading...</div>
		<button onclick="refreshMetrics()">Refresh Metrics</button>
	</div>
	
	<div class="section">
		<h2>Quick Actions</h2>
		<button onclick="cleanupExpiredInvites()">Cleanup Expired Invites</button>
		<button onclick="refreshAllData()">Refresh All Data</button>
	</div>
	
	<div class="section">
		<h2>System Configuration</h2>
		<div id="config">Loading...</div>
		<button onclick="refreshConfig()">Refresh Config</button>
	</div>
	
	<script>
		const API_BASE = '';
		const ADMIN_TOKEN = 'admin-secret-token'; // In production, this would be more secure
		
		async function apiCall(endpoint, options = {}) {
			const response = await fetch(API_BASE + endpoint, {
				...options,
				headers: {
					'Authorization': \`Bearer \${ADMIN_TOKEN}\`,
					'Content-Type': 'application/json',
					...options.headers
				}
			});
			return response.json();
		}
		
		async function refreshHealth() {
			const health = await apiCall('/admin/health');
			const statusClass = \`status-\${health.status}\`;
			document.getElementById('health-status').innerHTML = \`
				<div class="\${statusClass}">
					<h3>Status: \${health.status.toUpperCase()}</h3>
					<ul>
						\${Object.entries(health.checks).map(([key, value]) => 
							\`<li>\${key}: \${value ? '✅' : '❌'}</li>\`
						).join('')}
					</ul>
				</div>
			\`;
		}
		
		async function refreshMetrics() {
			const metrics = await apiCall('/admin/metrics');
			document.getElementById('metrics').innerHTML = \`
				\${Object.entries(metrics.operations).map(([op, stats]) => \`
					<div class="metric-card">
						<h4>\${op}</h4>
						<p>Count: \${stats.count}</p>
						<p>Avg: \${stats.avg.toFixed(2)}ms</p>
						<p>P95: \${stats.p95}ms</p>
						<p>Min/Max: \${stats.min}/\${stats.max}ms</p>
					</div>
				\`).join('')}
			\`;
		}
		
		async function refreshConfig() {
			const config = await apiCall('/admin/config');
			document.getElementById('config').innerHTML = \`
				<pre>\${JSON.stringify(config, null, 2)}</pre>
			\`;
		}
		
		async function cleanupExpiredInvites() {
			const result = await apiCall('/admin/cleanup', {
				method: 'POST',
				body: JSON.stringify({ type: 'expired_invites' })
			});
			alert(result.message);
		}
		
		async function refreshAllData() {
			await Promise.all([
				refreshHealth(),
				refreshMetrics(),
				refreshConfig()
			]);
		}
		
		// Initial load
		refreshAllData();
		
		// Auto-refresh every 30 seconds
		setInterval(refreshAllData, 30000);
	</script>
</body>
</html>
	`;
}
