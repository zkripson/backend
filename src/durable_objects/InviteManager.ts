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
			const inviteIds = (await this.state.storage.get('inviteIds')) as string[] | null;
			if (inviteIds && Array.isArray(inviteIds)) {
				// Load invites individually
				for (const id of inviteIds) {
					const invite = (await this.state.storage.get(`invite:${id}`)) as Invitation | null;
					if (invite) {
						this.invites.set(invite.id, invite);
						if (invite.code) {
							this.codeToInviteMap.set(invite.code, invite.id);
						}
					}
				}
			} else {
				// Fallback to old format for migration
				let storedInvites = (await this.state.storage.get('invites')) as Invitation[];
				if (Array.isArray(storedInvites)) {
					for (const invite of storedInvites) {
						this.invites.set(invite.id, invite);
						if (invite.code) {
							this.codeToInviteMap.set(invite.code, invite.id);
						}
					}
					// Migrate to new format
					await this.saveInvites();
					// Clean up old format
					await this.state.storage.delete('invites');
				}
			}

			// Load betting invites
			const bettingInviteIds = (await this.state.storage.get('bettingInviteIds')) as string[] | null;
			if (bettingInviteIds && Array.isArray(bettingInviteIds)) {
				// Load betting invites individually
				for (const id of bettingInviteIds) {
					const invite = (await this.state.storage.get(`betting:${id}`)) as BettingInvite | null;
					if (invite) {
						this.bettingInvites.set(invite.id, invite);
						if (invite.code) {
							this.codeToInviteMap.set(invite.code, invite.id);
						}
					}
				}
			} else {
				// Fallback to old format for migration
				let storedBettingInvites = (await this.state.storage.get('bettingInvites')) as BettingInvite[];
				if (Array.isArray(storedBettingInvites)) {
					for (const invite of storedBettingInvites) {
						this.bettingInvites.set(invite.id, invite);
						if (invite.code) {
							this.codeToInviteMap.set(invite.code, invite.id);
						}
					}
					// Migrate to new format
					await this.saveBettingInvites();
					// Clean up old format
					await this.state.storage.delete('bettingInvites');
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
		const now = Date.now();
		
		// Check regular invites first
		if (this.invites.has(inviteId)) {
			const invite = this.invites.get(inviteId)!;

			// Check if the invitation has expired (but don't save status change)
			const displayStatus = (invite.status === 'pending' && now > invite.expiresAt) 
				? 'expired' 
				: invite.status;

			return new Response(
				JSON.stringify({
					id: invite.id,
					creator: invite.creator,
					status: displayStatus,
					createdAt: invite.createdAt,
					expiresAt: invite.expiresAt,
					sessionId: invite.sessionId,
					acceptedBy: invite.acceptedBy,
					acceptedAt: invite.acceptedAt,
					isBettingGame: false,
					isExpired: now > invite.expiresAt,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// Check betting invites
		if (this.bettingInvites.has(inviteId)) {
			const invite = this.bettingInvites.get(inviteId)!;

			// Check if the betting invitation has expired (but don't save status change)
			const displayStatus = (invite.betStatus === 'Open' && now > invite.expiresAt) 
				? 'Expired' 
				: invite.betStatus;

			return new Response(
				JSON.stringify({
					id: invite.id,
					creator: invite.creator,
					status: displayStatus,
					createdAt: invite.createdAt,
					expiresAt: invite.expiresAt,
					sessionId: invite.sessionId,
					acceptedBy: invite.acceptor,
					gameId: invite.gameId,
					stakeAmount: invite.stakeAmount,
					isBettingGame: true,
					onChainInviteId: invite.onChainInviteId,
					isExpired: now > invite.expiresAt,
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
			const data = (await request.json()) as { gameId: string; winner: string | null };

			if (!data.gameId) {
				return new Response(JSON.stringify({ success: false, error: 'Game ID is required' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			const success = await this.resolveBettingGame(data.gameId, data.winner);

			return new Response(JSON.stringify({ success }), { headers: { 'Content-Type': 'application/json' } });
		} catch (error) {
			console.error('Error in handleResolveBetting:', error);
			return new Response(
				JSON.stringify({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				}),
				{
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}
	}

	// ==================== Cleanup & Storage ====================

	// Schedule cleanup of expired invitations
	private scheduleCleanup(): void {
		// Schedule alarm for every 6 hours to clean up expired invites more frequently
		this.state.storage.setAlarm(Date.now() + 6 * 60 * 60 * 1000);
	}

	// Add a more aggressive cleanup method that can be called manually
	public async cleanupOldInvites(daysToKeep: number = 1): Promise<void> {
		const now = Date.now();
		const cutoffTime = now - (daysToKeep * 24 * 60 * 60 * 1000);
		let removedCount = 0;

		// Clean up regular invites
		const toRemoveRegular: string[] = [];
		for (const [id, invite] of this.invites.entries()) {
			// Remove expired invites older than cutoff
			if ((invite.status === 'expired' || invite.status === 'canceled') && invite.createdAt < cutoffTime) {
				toRemoveRegular.push(id);
			}
			// Remove pending invites that are expired
			else if (invite.status === 'pending' && now > invite.expiresAt) {
				toRemoveRegular.push(id);
			}
		}

		// Clean up betting invites
		const toRemoveBetting: string[] = [];
		for (const [id, invite] of this.bettingInvites.entries()) {
			// Remove resolved/cancelled invites older than cutoff
			if ((invite.betStatus === 'Resolved' || invite.betStatus === 'Cancelled' || invite.betStatus === 'Expired') && 
				invite.createdAt < cutoffTime) {
				toRemoveBetting.push(id);
			}
			// Remove open invites that are expired
			else if (invite.betStatus === 'Open' && now > invite.expiresAt) {
				toRemoveBetting.push(id);
			}
		}

		// Remove old invitations
		for (const id of toRemoveRegular) {
			const invite = this.invites.get(id);
			if (invite && invite.code) {
				this.codeToInviteMap.delete(invite.code);
			}
			this.invites.delete(id);
			await this.state.storage.delete(`invite:${id}`);
			removedCount++;
		}

		for (const id of toRemoveBetting) {
			const invite = this.bettingInvites.get(id);
			if (invite && invite.code) {
				this.codeToInviteMap.delete(invite.code);
			}
			this.bettingInvites.delete(id);
			await this.state.storage.delete(`betting:${id}`);
			removedCount++;
		}

		// Update the ID lists
		if (removedCount > 0) {
			await this.saveInvites();
			await this.saveBettingInvites();
		}

		console.log(`Cleaned up ${removedCount} old invites`);
	}

	// Handle alarm for cleanup
	private async handleCleanupAlarm(): Promise<void> {
		const now = Date.now();
		let removedCount = 0;

		// Clean up regular invites
		const toRemoveRegular: string[] = [];
		for (const [id, invite] of this.invites.entries()) {
			// Remove any invite that has passed its expiration time (typically 24 hours)
			if (now > invite.expiresAt) {
				toRemoveRegular.push(id);
				continue;
			}

			// Also remove very old invites regardless of status (failsafe)
			const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
			if (invite.createdAt < sevenDaysAgo) {
				toRemoveRegular.push(id);
			}
		}

		// Clean up betting invites
		const toRemoveBetting: string[] = [];
		for (const [id, invite] of this.bettingInvites.entries()) {
			// Remove any betting invite that has passed its expiration time
			if (now > invite.expiresAt) {
				toRemoveBetting.push(id);
				continue;
			}

			// Also remove very old invites regardless of status (failsafe)
			const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
			if (invite.createdAt < sevenDaysAgo) {
				toRemoveBetting.push(id);
			}
		}

		// Remove expired regular invitations
		for (const id of toRemoveRegular) {
			const invite = this.invites.get(id);
			if (invite && invite.code) {
				this.codeToInviteMap.delete(invite.code);
			}
			this.invites.delete(id);
			await this.state.storage.delete(`invite:${id}`);
			removedCount++;
		}

		// Remove expired betting invitations
		for (const id of toRemoveBetting) {
			const invite = this.bettingInvites.get(id);
			if (invite && invite.code) {
				this.codeToInviteMap.delete(invite.code);
			}
			this.bettingInvites.delete(id);
			await this.state.storage.delete(`betting:${id}`);
			removedCount++;
		}

		// Update the ID lists if anything was removed
		if (removedCount > 0) {
			await this.saveInvites();
			await this.saveBettingInvites();
			console.log(`Cleanup: Removed ${removedCount} expired invites`);
		}

		// Reschedule next cleanup
		this.scheduleCleanup();
	}

	// Save regular invites to durable storage
	private async saveInvites(): Promise<void> {
		// Store each invite individually with a prefixed key
		const transaction = this.state.storage.transaction(async txn => {
			// First, get all existing invite keys to remove old ones
			const existingKeys = await txn.list({ prefix: 'invite:' });
			
			// Remove old invite keys not in current map
			for (const key of existingKeys.keys()) {
				const id = key.substring('invite:'.length);
				if (!this.invites.has(id)) {
					await txn.delete(key);
				}
			}
			
			// Store current invites
			for (const [id, invite] of this.invites.entries()) {
				await txn.put(`invite:${id}`, invite);
			}
		});
		
		await transaction;
		
		// Also store a simple list of IDs for quick reference
		await this.state.storage.put('inviteIds', Array.from(this.invites.keys()));
	}

	// Save betting invites to durable storage
	private async saveBettingInvites(): Promise<void> {
		// Store each betting invite individually with a prefixed key
		const transaction = this.state.storage.transaction(async txn => {
			// First, get all existing betting invite keys to remove old ones
			const existingKeys = await txn.list({ prefix: 'betting:' });
			
			// Remove old betting invite keys not in current map
			for (const key of existingKeys.keys()) {
				const id = key.substring('betting:'.length);
				if (!this.bettingInvites.has(id)) {
					await txn.delete(key);
				}
			}
			
			// Store current betting invites
			for (const [id, invite] of this.bettingInvites.entries()) {
				await txn.put(`betting:${id}`, invite);
			}
		});
		
		await transaction;
		
		// Also store a simple list of IDs for quick reference
		await this.state.storage.put('bettingInviteIds', Array.from(this.bettingInvites.keys()));
	}
}
