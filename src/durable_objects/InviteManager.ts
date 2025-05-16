/**
 * InviteManager Durable Object
 *
 * Handles game invitations including:
 * - Creating invite links with unique codes
 * - Tracking invitation status
 * - Managing invitation expiration
 * - Creating game sessions when invites are created
 */
/**
 * Updated InviteManager Durable Object with Betting Support
 *
 * Now handles both regular and betting invitations:
 * - Regular invites: No stake, traditional gameplay for SHIP rewards
 * - Betting invites: USDC stakes, winner-takes-all minus platform fee
 */
import { Invitation, InvitationCreateRequest, InvitationUpdate, BettingInvite, BettingInviteCreateRequest } from '../types';
import { generateInviteCode } from '../utils/crypto';
import { ContractGameService } from '../services/contractService';

export class InviteManager {
	private state: DurableObjectState;
	private env: any;
	private invites: Map<string, Invitation> = new Map();
	private bettingInvites: Map<string, BettingInvite> = new Map();
	private codeToInviteMap: Map<string, string> = new Map();
	private cleanupAlarmId: string | null = null;
	private contractService: ContractGameService | null = null;

	constructor(state: DurableObjectState, env: any) {
		this.state = state;
		this.env = env;

		// Initialize contract service if enabled
		if (env.ENABLE_BETTING === 'true' && env.BATTLESHIP_BETTING_ADDRESS) {
			try {
				this.contractService = new ContractGameService(env);
			} catch (error) {
				console.error('Failed to initialize contract service:', error);
			}
		}

		// Load invites on startup
		this.state.blockConcurrencyWhile(async () => {
			// Load regular invites
			let storedInvites = (await this.state.storage.get('invites')) as Invitation[];
			if (!Array.isArray(storedInvites)) {
				storedInvites = [];
			}
			for (const invite of storedInvites) {
				this.invites.set(invite.id, invite);
				if (invite.code) {
					this.codeToInviteMap.set(invite.code, invite.id);
				}
			}

			// Load betting invites
			let storedBettingInvites = (await this.state.storage.get('bettingInvites')) as BettingInvite[];
			if (!Array.isArray(storedBettingInvites)) {
				storedBettingInvites = [];
			}
			for (const invite of storedBettingInvites) {
				this.bettingInvites.set(invite.id, invite);
				if (invite.code) {
					this.codeToInviteMap.set(invite.code, invite.id);
				}
			}

			// Schedule cleanup for expired invites
			this.scheduleCleanup();
		});
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Handle regular invite endpoints
		if (path.endsWith('/create')) {
			return this.handleCreateInvite(request);
		}

		if (path.endsWith('/accept')) {
			return this.handleAcceptInvite(request);
		}

		if (path.endsWith('/cancel')) {
			return this.handleCancelInvite(request);
		}

		// Handle betting invite endpoints
		if (path.endsWith('/create-betting')) {
			return this.handleCreateBettingInvite(request);
		}

		if (path.endsWith('/accept-betting')) {
			return this.handleAcceptBettingInvite(request);
		}

		if (path.endsWith('/cancel-betting')) {
			return this.handleCancelBettingInvite(request);
		}

		if (path.endsWith('/resolve-betting')) {
			return this.handleResolveBetting(request);
		}

		// Status and lookup endpoints (work for both types)
		if (path.includes('/status/')) {
			const inviteId = path.split('/').pop();
			return this.handleGetInviteStatus(inviteId || '');
		}

		if (path.includes('/by-code/')) {
			const code = path.split('/').pop();
			return this.handleGetInviteByCode(code || '');
		}

		// Alarm handler for cleanup
		if (path.endsWith('/alarm')) {
			await this.handleCleanupAlarm();
			return new Response('OK');
		}

		// Default not found response
		return new Response('Not Found', { status: 404 });
	}

	// ==================== Regular Invite Handlers ====================

