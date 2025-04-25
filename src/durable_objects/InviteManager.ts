/**
 * InviteManager Durable Object
 *
 * Handles game invitations including:
 * - Creating invite links with unique codes
 * - Tracking invitation status
 * - Managing invitation expiration
 * - Creating game sessions when invites are accepted
 */
import { Invitation, InvitationCreateRequest, InvitationUpdate } from '../types';
import { generateInviteCode } from '../utils/crypto';

export class InviteManager {
	private state: DurableObjectState;
	private env: any;
	private invites: Map<string, Invitation> = new Map();
	private codeToInviteMap: Map<string, string> = new Map();
	private cleanupAlarmId: string | null = null;

	constructor(state: DurableObjectState, env: any) {
		this.state = state;
		this.env = env;

		// Load invites on startup
		this.state.blockConcurrencyWhile(async () => {
			// Load stored invites
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

			// Schedule cleanup for expired invites
			this.scheduleCleanup();
		});
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Handle invite endpoints
		if (path.endsWith('/create')) {
			return this.handleCreateInvite(request);
		}

		if (path.endsWith('/accept')) {
			return this.handleAcceptInvite(request);
		}

		if (path.endsWith('/cancel')) {
			return this.handleCancelInvite(request);
		}

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

	// Handle POST /create - Create a new invitation
	private async handleCreateInvite(request: Request): Promise<Response> {
		try {
			const data = (await request.json()) as InvitationCreateRequest;

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

			// Create the invitation
			const invitation: Invitation = {
				id,
				code,
				creator: data.creator,
				createdAt: Date.now(),
				expiresAt,
				sessionId: null,
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
					inviteLink: `${new URL(request.url).origin}/invite/${code}`,
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

	// Handle POST /accept - Accept an invitation
	private async handleAcceptInvite(request: Request): Promise<Response> {
		try {
			const data = (await request.json()) as InvitationUpdate;

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

			// Check if the invitation can be accepted
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
				// Mark as expired
				invite.status = 'expired';
				await this.saveInvites();

				return new Response(JSON.stringify({ error: 'Invitation has expired' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// Prevent creator from accepting their own invite
			if (data.player === invite.creator) {
				return new Response(JSON.stringify({ error: 'Cannot accept your own invitation' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			// Create a new game session
			const sessionId = crypto.randomUUID();
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
						creator: invite.creator,
					}),
				})
			);

			// Add the accepting player to the session
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

			// Update the invitation
			invite.status = 'accepted';
			invite.acceptedBy = data.player;
			invite.acceptedAt = Date.now();
			invite.sessionId = sessionId;

			await this.saveInvites();

			return new Response(
				JSON.stringify({
					success: true,
					inviteId: inviteId,
					sessionId: sessionId,
					creator: invite.creator,
					acceptedBy: data.player,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} catch (error) {
			console.error('Error accepting invite:', error);
			return new Response(JSON.stringify({ error: 'Failed to accept invitation' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	}

	// Handle POST /cancel - Cancel an invitation
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

	// Handle GET /status/:id - Get invitation status by ID
	private handleGetInviteStatus(inviteId: string): Response {
		if (!this.invites.has(inviteId)) {
			return new Response(JSON.stringify({ error: 'Invitation not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

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
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	// Handle GET /by-code/:code - Get invitation by code
	private handleGetInviteByCode(code: string): Response {
		const inviteId = this.codeToInviteMap.get(code);

		if (!inviteId || !this.invites.has(inviteId)) {
			return new Response(JSON.stringify({ error: 'Invitation not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

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
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	// Schedule cleanup of expired invitations
	private scheduleCleanup(): void {
		// Schedule alarm for once a day
		this.state.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
	}

	// Handle alarm for cleanup
	private async handleCleanupAlarm(): Promise<void> {
		const now = Date.now();
		let changed = false;

		// Find invitations that are more than 7 days old or expired
		const toRemove: string[] = [];

		for (const [id, invite] of this.invites.entries()) {
			// Remove invitations older than 7 days
			const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

			if (invite.createdAt < sevenDaysAgo) {
				toRemove.push(id);
				changed = true;
				continue;
			}

			// Mark pending invitations as expired if past expiration time
			if (invite.status === 'pending' && now > invite.expiresAt) {
				invite.status = 'expired';
				changed = true;
			}
		}

		// Remove old invitations
		for (const id of toRemove) {
			const invite = this.invites.get(id);
			if (invite && invite.code) {
				this.codeToInviteMap.delete(invite.code);
			}
			this.invites.delete(id);
		}

		// Save changes if needed
		if (changed) {
			await this.saveInvites();
		}

		// Reschedule next cleanup
		this.scheduleCleanup();
	}

	// Save invites to durable storage
	private async saveInvites(): Promise<void> {
		await this.state.storage.put('invites', Array.from(this.invites.values()));
	}
}