	// Handle POST /create - Create a regular (non-betting) invitation
	private async handleCreateInvite(request: Request): Promise<Response> {
		try {
			const bodyText = await request.text();
			let data;
			try {
				data = JSON.parse(bodyText);
			} catch (error) {
				return new Response(
					JSON.stringify({
						error: 'Invalid JSON in request body',
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}

			if (!data.creator) {
				return new Response(JSON.stringify({ error: 'Creator address is required' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// Generate a unique invite code and ID
			const code = await generateInviteCode();
			const id = crypto.randomUUID();

			// Default expiration is 24 hours
			const expirationHours = data.expirationHours || 24;
			const expiresAt = Date.now() + expirationHours * 60 * 60 * 1000;

			// Create a new session when an invitation is created
			const sessionId = crypto.randomUUID();

			// Create a new game session Durable Object
			const sessionDO = this.env.GAME_SESSIONS.get(this.env.GAME_SESSIONS.idFromName(sessionId));

			// Initialize the session with the creator
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

			console.log(`Created new session ${sessionId} for regular invitation ${id}`);

			// Create the regular invitation
			const invitation: Invitation = {
				id,
				code,
				creator: data.creator,
				createdAt: Date.now(),
				expiresAt,
				sessionId: sessionId,
				status: 'pending',
				acceptedBy: null,
				acceptedAt: null,
			};

			// Store the invitation
			this.invites.set(id, invitation);
			this.codeToInviteMap.set(code, id);
			await this.saveInvites();

			return new Response(
				JSON.stringify({
					id,
					code,
					creator: data.creator,
					expiresAt,
					sessionId: sessionId,
					isBettingGame: false,
					inviteLink: `${new URL(request.url).origin}/invite/${code}`,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} catch (error) {
			console.error('Error creating regular invite:', error);
			return new Response(
				JSON.stringify({
					error: 'Failed to create invitation: ' + (error instanceof Error ? error.message : String(error)),
				}),
				{
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}
	}

	// Handle POST /accept - Accept a regular invitation
	private async handleAcceptInvite(request: Request): Promise<Response> {
		try {
			const bodyText = await request.text();
			let data;
			try {
				data = JSON.parse(bodyText);
			} catch (error) {
				return new Response(
					JSON.stringify({
						error: 'Invalid JSON in request body',
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}

			if (!data.code || !data.player) {
				return new Response(JSON.stringify({ error: 'Invite code and player address are required' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// Look up the invitation by code
			const inviteId = this.codeToInviteMap.get(data.code);

			if (!inviteId || !this.invites.has(inviteId)) {
				return new Response(JSON.stringify({ error: 'Invalid invite code' }), {
					status: 404,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			const invite = this.invites.get(inviteId)!;

			// Validate invitation
			if (invite.status !== 'pending') {
				return new Response(
					JSON.stringify({
						error: `Invitation cannot be accepted (status: ${invite.status})`,
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}

			if (Date.now() > invite.expiresAt) {
				invite.status = 'expired';
				await this.saveInvites();
				return new Response(JSON.stringify({ error: 'Invitation has expired' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (data.player === invite.creator) {
				return new Response(JSON.stringify({ error: 'Cannot accept your own invitation' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// Join the existing session
			const sessionDO = this.env.GAME_SESSIONS.get(this.env.GAME_SESSIONS.idFromName(invite.sessionId!));
			const joinResponse = await sessionDO.fetch(
				new Request('https://dummy-url/join', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						address: data.player,
					}),
				})
			);

			if (joinResponse.status !== 200) {
				const errorText = await joinResponse.text();
				console.error(`Error joining session: ${errorText}`);
				return new Response(
					JSON.stringify({
						error: `Failed to join session: ${errorText}`,
					}),
					{
						status: 500,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}

			const joinData = await joinResponse.json();

			// Update the invitation
			invite.status = 'accepted';
			invite.acceptedBy = data.player;
			invite.acceptedAt = Date.now();
			await this.saveInvites();

			return new Response(
				JSON.stringify({
					success: true,
					inviteId: inviteId,
					sessionId: invite.sessionId,
					creator: invite.creator,
					acceptedBy: data.player,
					status: joinData.status || 'WAITING',
					isBettingGame: false,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} catch (error) {
			console.error('Error accepting regular invite:', error);
			return new Response(
				JSON.stringify({
					error: 'Failed to accept invitation: ' + (error instanceof Error ? error.message : String(error)),
				}),
				{
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}
	}

	// ==================== Betting Invite Handlers ====================

	// Handle POST /create-betting - Create a betting invitation
	private async handleCreateBettingInvite(request: Request): Promise<Response> {
		if (!this.contractService) {
			return new Response(
				JSON.stringify({
					error: 'Betting is not enabled on this server',
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		try {
			const bodyText = await request.text();
			let data: BettingInviteCreateRequest;
			try {
				data = JSON.parse(bodyText);
			} catch (error) {
				return new Response(
					JSON.stringify({
						error: 'Invalid JSON in request body',
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}

			if (!data.creator || !data.stakeAmount) {
				return new Response(JSON.stringify({ error: 'Creator address and stake amount are required' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// Validate stake amount
			const stakeAmountNum = parseFloat(data.stakeAmount);
			if (isNaN(stakeAmountNum) || stakeAmountNum <= 0) {
				return new Response(JSON.stringify({ error: 'Invalid stake amount' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// Create betting invite on-chain
			const { inviteId, transactionHash } = await this.contractService.createBettingInvite(data.creator as `0x${string}`, stakeAmountNum);

			// Generate a unique code and ID for off-chain tracking
			const code = await generateInviteCode();
			const id = crypto.randomUUID();

			// Default expiration is 24 hours
			const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

			// Create the betting invitation object
			const bettingInvitation: BettingInvite = {
				id,
				code,
				creator: data.creator,
				stakeAmount: data.stakeAmount,
				acceptor: null,
				createdAt: Date.now(),
				expiresAt,
				betStatus: 'Open',
				gameId: null,
				sessionId: null,
				onChainInviteId: inviteId.toString(),
				transactionHash,
				fundsDistributed: false,
			};

			// Store the betting invitation
			this.bettingInvites.set(id, bettingInvitation);
			this.codeToInviteMap.set(code, id);
			await this.saveBettingInvites();

			console.log(`Created betting invite: ID=${id}, OnChainID=${inviteId}, Creator=${data.creator}, Stake=${data.stakeAmount} USDC`);

			return new Response(
				JSON.stringify({
					id,
					code,
					creator: data.creator,
					stakeAmount: data.stakeAmount,
					expiresAt,
					isBettingGame: true,
					onChainInviteId: inviteId,
					transactionHash: transactionHash,
					inviteLink: `${new URL(request.url).origin}/invite/${code}`,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} catch (error) {
			console.error('Error creating betting invite:', error);
			return new Response(
				JSON.stringify({
					error: 'Failed to create betting invitation: ' + (error instanceof Error ? error.message : String(error)),
				}),
				{
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}
	}

	// Handle POST /accept-betting - Accept a betting invitation
	private async handleAcceptBettingInvite(request: Request): Promise<Response> {
		if (!this.contractService) {
			return new Response(
				JSON.stringify({
					error: 'Betting is not enabled on this server',
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		try {
			const bodyText = await request.text();
			let data;
			try {
				data = JSON.parse(bodyText);
			} catch (error) {
				return new Response(
					JSON.stringify({
						error: 'Invalid JSON in request body',
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}

			if (!data.code || !data.player) {
				return new Response(JSON.stringify({ error: 'Invite code and player address are required' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// Look up the betting invitation by code
			const inviteId = this.codeToInviteMap.get(data.code);

			if (!inviteId || !this.bettingInvites.has(inviteId)) {
				return new Response(JSON.stringify({ error: 'Invalid invite code' }), {
					status: 404,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			const invite = this.bettingInvites.get(inviteId)!;

			// Validate betting invitation
			if (invite.betStatus !== 'Open') {
				return new Response(
					JSON.stringify({
						error: `Betting invitation cannot be accepted (status: ${invite.betStatus})`,
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}

			if (Date.now() > invite.expiresAt) {
				invite.betStatus = 'Expired';
				await this.saveBettingInvites();
				return new Response(JSON.stringify({ error: 'Betting invitation has expired' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (data.player === invite.creator) {
				return new Response(JSON.stringify({ error: 'Cannot accept your own betting invitation' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// Accept the betting invite on-chain
			await this.contractService!.acceptBettingInvite(parseInt(invite.onChainInviteId!), data.player as `0x${string}`);

			// Create a game from the matched betting invite
			const { gameId, transactionHash: gameTransactionHash } = await this.contractService!.createGameFromBettingInvite(
				parseInt(invite.onChainInviteId!)
			);

			// Create a session for the betting game
			const sessionId = crypto.randomUUID();
			const sessionDO = this.env.GAME_SESSIONS.get(this.env.GAME_SESSIONS.idFromName(sessionId));

			// Initialize the session with betting info
			await sessionDO.fetch(
				new Request('https://dummy-url/initialize', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						sessionId,
						creator: invite.creator,
						bettingInviteId: invite.id,
						onChainGameId: gameId,
						bettingInfo: {
							inviteId: invite.onChainInviteId,
							totalPool: (parseFloat(invite.stakeAmount) * 2).toString(),
							resolved: false,
						},
					}),
				})
			);

			// Join the acceptor to the session
			await sessionDO.fetch(
				new Request('https://dummy-url/join', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						address: data.player,
					}),
				})
			);

			// Update the betting invitation
			invite.betStatus = 'Matched';
			invite.acceptor = data.player;
			invite.gameId = gameId.toString();
			invite.sessionId = sessionId;
			await this.saveBettingInvites();

			console.log(`Betting invite accepted: ID=${invite.id}, OnChainGameID=${gameId}, Acceptor=${data.player}`);

			return new Response(
				JSON.stringify({
					success: true,
					inviteId: inviteId,
					sessionId: sessionId,
					creator: invite.creator,
					acceptedBy: data.player,
					gameId: gameId,
					stakeAmount: invite.stakeAmount,
					totalPool: (parseFloat(invite.stakeAmount) * 2).toString(),
					isBettingGame: true,
					status: 'WAITING',
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} catch (error) {
			console.error('Error accepting betting invite:', error);
			return new Response(
				JSON.stringify({
					error: 'Failed to accept betting invitation: ' + (error instanceof Error ? error.message : String(error)),
				}),
				{
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}
	}

	// Handle POST /cancel-betting - Cancel a betting invitation
	private async handleCancelBettingInvite(request: Request): Promise<Response> {
		if (!this.contractService) {
			return new Response(
				JSON.stringify({
					error: 'Betting is not enabled on this server',
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		try {
			const data = (await request.json()) as { id: string; creator: string };

			if (!data.id || !data.creator) {
				return new Response(JSON.stringify({ error: 'Invite ID and creator address are required' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// Check if the betting invitation exists
			if (!this.bettingInvites.has(data.id)) {
				return new Response(JSON.stringify({ error: 'Betting invitation not found' }), {
					status: 404,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			const invite = this.bettingInvites.get(data.id)!;

			// Verify the creator
			if (invite.creator !== data.creator) {
				return new Response(JSON.stringify({ error: 'Only the creator can cancel this betting invitation' }), {
					status: 403,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// Check if the betting invitation can be canceled
			if (invite.betStatus !== 'Open') {
				return new Response(
					JSON.stringify({
						error: `Betting invitation cannot be canceled (status: ${invite.betStatus})`,
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}

			// Cancel the betting invite on-chain
			await this.contractService.cancelBettingInvite(parseInt(invite.onChainInviteId!), data.creator as `0x${string}`);

			// Cancel the invitation
			invite.betStatus = 'Cancelled';
			await this.saveBettingInvites();

			return new Response(
				JSON.stringify({
					success: true,
					id: data.id,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} catch (error) {
			console.error('Error cancelling betting invite:', error);
			return new Response(JSON.stringify({ error: 'Invalid request data' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	}

	// ==================== Common Handlers ====================

	// Handle GET /status/:id - Get invitation status by ID (works for both types)
	private handleGetInviteStatus(inviteId: string): Response {
		// Check regular invites first
		if (this.invites.has(inviteId)) {
			const invite = this.invites.get(inviteId)!;

			// Check if the invitation has expired
			if (invite.status === 'pending' && Date.now() > invite.expiresAt) {
				invite.status = 'expired';
				this.saveInvites(); // Don't await, let it update in the background
			}

			return new Response(
				JSON.stringify({
					id: invite.id,
					creator: invite.creator,
					status: invite.status,
					createdAt: invite.createdAt,
					expiresAt: invite.expiresAt,
					sessionId: invite.sessionId,
					acceptedBy: invite.acceptedBy,
					acceptedAt: invite.acceptedAt,
					isBettingGame: false,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// Check betting invites
		if (this.bettingInvites.has(inviteId)) {
			const invite = this.bettingInvites.get(inviteId)!;

			// Check if the betting invitation has expired
			if (invite.betStatus === 'Open' && Date.now() > invite.expiresAt) {
				invite.betStatus = 'Expired';
				this.saveBettingInvites(); // Don't await, let it update in the background
			}

			return new Response(
				JSON.stringify({
					id: invite.id,
					creator: invite.creator,
					status: invite.betStatus,
					createdAt: invite.createdAt,
					expiresAt: invite.expiresAt,
					sessionId: invite.sessionId,
					acceptedBy: invite.acceptor,
					gameId: invite.gameId,
					stakeAmount: invite.stakeAmount,
					isBettingGame: true,
					onChainInviteId: invite.onChainInviteId,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		return new Response(JSON.stringify({ error: 'Invitation not found' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Handle GET /by-code/:code - Get invitation by code (works for both types)
	private handleGetInviteByCode(code: string): Response {
		const inviteId = this.codeToInviteMap.get(code);

		if (!inviteId) {
			return new Response(JSON.stringify({ error: 'Invitation not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Use the status handler to get the full invite data
		return this.handleGetInviteStatus(inviteId);
	}

	// Handle POST /cancel - Cancel a regular invitation
	private async handleCancelInvite(request: Request): Promise<Response> {
		try {
			const data = (await request.json()) as InvitationUpdate;

			if (!data.id || !data.creator) {
				return new Response(JSON.stringify({ error: 'Invite ID and creator address are required' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// Check if the invitation exists
			if (!this.invites.has(data.id)) {
				return new Response(JSON.stringify({ error: 'Invitation not found' }), {
					status: 404,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			const invite = this.invites.get(data.id)!;

			// Verify the creator
			if (invite.creator !== data.creator) {
				return new Response(JSON.stringify({ error: 'Only the creator can cancel this invitation' }), {
					status: 403,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// Check if the invitation can be canceled
			if (invite.status !== 'pending') {
				return new Response(
					JSON.stringify({
						error: `Invitation cannot be canceled (status: ${invite.status})`,
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}

			// Cancel the invitation
			invite.status = 'canceled';
			await this.saveInvites();

			return new Response(
				JSON.stringify({
					success: true,
					id: data.id,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} catch (error) {
			return new Response(JSON.stringify({ error: 'Invalid request data' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	}

	// ==================== Game Resolution (for betting) ====================

	/**
	 * Resolve a betting game - called by the backend after game completion
	 */
	async resolveBettingGame(gameId: string, winner: string | null): Promise<boolean> {
		if (!this.contractService) {
			console.error('Betting service not available');
			return false;
		}

		try {
			// Find the betting invite associated with this game
			let bettingInvite: BettingInvite | null = null;
			for (const invite of this.bettingInvites.values()) {
				if (invite.gameId === gameId) {
					bettingInvite = invite;
					break;
				}
			}

			if (!bettingInvite || !bettingInvite.onChainInviteId) {
				console.error(`No betting invite found for game ${gameId}`);
				return false;
			}

			// Resolve the betting game on-chain
			const { transactionHash, winnerPayout, platformFee } = await this.contractService.resolveBettingGame(
				parseInt(gameId),
				winner as `0x${string}` | null
			);

			// Update the betting invite status
			bettingInvite.betStatus = 'Resolved';
			bettingInvite.fundsDistributed = true;
			await this.saveBettingInvites();

			console.log(
				`Betting game resolved: GameID=${gameId}, Winner=${winner || 'Draw'}, ` +
					`Payout=${winnerPayout} USDC, Fee=${platformFee} USDC, TxHash=${transactionHash}`
			);

			return true;
		} catch (error) {
			console.error('Error resolving betting game:', error);
			return false;
		}
	}

	// Handle POST /resolve-betting - Resolve betting after game completion
	private async handleResolveBetting(request: Request): Promise<Response> {
		try {
			const data = await request.json() as { gameId: string; winner: string | null };
			
			if (!data.gameId) {
				return new Response(
					JSON.stringify({ success: false, error: 'Game ID is required' }),
					{ 
						status: 400,
						headers: { 'Content-Type': 'application/json' } 
					}
				);
			}
			
			const success = await this.resolveBettingGame(data.gameId, data.winner);
			
			return new Response(
				JSON.stringify({ success }),
				{ headers: { 'Content-Type': 'application/json' } }
			);
		} catch (error) {
			console.error('Error in handleResolveBetting:', error);
			return new Response(
				JSON.stringify({ 
					success: false, 
					error: error instanceof Error ? error.message : String(error) 
				}),
				{ 
					status: 500,
					headers: { 'Content-Type': 'application/json' } 
				}
			);
		}
	}

	// ==================== Cleanup & Storage ====================

	// Schedule cleanup of expired invitations
	private scheduleCleanup(): void {
		// Schedule alarm for once a day
		this.state.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
	}

	// Handle alarm for cleanup
	private async handleCleanupAlarm(): Promise<void> {
		const now = Date.now();
		let changed = false;

		// Clean up regular invites
		const toRemoveRegular: string[] = [];
		for (const [id, invite] of this.invites.entries()) {
			const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

			if (invite.createdAt < sevenDaysAgo) {
				toRemoveRegular.push(id);
				changed = true;
				continue;
			}

			if (invite.status === 'pending' && now > invite.expiresAt) {
				invite.status = 'expired';
				changed = true;
			}
		}

		// Clean up betting invites
		const toRemoveBetting: string[] = [];
		for (const [id, invite] of this.bettingInvites.entries()) {
			const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

			if (invite.createdAt < sevenDaysAgo) {
				toRemoveBetting.push(id);
				changed = true;
				continue;
			}

			if (invite.betStatus === 'Open' && now > invite.expiresAt) {
				invite.betStatus = 'Expired';
				changed = true;
			}
		}

		// Remove old invitations
		for (const id of toRemoveRegular) {
			const invite = this.invites.get(id);
			if (invite && invite.code) {
				this.codeToInviteMap.delete(invite.code);
			}
			this.invites.delete(id);
		}

		for (const id of toRemoveBetting) {
			const invite = this.bettingInvites.get(id);
			if (invite && invite.code) {
				this.codeToInviteMap.delete(invite.code);
			}
			this.bettingInvites.delete(id);
		}

		// Save changes if needed
		if (changed) {
			await this.saveInvites();
			await this.saveBettingInvites();
		}

		// Reschedule next cleanup
		this.scheduleCleanup();
	}

	// Save regular invites to durable storage
	private async saveInvites(): Promise<void> {
		await this.state.storage.put('invites', Array.from(this.invites.values()));
	}

	// Save betting invites to durable storage
	private async saveBettingInvites(): Promise<void> {
		await this.state.storage.put('bettingInvites', Array.from(this.bettingInvites.values()));
	}
}
